# pulse-web-sdk

Connect web dapps to the **Pulse Wallet (Desktop)** via the `pulsevm://` URL
scheme. This is the lightweight, desktop-first analogue of `@proton/web-sdk`:
the dapp serializes a transaction (with [`pulsevm-js`](https://github.com/MetalBlockchain/pulsevm-js)),
hands the packed bytes to the wallet over a deep link, and the wallet signs it
on-device with Touch ID / Secure Enclave and returns the signature.

## Why a URL scheme (not a relay)

For a desktop wallet, `pulsevm://` deep links need no server, no pairing QR, and
no relay infrastructure — the browser hands off to the local app and the app
redirects back to a callback URL you control. (A relay transport for
cross-device phone→desktop can be added later behind the same API.)

## Install

```sh
npm i @pulsevm/pulse-web-sdk
```

## Login

```ts
import { PulseWalletLink, parseCallback } from "@pulsevm/pulse-web-sdk";

const link = new PulseWalletLink();
link.login("https://yourapp.com/callback");
// Wallet opens, user approves, browser returns to:
//   https://yourapp.com/callback?account=protonnz&key=PUB_K1_8d1v…
const { account, key } = parseCallback(window.location.href);
```

## Sign a transaction

```ts
import { PulseWalletLink } from "@pulsevm/pulse-web-sdk";
// 1. serialize with pulsevm-js → packedTrxHex (a transaction, no signatures)
// 2. hand it to the wallet:
new PulseWalletLink().transact({
  chainId: "0d6f033e887fae475d641104b6e87762b6c869e87a101afeeb64d608ab376618",
  packedTrx: packedTrxHex,
  summary: "Transfer 1.0000 XPR to treasury.nz",
  callback: "https://yourapp.com/signed",
});
// Wallet signs (Touch ID) and returns:
//   https://yourapp.com/signed?signature=SIG_K1_…
// 3. broadcast yourself via pulsevm.issueTx:
//    { signatures:[sig], compression:"none", packed_context_free_data:"", packed_trx: packedTrxHex }
```

## Protocol

| Deep link | Wallet returns on callback |
|---|---|
| `pulsevm://login?callback=URL` | `?account=&key=` |
| `pulsevm://sign?chain_id=&packed_trx=&summary=&callback=URL` | `?signature=` |

The wallet computes the signing digest itself as
`sha256(chain_id ‖ packed_trx ‖ sha256(cfd))`, derives the recovery id, and
returns a canonical `SIG_K1_…`/`SIG_R1_…`. It never exposes private keys.

## Status

`0.0.1` — desktop deep-link transport. Pairs with the Pulse Wallet (macOS) which
registers the `pulsevm://` scheme and presents an approval sheet with Touch ID.
