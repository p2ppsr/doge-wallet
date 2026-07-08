# Doge Wallet

Dead-simple Dogecoin custody through your BRC100 Metanet wallet.

Why? For the memes.

## What It Does

- Derives one Dogecoin P2PKH address from BRC100 `getPublicKey`.
- Signs Dogecoin sends through BRC100 `createSignature`.
- Uses protocol ID `[1, "dogecoin"]` and key ID `"1"` so Dogecoin keys are not exposed at security level 0.
- Reads balance, UTXOs, and recent transactions from BlockCypher's Dogecoin explorer API.
- Broadcasts raw Dogecoin transactions through the explorer API.
- Subscribes to BlockCypher WebSockets for live address activity.
- Runs as a frontend-only LARS/CARS/BRC102 project.

The app never asks for or stores a Dogecoin private key. The Metanet wallet signs exact Dogecoin legacy P2PKH sighashes with the derived BRC100 key.

## Status

This is a meme-grade wallet UI, not audited financial software. Start with a small amount of DOGE and inspect the transaction preview before broadcasting.

## Local Development

```bash
npm install
npm --prefix frontend install
npm run frontend:dev
```

Or run through LARS:

```bash
npm run lars
npm run start
```

The frontend defaults to `http://localhost:8080` when run through Vite.

## Optional Explorer Token

BlockCypher's public API is rate-limited. The app works without a token, but production deployments can set:

```bash
VITE_BLOCKCYPHER_TOKEN=your-public-client-token
```

Do not put private service credentials in this frontend.

## Validation

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run build
npm --prefix frontend run qa:responsive
```

The responsive QA script starts the built app locally and checks desktop/tablet/mobile viewports for horizontal overflow, console errors, and the expected wallet UI.

## Deployment

This repo follows the standard BSV app layout:

- `deployment-info.json`
- `frontend/`
- CARS config named `Babbage`

The production workflow deploys pushes to `master` through CARS. Required GitHub Actions secret:

- `CARS_PRIVATE_KEY`

Optional secret:

- `CARS_WALLET_STORAGE`

Production domain target:

- `https://doge.metanet.app`

## Protocol

See [PROTOCOL.md](./PROTOCOL.md).

## License

[Open BSV License](./LICENSE.txt)
