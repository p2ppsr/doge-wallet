import {
  BigNumber,
  ECDSA,
  Hash,
  PublicKey,
  Signature,
  Utils,
  type WalletInterface,
  type WalletProtocol
} from '@bsv/sdk'

export const DOGE_PROTOCOL_ID: WalletProtocol = [1, 'dogecoin']
export const DOGE_KEY_ID = '1'
export const DOGE_P2PKH_PREFIX = 0x1e
export const DOGE_P2SH_PREFIX = 0x16
export const SHIBES_PER_DOGE = 100000000n
export const DEFAULT_FEE_RATE_PER_KB = 1000000n
export const DEFAULT_MIN_RELAY_FEE = 1000000n
export const DEFAULT_DUST_THRESHOLD = 1000000n
export const SIGHASH_ALL = 0x01

export interface DogeIdentity {
  publicKey: string
  publicKeyBytes: number[]
  pubKeyHash: number[]
  address: string
}

export interface ExplorerUtxo {
  txid: string
  vout: number
  value: bigint
  script?: string
  confirmations?: number
}

export interface RecipientOutput {
  address: string
  value: bigint
}

export interface SpendPlan {
  selectedUtxos: ExplorerUtxo[]
  recipients: RecipientOutput[]
  changeAddress: string
  sendTotal: bigint
  inputTotal: bigint
  fee: bigint
  change: bigint
  inputCount: number
  outputCount: number
  estimatedSize: number
}

interface MutableInput {
  prevTxId: string
  outputIndex: number
  sequence: number
  scriptSig: number[]
  sourceScript: number[]
}

interface MutableOutput {
  value: bigint
  scriptPubKey: number[]
}

interface MutableTx {
  version: number
  lockTime: number
  inputs: MutableInput[]
  outputs: MutableOutput[]
}

export interface SignedDogeTransaction {
  rawTx: string
  txid: string
  plan: SpendPlan
}

const assertByte = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid byte value: ${value}`)
  }
  return value
}

export const bytesToHex = (bytes: number[] | Uint8Array): string => Utils.toHex(Array.from(bytes))
export const hexToBytes = (hex: string): number[] => Utils.toArray(hex, 'hex').map(assertByte)

const writeUInt32LE = (value: number): number[] => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid uint32 value: ${value}`)
  }
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ]
}

const writeUInt64LE = (value: bigint): number[] => {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`Invalid uint64 value: ${value.toString()}`)
  }
  const out: number[] = []
  let working = value
  for (let i = 0; i < 8; i += 1) {
    out.push(Number(working & 0xffn))
    working >>= 8n
  }
  return out
}

const writeVarInt = (value: number): number[] => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid varint value: ${value}`)
  if (value < 0xfd) return [value]
  if (value <= 0xffff) return [0xfd, value & 0xff, (value >>> 8) & 0xff]
  if (value <= 0xffffffff) return [0xfe, ...writeUInt32LE(value)]
  throw new Error('Varint values above uint32 are not supported here')
}

const reverseHex = (hex: string): number[] => {
  const bytes = hexToBytes(hex)
  if (bytes.length !== 32) throw new Error('Transaction ID must be 32 bytes')
  return bytes.reverse()
}

const pushData = (data: number[]): number[] => {
  if (data.length > 75) throw new Error('Only small script pushes are supported')
  return [data.length, ...data]
}

export const parseDogeToShibes = (amount: string): bigint => {
  const normalized = amount.trim()
  if (!/^\d+(\.\d{0,8})?$/.test(normalized)) {
    throw new Error('Enter a DOGE amount with up to 8 decimal places')
  }
  const [whole, fractional = ''] = normalized.split('.')
  const shibes = BigInt(whole) * SHIBES_PER_DOGE + BigInt(fractional.padEnd(8, '0'))
  if (shibes <= 0n) throw new Error('Amount must be greater than zero')
  return shibes
}

export const formatShibes = (value: bigint, maxDecimals = 8): string => {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  const whole = abs / SHIBES_PER_DOGE
  const fractional = (abs % SHIBES_PER_DOGE).toString().padStart(8, '0')
  const trimmed = fractional.slice(0, maxDecimals).replace(/0+$/, '')
  return `${sign}${whole.toString()}${trimmed.length > 0 ? `.${trimmed}` : ''}`
}

export const publicKeyToDogeIdentity = (publicKey: string): DogeIdentity => {
  const parsed = PublicKey.fromString(publicKey)
  const publicKeyBytes = parsed.toDER() as number[]
  const pubKeyHash = parsed.toHash() as number[]
  return {
    publicKey: bytesToHex(publicKeyBytes),
    publicKeyBytes,
    pubKeyHash,
    address: Utils.toBase58Check(pubKeyHash, [DOGE_P2PKH_PREFIX])
  }
}

export const deriveDogeIdentity = async (wallet: WalletInterface): Promise<DogeIdentity> => {
  const { publicKey } = await wallet.getPublicKey({
    protocolID: DOGE_PROTOCOL_ID,
    keyID: DOGE_KEY_ID,
    counterparty: 'self'
  })
  return publicKeyToDogeIdentity(publicKey)
}

export const decodeDogeAddress = (address: string): { type: 'p2pkh' | 'p2sh'; hash: number[] } => {
  let decoded: { prefix: number[]; data: number[] }
  try {
    decoded = Utils.fromBase58Check(address) as { prefix: number[]; data: number[] }
  } catch {
    throw new Error('Invalid Dogecoin address')
  }

  if (decoded.data.length !== 20) throw new Error('Dogecoin address payload must be 20 bytes')
  if (decoded.prefix.length !== 1) throw new Error('Unsupported Dogecoin address prefix')
  if (decoded.prefix[0] === DOGE_P2PKH_PREFIX) return { type: 'p2pkh', hash: decoded.data }
  if (decoded.prefix[0] === DOGE_P2SH_PREFIX) return { type: 'p2sh', hash: decoded.data }
  throw new Error('Address is not a Dogecoin mainnet P2PKH or P2SH address')
}

export const addressToScriptPubKey = (address: string): number[] => {
  const decoded = decodeDogeAddress(address)
  if (decoded.type === 'p2pkh') {
    return [0x76, 0xa9, 0x14, ...decoded.hash, 0x88, 0xac]
  }
  return [0xa9, 0x14, ...decoded.hash, 0x87]
}

export const p2pkhScriptForHash = (pubKeyHash: number[]): number[] => {
  if (pubKeyHash.length !== 20) throw new Error('Public key hash must be 20 bytes')
  return [0x76, 0xa9, 0x14, ...pubKeyHash, 0x88, 0xac]
}

export const estimateLegacyP2pkhSize = (inputCount: number, outputCount: number): number => {
  return 10 + inputCount * 148 + outputCount * 34
}

export const estimateFee = (
  inputCount: number,
  outputCount: number,
  feeRatePerKb = DEFAULT_FEE_RATE_PER_KB,
  minFee = DEFAULT_MIN_RELAY_FEE
): bigint => {
  const size = BigInt(estimateLegacyP2pkhSize(inputCount, outputCount))
  const fee = (size * feeRatePerKb + 999n) / 1000n
  return fee > minFee ? fee : minFee
}

export const planP2pkhSpend = (params: {
  utxos: ExplorerUtxo[]
  recipients: RecipientOutput[]
  changeAddress: string
  feeRatePerKb?: bigint
  dustThreshold?: bigint
}): SpendPlan => {
  const feeRatePerKb = params.feeRatePerKb ?? DEFAULT_FEE_RATE_PER_KB
  const dustThreshold = params.dustThreshold ?? DEFAULT_DUST_THRESHOLD
  if (params.recipients.length === 0) throw new Error('At least one recipient is required')
  for (const recipient of params.recipients) {
    if (recipient.value <= 0n) throw new Error('Recipient value must be positive')
    addressToScriptPubKey(recipient.address)
  }
  addressToScriptPubKey(params.changeAddress)

  const sendTotal = params.recipients.reduce((sum, recipient) => sum + recipient.value, 0n)
  const spendable = [...params.utxos]
    .filter(utxo => utxo.value > 0n)
    .sort((left, right) => {
      const confirmationDelta = (right.confirmations ?? 0) - (left.confirmations ?? 0)
      if (confirmationDelta !== 0) return confirmationDelta
      return Number(right.value - left.value)
    })

  const selectedUtxos: ExplorerUtxo[] = []
  let inputTotal = 0n
  let lastPlan: SpendPlan | null = null

  for (const utxo of spendable) {
    selectedUtxos.push(utxo)
    inputTotal += utxo.value

    let outputCount = params.recipients.length + 1
    let fee = estimateFee(selectedUtxos.length, outputCount, feeRatePerKb)
    let change = inputTotal - sendTotal - fee

    if (change >= 0n && change < dustThreshold) {
      outputCount = params.recipients.length
      fee = estimateFee(selectedUtxos.length, outputCount, feeRatePerKb)
      change = inputTotal - sendTotal - fee
    }

    if (change >= 0n) {
      const finalOutputCount = change >= dustThreshold ? params.recipients.length + 1 : params.recipients.length
      const finalFee = estimateFee(selectedUtxos.length, finalOutputCount, feeRatePerKb)
      const finalChange = inputTotal - sendTotal - finalFee
      if (finalChange >= 0n) {
        lastPlan = {
          selectedUtxos,
          recipients: params.recipients,
          changeAddress: params.changeAddress,
          sendTotal,
          inputTotal,
          fee: finalFee,
          change: finalChange >= dustThreshold ? finalChange : 0n,
          inputCount: selectedUtxos.length,
          outputCount: finalChange >= dustThreshold ? params.recipients.length + 1 : params.recipients.length,
          estimatedSize: estimateLegacyP2pkhSize(selectedUtxos.length, finalOutputCount)
        }
        break
      }
    }
  }

  if (lastPlan === null) {
    throw new Error(`Insufficient DOGE. Need at least ${formatShibes(sendTotal)} DOGE plus fee.`)
  }
  return lastPlan
}

const serializeInput = (input: MutableInput, script: number[]): number[] => [
  ...reverseHex(input.prevTxId),
  ...writeUInt32LE(input.outputIndex),
  ...writeVarInt(script.length),
  ...script,
  ...writeUInt32LE(input.sequence)
]

const serializeOutput = (output: MutableOutput): number[] => [
  ...writeUInt64LE(output.value),
  ...writeVarInt(output.scriptPubKey.length),
  ...output.scriptPubKey
]

export const serializeTransaction = (tx: MutableTx): number[] => [
  ...writeUInt32LE(tx.version),
  ...writeVarInt(tx.inputs.length),
  ...tx.inputs.flatMap(input => serializeInput(input, input.scriptSig)),
  ...writeVarInt(tx.outputs.length),
  ...tx.outputs.flatMap(serializeOutput),
  ...writeUInt32LE(tx.lockTime)
]

export const legacySighashAllPreimage = (tx: MutableTx, inputIndex: number): number[] => {
  if (inputIndex < 0 || inputIndex >= tx.inputs.length) throw new Error('Input index out of range')
  return [
    ...writeUInt32LE(tx.version),
    ...writeVarInt(tx.inputs.length),
    ...tx.inputs.flatMap((input, index) => serializeInput(input, index === inputIndex ? input.sourceScript : [])),
    ...writeVarInt(tx.outputs.length),
    ...tx.outputs.flatMap(serializeOutput),
    ...writeUInt32LE(tx.lockTime),
    ...writeUInt32LE(SIGHASH_ALL)
  ]
}

export const legacySighashAll = (tx: MutableTx, inputIndex: number): number[] => {
  return Hash.hash256(legacySighashAllPreimage(tx, inputIndex))
}

export const buildUnsignedTransaction = (plan: SpendPlan, sourceScript: number[]): MutableTx => {
  const outputs: MutableOutput[] = [
    ...plan.recipients.map(recipient => ({
      value: recipient.value,
      scriptPubKey: addressToScriptPubKey(recipient.address)
    }))
  ]
  if (plan.change > 0n) {
    outputs.push({
      value: plan.change,
      scriptPubKey: addressToScriptPubKey(plan.changeAddress)
    })
  }

  return {
    version: 1,
    lockTime: 0,
    inputs: plan.selectedUtxos.map(utxo => ({
      prevTxId: utxo.txid,
      outputIndex: utxo.vout,
      sequence: 0xffffffff,
      scriptSig: [],
      sourceScript: utxo.script != null && utxo.script.length > 0 ? hexToBytes(utxo.script) : sourceScript
    })),
    outputs
  }
}

export const buildSignedP2pkhTransaction = async (params: {
  wallet: WalletInterface
  publicKeyHex: string
  sourceAddress: string
  utxos: ExplorerUtxo[]
  recipients: RecipientOutput[]
  changeAddress?: string
  feeRatePerKb?: bigint
  dustThreshold?: bigint
}): Promise<SignedDogeTransaction> => {
  const publicKey = PublicKey.fromString(params.publicKeyHex)
  const publicKeyBytes = publicKey.toDER() as number[]
  const pubKeyHash = publicKey.toHash() as number[]
  const sourceScript = p2pkhScriptForHash(pubKeyHash)
  const sourceAddress = Utils.toBase58Check(pubKeyHash, [DOGE_P2PKH_PREFIX])
  if (sourceAddress !== params.sourceAddress) {
    throw new Error('Source address does not match derived public key')
  }
  const expectedSourceScript = bytesToHex(sourceScript)
  for (const utxo of params.utxos) {
    if (utxo.script != null && utxo.script.length > 0 && utxo.script.toLowerCase() !== expectedSourceScript.toLowerCase()) {
      throw new Error(`Explorer script mismatch for ${utxo.txid}:${utxo.vout}`)
    }
  }

  const plan = planP2pkhSpend({
    utxos: params.utxos,
    recipients: params.recipients,
    changeAddress: params.changeAddress ?? params.sourceAddress,
    feeRatePerKb: params.feeRatePerKb,
    dustThreshold: params.dustThreshold
  })
  const tx = buildUnsignedTransaction(plan, sourceScript)

  for (let inputIndex = 0; inputIndex < tx.inputs.length; inputIndex += 1) {
    const sighash = legacySighashAll(tx, inputIndex)
    const { signature } = await params.wallet.createSignature({
      hashToDirectlySign: sighash,
      protocolID: DOGE_PROTOCOL_ID,
      keyID: DOGE_KEY_ID,
      counterparty: 'self'
    })
    const parsedSignature = Signature.fromDER(signature)
    if (!ECDSA.verify(new BigNumber(sighash), parsedSignature, publicKey)) {
      throw new Error(`Wallet signature failed local verification for input ${inputIndex}`)
    }
    const signatureWithScope = [...signature, SIGHASH_ALL]
    tx.inputs[inputIndex].scriptSig = [
      ...pushData(signatureWithScope),
      ...pushData(publicKeyBytes)
    ]
  }

  const raw = serializeTransaction(tx)
  const txid = bytesToHex([...Hash.hash256(raw)].reverse())
  return { rawTx: bytesToHex(raw), txid, plan }
}
