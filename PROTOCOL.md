# Dogecoin BRC100 Protocol

## Namespace

- Protocol ID: `[1, "dogecoin"]`
- Key ID: `"1"`
- Counterparty: `"self"`

The first protocol element is the BRC100 security level. Doge Wallet uses level `1` so another app cannot request the same key through the wide-open level `0` namespace.

## Address Derivation

1. Request a public key with BRC100 `getPublicKey`.
2. Compress the public key.
3. Hash it with `HASH160`.
4. Base58Check encode it with Dogecoin P2PKH prefix `0x1e`.

The resulting address is the wallet's single receive address.

## Spending

1. Fetch spendable Dogecoin UTXOs for the derived address.
2. Build a legacy Dogecoin P2PKH transaction.
3. For each input, serialize the legacy SIGHASH_ALL preimage.
4. Double-SHA256 the preimage.
5. Request a BRC100 `createSignature` with `hashToDirectlySign`.
6. Append SIGHASH_ALL byte `0x01`.
7. Finalize the P2PKH unlocking script as `<signature> <compressedPublicKey>`.
8. Broadcast the raw transaction.

The app never exports or stores private key material.
