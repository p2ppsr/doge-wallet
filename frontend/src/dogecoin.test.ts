import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { Transaction, script as bitcoinScript } from 'bitcoinjs-lib'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import {
  BigNumber,
  ECDSA,
  PrivateKey,
  ProtoWallet,
  PublicKey,
  Signature
} from '@bsv/sdk'
import {
  DOGE_KEY_ID,
  DOGE_PROTOCOL_ID,
  addressToScriptPubKey,
  buildSignedP2pkhTransaction,
  buildUnsignedTransaction,
  bytesToHex,
  decodeDogeAddress,
  formatShibes,
  legacySighashAll,
  legacySighashAllPreimage,
  parseDogeToShibes,
  planP2pkhSpend,
  publicKeyToDogeIdentity,
  type ExplorerUtxo
} from './dogecoin'

describe('dogecoin helpers', () => {
  it('uses a restricted BRC100 security level for Dogecoin keys', () => {
    expect(DOGE_PROTOCOL_ID).toEqual([1, 'dogecoin'])
    expect(DOGE_KEY_ID).toBe('1')
  })

  it('formats and parses DOGE amounts without floating point math', () => {
    expect(parseDogeToShibes('1')).toBe(100000000n)
    expect(parseDogeToShibes('0.01000000')).toBe(1000000n)
    expect(formatShibes(123456789n)).toBe('1.23456789')
    expect(formatShibes(120000000n)).toBe('1.2')
  })

  it('builds a Dogecoin mainnet P2PKH address from a BRC100 public key', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('1'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToDogeIdentity(publicKey)
    const decoded = decodeDogeAddress(identity.address)
    expect(decoded.type).toBe('p2pkh')
    expect(decoded.hash).toHaveLength(20)
    expect(identity.address[0]).toBe('D')
  })

  it('plans fees and change deterministically', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('1'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToDogeIdentity(publicKey)
    const utxos: ExplorerUtxo[] = [
      {
        txid: '11'.repeat(32),
        vout: 0,
        value: 500000000n,
        confirmations: 10
      }
    ]
    const plan = planP2pkhSpend({
      utxos,
      recipients: [{ address: identity.address, value: 100000000n }],
      changeAddress: identity.address
    })
    expect(plan.fee).toBe(1000000n)
    expect(plan.change).toBe(399000000n)
    expect(plan.outputCount).toBe(2)
  })

  it('signs a legacy Dogecoin transaction through createSignature hashToDirectlySign', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('2'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToDogeIdentity(publicKey)
    const utxos: ExplorerUtxo[] = [
      {
        txid: '22'.repeat(32),
        vout: 1,
        value: 300000000n,
        script: bytesToHex(addressToScriptPubKey(identity.address)),
        confirmations: 4
      }
    ]

    const signed = await buildSignedP2pkhTransaction({
      wallet: wallet as unknown as Parameters<typeof buildSignedP2pkhTransaction>[0]['wallet'],
      publicKeyHex: identity.publicKey,
      sourceAddress: identity.address,
      utxos,
      recipients: [{ address: identity.address, value: 100000000n }]
    })

    expect(signed.rawTx).toMatch(/^[0-9a-f]+$/)
    expect(signed.txid).toHaveLength(64)
    const tx = buildUnsignedTransaction(signed.plan, addressToScriptPubKey(identity.address))
    const hash = legacySighashAll(tx, 0)
    const signature = Signature.fromDER(
      (await wallet.createSignature({
        hashToDirectlySign: hash,
        protocolID: DOGE_PROTOCOL_ID,
        keyID: DOGE_KEY_ID,
        counterparty: 'self'
      })).signature
    )
    const verified = ECDSA.verify(
      new BigNumber(hash),
      signature,
      PublicKey.fromString(identity.publicKey)
    )
    expect(verified).toBe(true)
  })

  it('matches independent Bitcoin-family sighash, byte order, DER, and low-S verification', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('3'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToDogeIdentity(publicKey)
    const sourceScript = addressToScriptPubKey(identity.address)
    const utxos: ExplorerUtxo[] = [{
      txid: 'ab'.repeat(32),
      vout: 2,
      value: 500000000n,
      script: bytesToHex(sourceScript),
      confirmations: 9
    }]
    const recipients = [{ address: identity.address, value: 125000000n }]
    const signed = await buildSignedP2pkhTransaction({
      wallet: wallet as unknown as Parameters<typeof buildSignedP2pkhTransaction>[0]['wallet'],
      publicKeyHex: identity.publicKey,
      sourceAddress: identity.address,
      utxos,
      recipients
    })

    const parsed = Transaction.fromHex(signed.rawTx)
    const independentSighash = parsed.hashForSignature(
      0,
      Uint8Array.from(sourceScript),
      Transaction.SIGHASH_ALL
    )
    const plan = planP2pkhSpend({ utxos, recipients, changeAddress: identity.address })
    const unsigned = buildUnsignedTransaction(plan, sourceScript)
    const preimage = legacySighashAllPreimage(unsigned, 0)
    const firstSha = createHash('sha256').update(Uint8Array.from(preimage)).digest()
    const nodeHash256 = Array.from(createHash('sha256').update(firstSha).digest())

    expect(legacySighashAll(unsigned, 0)).toEqual(nodeHash256)
    expect(Array.from(independentSighash)).toEqual(nodeHash256)
    expect(parsed.ins[0].hash).toEqual(Uint8Array.from(utxos[0].txid.match(/../g)!.map(byte => Number.parseInt(byte, 16)).reverse()))

    const chunks = bitcoinScript.decompile(parsed.ins[0].script)
    expect(chunks).not.toBeNull()
    const signatureWithScope = chunks![0] as Uint8Array
    const serializedPublicKey = chunks![1] as Uint8Array
    expect(signatureWithScope.at(-1)).toBe(Transaction.SIGHASH_ALL)
    expect(Buffer.from(serializedPublicKey).toString('hex')).toBe(identity.publicKey)

    const der = signatureWithScope.slice(0, -1)
    const nobleSignature = secp256k1.Signature.fromHex(Buffer.from(der).toString('hex'), 'der')
    expect(nobleSignature.hasHighS()).toBe(false)
    expect(secp256k1.verify(
      nobleSignature.toBytes('compact'),
      independentSighash,
      serializedPublicKey,
      { prehash: false }
    )).toBe(true)

    // A third SHA-256 or endian reversal must not verify.
    expect(secp256k1.verify(
      nobleSignature.toBytes('compact'),
      createHash('sha256').update(independentSighash).digest(),
      serializedPublicKey,
      { prehash: false }
    )).toBe(false)
    expect(secp256k1.verify(
      nobleSignature.toBytes('compact'),
      Uint8Array.from(independentSighash).reverse(),
      serializedPublicKey,
      { prehash: false }
    )).toBe(false)
  })

  it('refuses to sign when explorer source script disagrees with the derived address', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromHex('4'.padStart(64, '0')))
    const { publicKey } = await wallet.getPublicKey({
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const identity = publicKeyToDogeIdentity(publicKey)
    await expect(buildSignedP2pkhTransaction({
      wallet: wallet as unknown as Parameters<typeof buildSignedP2pkhTransaction>[0]['wallet'],
      publicKeyHex: identity.publicKey,
      sourceAddress: identity.address,
      utxos: [{ txid: 'cd'.repeat(32), vout: 0, value: 300000000n, script: '51' }],
      recipients: [{ address: identity.address, value: 100000000n }]
    })).rejects.toThrow(/Explorer script mismatch/)
  })
})
