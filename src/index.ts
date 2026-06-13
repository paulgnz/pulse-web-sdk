// @pulsevm/pulse-web-sdk — a proton-web-sdk-style connector that features the
// **Pulse Wallet (Desktop)** instead of Anchor. ConnectWallet() shows a wallet
// selector, logs in over the `pulsevm://` scheme, and returns a session whose
// `transact({ actions })` signs in the desktop wallet (Touch ID) and broadcasts.
//
// Transport: the scheme is triggered via a hidden iframe so the dapp page stays
// put; the wallet returns to a callback URL that writes the result to
// localStorage, which resolves the pending Promise via a storage event.

// ─────────────────────────────────────────── types

export interface Authorization { actor: string; permission: string }
export interface PulseAction {
  account: string;
  name: string;
  authorization: Authorization[];
  data: Record<string, unknown>;
}
export interface ConnectOptions {
  appName: string;
  chainId: string;
  rpcEndpoint: string;
}
export interface TransactResult { transactionId?: string; signature: string; packedTrx: string }
export interface PulseSession {
  actor: string;
  permission: string;
  publicKey: string;
  transact(args: { actions: PulseAction[] }, opts?: { broadcast?: boolean }): Promise<TransactResult>;
  logout(): void;
}

const SESSION_KEY = "pulse.session";

// ─────────────────────────────────────────── low-level transport

const here = () => location.origin + location.pathname;

export function loginURL(callback: string): string {
  return `pulsevm://login?callback=${encodeURIComponent(callback)}`;
}
export function signURL(p: { chainId: string; packedTrx: string; summary?: string; callback: string }): string {
  const q = new URLSearchParams({ chain_id: p.chainId, packed_trx: p.packedTrx, callback: p.callback });
  if (p.summary) q.set("summary", p.summary);
  return `pulsevm://sign?${q.toString()}`;
}

/** Trigger a custom-scheme URL without navigating the page away. */
function triggerScheme(url: string) {
  const f = document.createElement("iframe");
  f.style.display = "none";
  f.src = url;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1500);
}

/** Resolve when localStorage[key] is written (by the callback tab). */
function awaitResult(key: string, timeoutMs = 120_000): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const v = localStorage.getItem(key);
      if (v) { cleanup(); localStorage.removeItem(key); resolve(JSON.parse(v)); }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === key) check(); };
    const poll = setInterval(check, 400);            // same-tab fallback
    const timer = setTimeout(() => { cleanup(); reject(new Error("Wallet request timed out")); }, timeoutMs);
    function cleanup() { clearInterval(poll); clearTimeout(timer); removeEventListener("storage", onStorage); }
    addEventListener("storage", onStorage);
    check();
  });
}

/**
 * Call at page load. If this page is a wallet callback (has ?account / ?signature),
 * stash the result for the originating tab and return true so the dapp can show a
 * "you can close this tab" state.
 */
export function handleCallback(): boolean {
  const p = new URLSearchParams(location.search);
  if (p.get("account")) {
    localStorage.setItem("pulse.cb.login", JSON.stringify({ account: p.get("account") || "", key: p.get("key") || "" }));
    return true;
  }
  if (p.get("signature")) {
    const rid = p.get("rid") || "default";
    localStorage.setItem("pulse.cb.sign." + rid, JSON.stringify({ signature: p.get("signature") || "" }));
    return true;
  }
  return false;
}

// ─────────────────────────────────────────── RPC + transfer serialization

async function rpc<T>(endpoint: string, method: string, params: unknown = {}): Promise<T> {
  const r = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data || j.error.message);
  return j.result as T;
}

const te = new TextEncoder();
function charVal(c: number): bigint {
  if (c >= 97 && c <= 122) return BigInt(c - 97 + 6);
  if (c >= 49 && c <= 53) return BigInt(c - 49 + 1);
  return 0n;
}
function nameToU64(s: string): bigint {
  let v = 0n;
  for (let i = 0; i < 13; i++) {
    const c = i < s.length ? charVal(s.charCodeAt(i)) : 0n;
    if (i < 12) v |= (c & 0x1fn) << (64n - 5n * BigInt(i + 1));
    else v |= c & 0x0fn;
  }
  return v & ((1n << 64n) - 1n);
}
function u64le(v: bigint): number[] { const b: number[] = []; let x = v; for (let i = 0; i < 8; i++) { b.push(Number(x & 0xffn)); x >>= 8n; } return b; }
function u32le(v: number): number[] { const b: number[] = []; let x = v >>> 0; for (let i = 0; i < 4; i++) { b.push(x & 0xff); x = Math.floor(x / 256); } return b; }
function u16le(v: number): number[] { return [v & 0xff, (v >> 8) & 0xff]; }
function varu(v: number): number[] { const o: number[] = []; let x = v >>> 0; do { let b = x & 0x7f; x = Math.floor(x / 128); if (x) b |= 0x80; o.push(b); } while (x); return o; }
function assetBytes(qty: string): number[] {
  const [amt, sym] = qty.trim().split(/\s+/);
  const dot = amt.indexOf(".");
  const prec = dot < 0 ? 0 : amt.length - dot - 1;
  const amount = BigInt(amt.replace(".", ""));
  const o = [...u64le(amount), prec];
  const sb = te.encode(sym);
  for (let i = 0; i < 7; i++) o.push(i < sb.length ? sb[i] : 0);
  return o;
}
function hex(a: number[]): string { return a.map((b) => b.toString(16).padStart(2, "0")).join(""); }

/** Serialize a single `transfer` action into a packed transaction (hex) with live TAPOS. */
async function packTransfer(endpoint: string, action: PulseAction): Promise<string> {
  const d = action.data as { from: string; to: string; quantity: string; memo?: string };
  const auth = action.authorization[0];
  const info = await rpc<any>(endpoint, "pulsevm.getInfo");
  const idb = info.head_block_id.match(/../g)!.map((h: string) => parseInt(h, 16));
  const refPrefix = (idb[8] | (idb[9] << 8) | (idb[10] << 16) | (idb[11] << 24)) >>> 0;
  const memo = te.encode(d.memo || "");
  const data = [...u64le(nameToU64(d.from)), ...u64le(nameToU64(d.to)), ...assetBytes(d.quantity), ...varu(memo.length), ...memo];
  const tx = [
    ...u32le(Math.floor(Date.now() / 1000) + 120),
    ...u16le(info.head_block_num & 0xffff), ...u32le(refPrefix),
    ...varu(0), 0, ...varu(0), ...varu(0), ...varu(1),
    ...u64le(nameToU64(action.account)), ...u64le(nameToU64(action.name)),
    ...varu(1), ...u64le(nameToU64(auth.actor)), ...u64le(nameToU64(auth.permission)),
    ...varu(data.length), ...data, ...varu(0),
  ];
  return hex(tx);
}

// ─────────────────────────────────────────── selector modal

function showSelector(appName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(4,8,24,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;font:15px/1.5 -apple-system,system-ui,sans-serif";
    overlay.innerHTML = `
      <div style="width:360px;background:#0B1437;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px;color:#e8ecff">
        <div style="font-weight:700;font-size:18px;margin-bottom:2px">Connect a wallet</div>
        <div style="color:#9fb0e0;font-size:13px;margin-bottom:16px">to ${appName}</div>
        <button id="pw-opt" style="width:100%;display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px;color:#e8ecff;cursor:pointer;text-align:left">
          <div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#4F7CFF,#8B95FF);display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div>
          <div><div style="font-weight:600">Pulse Wallet</div><div style="color:#9fb0e0;font-size:12px">Desktop · Touch ID</div></div>
        </button>
        <button id="pw-cancel" style="width:100%;margin-top:10px;background:none;border:0;color:#9fb0e0;cursor:pointer;padding:8px">Cancel</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>("#pw-opt")!.onclick = () => { overlay.remove(); resolve(); };
    overlay.querySelector<HTMLButtonElement>("#pw-cancel")!.onclick = () => { overlay.remove(); reject(new Error("User cancelled")); };
  });
}

// ─────────────────────────────────────────── session + ConnectWallet

function makeSession(s: { actor: string; permission: string; publicKey: string }, opts: ConnectOptions): PulseSession {
  return {
    actor: s.actor, permission: s.permission, publicKey: s.publicKey,
    logout() { localStorage.removeItem(SESSION_KEY); },
    async transact({ actions }, txOpts = {}) {
      if (actions.length !== 1 || actions[0].name !== "transfer") {
        throw new Error("This SDK build serializes `transfer` only; use pulsevm-js for arbitrary actions.");
      }
      const packed = await packTransfer(opts.rpcEndpoint, actions[0]);
      const rid = Math.random().toString(36).slice(2);
      const cb = `${here()}?rid=${rid}`;
      const d = actions[0].data as any;
      triggerScheme(signURL({ chainId: opts.chainId, packedTrx: packed,
        summary: `Transfer ${d.quantity} to ${d.to}`, callback: cb }));
      const res = await awaitResult("pulse.cb.sign." + rid);
      const out: TransactResult = { signature: res.signature, packedTrx: packed };
      if (txOpts.broadcast !== false) {
        const r = await rpc<any>(opts.rpcEndpoint, "pulsevm.issueTx", {
          signatures: [res.signature], compression: "none", packed_context_free_data: "", packed_trx: packed,
        });
        out.transactionId = typeof r === "string" ? r : (r?.transaction_id || r?.id);
      }
      return out;
    },
  };
}

/** proton-web-sdk-style entry point. Restores an existing session or shows the
 *  Pulse Wallet (Desktop) selector and connects. */
export async function ConnectWallet(opts: ConnectOptions): Promise<{ session: PulseSession }> {
  // Restore a saved session if present.
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) return { session: makeSession(JSON.parse(saved), opts) };

  await showSelector(opts.appName);
  triggerScheme(loginURL(here()));
  const res = await awaitResult("pulse.cb.login");
  const s = { actor: res.account, permission: "active", publicKey: res.key };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return { session: makeSession(s, opts) };
}
