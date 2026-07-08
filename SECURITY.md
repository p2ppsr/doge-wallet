# Security Notes

Doge Wallet is frontend-only and wallet-backed.

- No Dogecoin private key is exported from the Metanet wallet.
- No seed phrase, WIF, or private key is accepted by the UI.
- Explorer API tokens are optional and must be treated as public frontend configuration.
- Transaction preview should be checked before broadcasting.
- This code is not a substitute for an audited hardware-wallet or full-node wallet.

Known tradeoffs:

- Balance and transaction history come from a third-party explorer.
- WebSocket live updates depend on the explorer's public socket availability.
- Fee policy is simple and defaults to `0.01 DOGE/kB`.

