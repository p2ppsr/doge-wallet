import { describe, expect, it } from 'vitest'
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
})
