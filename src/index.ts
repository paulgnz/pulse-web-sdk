// pulse-web-sdk — connect web dapps to the Pulse Wallet (Desktop) over the
// `pulsevm://` URL scheme. Pair with @metalblockchain/pulsevm-js to serialize a
// transaction into a packed_trx hex string, then hand it to the wallet to sign.
//
// Flow (deep link → wallet approves with Touch ID → redirects to your callback):
//   1. login()    → pulsevm://login?callback=<your-url>
//                    wallet returns ?account=&key= on the callback URL
//   2. transact()  → pulsevm://sign?chain_id=&packed_trx=&summary=&callback=
//                    wallet returns ?signature= on the callback URL
//   3. broadcast the signed tx yourself via pulsevm.issueTx (RPC).

const SCHEME = "pulsevm";

export interface LoginRequest {
  /** URL the wallet returns to with ?account=&key= */
  callback: string;
}

export interface SignRequest {
  chainId: string;
  /** hex packed transaction (serialize with pulsevm-js) */
  packedTrx: string;
  /** short human-readable description shown in the wallet */
  summary?: string;
  /** URL the wallet returns to with ?signature= */
  callback: string;
}

export function loginURL(req: LoginRequest): string {
  const q = new URLSearchParams({ callback: req.callback });
  return `${SCHEME}://login?${q.toString()}`;
}

export function signURL(req: SignRequest): string {
  const q = new URLSearchParams({
    chain_id: req.chainId,
    packed_trx: req.packedTrx,
    callback: req.callback,
  });
  if (req.summary) q.set("summary", req.summary);
  return `${SCHEME}://sign?${q.toString()}`;
}

export interface CallbackResult {
  account: string | null;
  key: string | null;
  signature: string | null;
}

/** Parse the values the wallet appended to your callback URL. */
export function parseCallback(href: string): CallbackResult {
  const u = new URL(href);
  return {
    account: u.searchParams.get("account"),
    key: u.searchParams.get("key"),
    signature: u.searchParams.get("signature"),
  };
}

type Nav = { location: { href: string } };

/** Browser-facing link to the desktop wallet. */
export class PulseWalletLink {
  constructor(private nav: Nav = globalThis as unknown as Nav) {}

  /** Ask the wallet to connect; it returns ?account=&key= to `callback`. */
  login(callback: string): void {
    this.nav.location.href = loginURL({ callback });
  }

  /** Ask the wallet to sign a packed transaction; returns ?signature=. */
  transact(req: SignRequest): void {
    this.nav.location.href = signURL(req);
  }
}
