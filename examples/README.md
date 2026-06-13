# Example: connect + sign + broadcast

A zero-build demo of the full loop between a web dapp, the `pulse-web-sdk`
transport, and the **Pulse Wallet (Desktop)**.

## Run

```sh
cd examples
python3 -m http.server 8000
# open http://localhost:8000
```

Serve over http (not `file://`) so the wallet's callback redirect lands back on
the page with its query params.

## What it shows

1. **Connect** — `pulsevm://login` opens the wallet; approve → the page receives
   `?account=&key=`.
2. **Sign** — paste a `packed_trx` (serialize a transfer with
   [`pulsevm-js`](https://github.com/MetalBlockchain/pulsevm-js), or copy one from
   the wallet's Send sheet), `pulsevm://sign` opens the wallet; Touch ID → the
   page receives `?signature=SIG_…`.
3. **Broadcast** — submit `{signatures, compression:"none",
   packed_context_free_data:"", packed_trx}` to `pulsevm.issueTx`.

## Serializing a real transfer (with pulsevm-js)

```ts
import { Api, JsonRpc } from "@metalblockchain/pulsevm-js";
// build the `transfer` action, get info for TAPOS, serialize → packed_trx hex,
// then hand packed_trx to the wallet via pulse-web-sdk's transact().
```

The wallet computes the signing digest itself
(`sha256(chain_id ‖ packed_trx ‖ sha256(cfd))`), derives the recovery id, and
returns a canonical signature — private keys never leave the device.
