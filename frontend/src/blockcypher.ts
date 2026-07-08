import { formatShibes, type ExplorerUtxo } from './dogecoin'

const API_BASE = 'https://api.blockcypher.com/v1/doge/main'
const SOCKET_BASE = 'wss://socket.blockcypher.com/v1/doge/main'
const TOKEN = import.meta.env.VITE_BLOCKCYPHER_TOKEN?.trim()

export interface AddressTxRef {
  txHash: string
  value: bigint
  direction: 'received' | 'sent'
  confirmations: number
  confirmed?: string
  spent?: boolean
  outputIndex: number
  inputIndex: number
}

export interface AddressState {
  address: string
  balance: bigint
  unconfirmedBalance: bigint
  finalBalance: bigint
  totalReceived: bigint
  totalSent: bigint
  txCount: number
  txrefs: AddressTxRef[]
  raw: unknown
}

export interface BroadcastResult {
  txid: string
  raw: unknown
}

const withToken = (url: string): string => {
  if (!TOKEN) return url
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`
}

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(withToken(url), init)
  const text = await response.text()
  let body: unknown
  try {
    body = text.length > 0 ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : text || response.statusText
    throw new Error(`BlockCypher ${response.status}: ${message}`)
  }
  return body as T
}

const toBigint = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return 0n
}

const mapTxRef = (ref: any): AddressTxRef => ({
  txHash: String(ref.tx_hash ?? ref.txHash ?? ''),
  value: toBigint(ref.value),
  direction: Number(ref.tx_input_n ?? -1) >= 0 ? 'sent' : 'received',
  confirmations: Number(ref.confirmations ?? 0),
  confirmed: typeof ref.confirmed === 'string' ? ref.confirmed : undefined,
  spent: typeof ref.spent === 'boolean' ? ref.spent : undefined,
  outputIndex: Number(ref.tx_output_n ?? -1),
  inputIndex: Number(ref.tx_input_n ?? -1)
})

export const fetchAddressState = async (address: string): Promise<AddressState> => {
  const data = await fetchJson<any>(
    `${API_BASE}/addrs/${encodeURIComponent(address)}?includeScript=true&limit=50`
  )
  const txrefs = [
    ...(Array.isArray(data.unconfirmed_txrefs) ? data.unconfirmed_txrefs : []),
    ...(Array.isArray(data.txrefs) ? data.txrefs : [])
  ]
    .map(mapTxRef)
    .filter(ref => ref.txHash.length > 0)

  return {
    address: String(data.address ?? address),
    balance: toBigint(data.balance),
    unconfirmedBalance: toBigint(data.unconfirmed_balance),
    finalBalance: toBigint(data.final_balance),
    totalReceived: toBigint(data.total_received),
    totalSent: toBigint(data.total_sent),
    txCount: Number(data.n_tx ?? 0),
    txrefs,
    raw: data
  }
}

export const fetchSpendableUtxos = async (address: string): Promise<ExplorerUtxo[]> => {
  const data = await fetchJson<any>(
    `${API_BASE}/addrs/${encodeURIComponent(address)}?unspentOnly=true&includeScript=true&limit=2000`
  )
  const refs = [
    ...(Array.isArray(data.txrefs) ? data.txrefs : []),
    ...(Array.isArray(data.unconfirmed_txrefs) ? data.unconfirmed_txrefs : [])
  ]

  return refs
    .filter((ref: any) => Number(ref.tx_output_n ?? -1) >= 0)
    .map((ref: any) => ({
      txid: String(ref.tx_hash),
      vout: Number(ref.tx_output_n),
      value: toBigint(ref.value),
      script: typeof ref.script === 'string' ? ref.script : undefined,
      confirmations: Number(ref.confirmations ?? 0)
    }))
    .filter((utxo: ExplorerUtxo) => utxo.txid.length === 64 && utxo.value > 0n)
}

export const broadcastRawTransaction = async (rawTx: string): Promise<BroadcastResult> => {
  const data = await fetchJson<any>(`${API_BASE}/txs/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tx: rawTx })
  })
  return {
    txid: String(data?.tx?.hash ?? data?.hash ?? ''),
    raw: data
  }
}

export const dogeExplorerTxUrl = (txid: string): string => {
  return `https://live.blockcypher.com/doge/tx/${txid}/`
}

export const formatDogeWithUnit = (value: bigint): string => `${formatShibes(value, 6)} DOGE`

export const subscribeToAddress = (
  address: string,
  handlers: {
    onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void
    onTransaction?: (event: unknown) => void
  }
): (() => void) => {
  let closed = false
  let socket: WebSocket | null = null
  let retryTimer: number | undefined
  let attempts = 0

  const connect = () => {
    if (closed) return
    handlers.onStatus?.('connecting')
    const url = TOKEN != null && TOKEN.length > 0
      ? `${SOCKET_BASE}?token=${encodeURIComponent(TOKEN)}`
      : SOCKET_BASE
    socket = new WebSocket(url)

    socket.addEventListener('open', () => {
      attempts = 0
      handlers.onStatus?.('open')
      socket?.send(JSON.stringify({ event: 'unconfirmed-tx', address }))
    })

    socket.addEventListener('message', event => {
      try {
        handlers.onTransaction?.(JSON.parse(String(event.data)))
      } catch {
        handlers.onTransaction?.(event.data)
      }
    })

    socket.addEventListener('error', () => {
      handlers.onStatus?.('error')
    })

    socket.addEventListener('close', () => {
      handlers.onStatus?.('closed')
      if (closed) return
      attempts += 1
      const delay = Math.min(30000, 1500 * attempts)
      retryTimer = window.setTimeout(connect, delay)
    })
  }

  connect()
  return () => {
    closed = true
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    socket?.close()
  }
}

