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

## Cryptographic Audit

`hashToDirectlySign` is already a 32-byte ECDSA message representative. The BSV SDK's real `ProtoWallet` passes it directly to `ECDSA.sign`; it does not hash it again. Doge Wallet therefore performs the Bitcoin-family double-SHA256 exactly once when producing the legacy sighash, then supplies that result directly.

The test suite independently checks the implementation with `bitcoinjs-lib` and Noble secp256k1:

- previous transaction IDs are reversed only for wire serialization;
- version, output index, values, sequence, locktime, and sighash scope use Bitcoin-family little-endian wire encoding;
- the 32-byte double-SHA256 digest is interpreted as a big-endian ECDSA integer;
- returned DER signatures are low-S and independently verify;
- a third SHA-256 or reversed digest fails verification.

Before signing, the wallet also requires any explorer-provided source script to match the P2PKH script derived from the BRC100 public key. Every returned signature is verified locally before the transaction can be broadcast.
