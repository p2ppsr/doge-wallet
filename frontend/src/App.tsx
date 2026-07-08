import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import BabbageGo from '@babbage/go'
import { WalletClient, type WalletInterface } from '@bsv/sdk'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wallet,
  Zap
} from 'lucide-react'
import {
  DEFAULT_FEE_RATE_PER_KB,
  buildSignedP2pkhTransaction,
  decodeDogeAddress,
  deriveDogeIdentity,
  formatShibes,
  parseDogeToShibes,
  planP2pkhSpend,
  type DogeIdentity,
  type ExplorerUtxo,
  type SpendPlan
} from './dogecoin'
import {
  broadcastRawTransaction,
  dogeExplorerTxUrl,
  fetchAddressState,
  fetchSpendableUtxos,
  formatDogeWithUnit,
  subscribeToAddress,
  type AddressState
} from './blockcypher'
import { playSfx } from './sfx'

type Mode = 'send' | 'receive'
type StatusKind = 'info' | 'success' | 'error'
type SocketStatus = 'connecting' | 'open' | 'closed' | 'error' | 'idle'

interface StatusMessage {
  kind: StatusKind
  text: string
}

interface SendFormState {
  to: string
  amount: string
}

interface SendPreview {
  plan: SpendPlan
  utxos: ExplorerUtxo[]
  recipient: string
  amount: bigint
}

const initialSendForm: SendFormState = {
  to: '',
  amount: ''
}

const truncate = (value: string, left = 8, right = 8): string => {
  if (value.length <= left + right + 3) return value
  return `${value.slice(0, left)}...${value.slice(-right)}`
}

const getSocketLabel = (status: SocketStatus): string => {
  switch (status) {
    case 'open':
      return 'Live'
    case 'connecting':
      return 'Connecting'
    case 'error':
      return 'Socket issue'
    case 'closed':
      return 'Reconnecting'
    default:
      return 'Idle'
  }
}

export default function App() {
  const walletRef = useRef<WalletInterface | null>(null)
  const [identity, setIdentity] = useState<DogeIdentity | null>(null)
  const [addressState, setAddressState] = useState<AddressState | null>(null)
  const [utxos, setUtxos] = useState<ExplorerUtxo[]>([])
  const [mode, setMode] = useState<Mode>('send')
  const [sendForm, setSendForm] = useState<SendFormState>(initialSendForm)
  const [sendPreview, setSendPreview] = useState<SendPreview | null>(null)
  const [status, setStatus] = useState<StatusMessage>({
    kind: 'info',
    text: 'Connect your Metanet wallet to derive your Dogecoin address.'
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('idle')
  const [lastBroadcastTxid, setLastBroadcastTxid] = useState<string | null>(null)
  const [showAddress, setShowAddress] = useState(true)
  const [sfxEnabled, setSfxEnabled] = useState(() => window.localStorage.getItem('doge-wallet:sfx') !== 'off')

  const wallet = useCallback(() => {
    if (walletRef.current == null) {
      walletRef.current = new BabbageGo(new WalletClient(), {
        showModal: true,
        design: {
          preset: 'emberLagoon',
          tokens: {
            accentBackground: '#f6c443',
            accentText: '#16130b',
            accentHoverBackground: '#fff1b8',
            accentHoverText: '#16130b',
            buttonShape: 'soft',
            cardRadius: '8px'
          }
        },
        walletUnavailable: {
          title: 'Metanet wallet needed',
          message: 'Open this app in Metanet Explorer or install a BRC100 wallet to hold DOGE with the same user-owned key system.',
          ctaText: 'Open GetMetanet',
          ctaHref: 'https://getmetanet.com/open'
        }
      }) as WalletInterface
    }
    return walletRef.current
  }, [])

  const spendableBalance = useMemo(() => {
    return utxos.reduce((sum, utxo) => sum + utxo.value, 0n)
  }, [utxos])

  const refreshData = useCallback(async (address: string, playSound = false) => {
    setIsRefreshing(true)
    try {
      const [state, spendable] = await Promise.all([
        fetchAddressState(address),
        fetchSpendableUtxos(address)
      ])
      setAddressState(state)
      setUtxos(spendable)
      setStatus({
        kind: 'success',
        text: `Synced ${state.txCount} Dogecoin transaction${state.txCount === 1 ? '' : 's'}.`
      })
      if (playSound) playSfx('refresh', sfxEnabled)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to sync Dogecoin explorer data.'
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsRefreshing(false)
    }
  }, [sfxEnabled])

  const connectWallet = async () => {
    setIsConnecting(true)
    setStatus({ kind: 'info', text: 'Asking the Metanet wallet for your Dogecoin public key...' })
    try {
      const nextIdentity = await deriveDogeIdentity(wallet())
      setIdentity(nextIdentity)
      setStatus({ kind: 'success', text: `Ready. Your Dogecoin address is ${nextIdentity.address}.` })
      playSfx('connect', sfxEnabled)
      await refreshData(nextIdentity.address)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not connect the wallet.'
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsConnecting(false)
    }
  }

  const copyAddress = async () => {
    if (identity == null) return
    try {
      await navigator.clipboard.writeText(identity.address)
      setStatus({ kind: 'success', text: 'Address copied.' })
      playSfx('copy', sfxEnabled)
    } catch {
      setStatus({ kind: 'error', text: 'Clipboard access was blocked by the browser.' })
      playSfx('error', sfxEnabled)
    }
  }

  const toggleSfx = () => {
    setSfxEnabled(enabled => {
      const next = !enabled
      window.localStorage.setItem('doge-wallet:sfx', next ? 'on' : 'off')
      playSfx('toggle', true)
      return next
    })
  }

  const reviewSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (identity == null) {
      await connectWallet()
      return
    }

    setIsReviewing(true)
    setSendPreview(null)
    try {
      decodeDogeAddress(sendForm.to.trim())
      const amount = parseDogeToShibes(sendForm.amount)
      const spendable = await fetchSpendableUtxos(identity.address)
      const plan = planP2pkhSpend({
        utxos: spendable,
        recipients: [{ address: sendForm.to.trim(), value: amount }],
        changeAddress: identity.address,
        feeRatePerKb: DEFAULT_FEE_RATE_PER_KB
      })
      setUtxos(spendable)
      setSendPreview({
        plan,
        utxos: spendable,
        recipient: sendForm.to.trim(),
        amount
      })
      setStatus({ kind: 'info', text: 'Review the transaction, then broadcast when ready.' })
      playSfx('review', sfxEnabled)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not prepare the send.'
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsReviewing(false)
    }
  }

  const broadcastSend = async () => {
    if (identity == null || sendPreview == null) return
    setIsSending(true)
    setStatus({ kind: 'info', text: 'Signing through BRC100 and broadcasting to Dogecoin...' })
    try {
      const signed = await buildSignedP2pkhTransaction({
        wallet: wallet(),
        publicKeyHex: identity.publicKey,
        sourceAddress: identity.address,
        utxos: sendPreview.utxos,
        recipients: [{ address: sendPreview.recipient, value: sendPreview.amount }],
        changeAddress: identity.address,
        feeRatePerKb: DEFAULT_FEE_RATE_PER_KB
      })
      const broadcast = await broadcastRawTransaction(signed.rawTx)
      const txid = broadcast.txid || signed.txid
      setLastBroadcastTxid(txid)
      setSendPreview(null)
      setSendForm(initialSendForm)
      setStatus({ kind: 'success', text: `Broadcast accepted: ${truncate(txid, 10, 10)}` })
      playSfx('send', sfxEnabled)
      await refreshData(identity.address)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Broadcast failed.'
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (identity == null) return undefined
    return subscribeToAddress(identity.address, {
      onStatus: setSocketStatus,
      onTransaction: async () => {
        setStatus({ kind: 'success', text: 'Fresh Dogecoin activity detected. Syncing now.' })
        playSfx('receive', sfxEnabled)
        await refreshData(identity.address)
      }
    })
  }, [identity, refreshData, sfxEnabled])

  const txrefs = addressState?.txrefs ?? []

  return (
    <main className="app-shell">
      <section className="hero-band" aria-label="Doge Wallet overview">
        <img className="hero-image" src="/assets/doge-wallet-hero.png" alt="" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-content">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">D</span>
            <span>Doge Wallet</span>
          </div>
          <h1>Doge Wallet</h1>
          <p className="hero-copy">
            One Dogecoin address, signed by your BSV Metanet wallet. Send, receive, and watch the memes move live.
          </p>
          <p className="why-copy">Why? For the memes.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={connectWallet} disabled={isConnecting}>
              {isConnecting ? <Loader2 className="spin" aria-hidden /> : <Wallet aria-hidden />}
              Connect Doge Wallet
            </button>
            <button className="icon-action" onClick={toggleSfx} aria-label={sfxEnabled ? 'Turn sound off' : 'Turn sound on'}>
              {sfxEnabled ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            </button>
          </div>
        </div>
      </section>

      <section className="wallet-grid" aria-label="Wallet dashboard">
        <div className="balance-panel">
          <div className="panel-topline">
            <span>Balance</span>
            <span className={`live-pill live-${socketStatus}`}>
              <Radio aria-hidden />
              {getSocketLabel(socketStatus)}
            </span>
          </div>
          <div className="balance-main">
            {addressState != null ? formatDogeWithUnit(addressState.finalBalance) : '0 DOGE'}
          </div>
          <div className="balance-subgrid">
            <div>
              <span>Spendable</span>
              <strong>{formatDogeWithUnit(spendableBalance)}</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong>{addressState != null ? formatDogeWithUnit(addressState.unconfirmedBalance) : '0 DOGE'}</strong>
            </div>
            <div>
              <span>UTXOs</span>
              <strong>{utxos.length}</strong>
            </div>
          </div>
          <div className={`status-strip status-${status.kind}`}>{status.text}</div>
        </div>

        <div className="address-panel">
          <div className="panel-topline">
            <span>Receive Address</span>
            <button className="text-icon-button" onClick={() => setShowAddress(value => !value)}>
              {showAddress ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {showAddress ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="address-box">
            <code>{identity == null ? 'Connect wallet to derive DOGE address' : showAddress ? identity.address : 'D******************************'}</code>
            <button className="icon-action compact" onClick={copyAddress} disabled={identity == null} aria-label="Copy address">
              <Copy aria-hidden />
            </button>
          </div>
        </div>
      </section>

      <section className="action-layout">
        <div className="mode-panel">
          <div className="segmented-control" role="tablist" aria-label="Wallet mode">
            <button
              className={mode === 'send' ? 'selected' : ''}
              role="tab"
              aria-selected={mode === 'send'}
              onClick={() => {
                setMode('send')
                playSfx('toggle', sfxEnabled)
              }}
            >
              <Send aria-hidden />
              Send
            </button>
            <button
              className={mode === 'receive' ? 'selected' : ''}
              role="tab"
              aria-selected={mode === 'receive'}
              onClick={() => {
                setMode('receive')
                playSfx('toggle', sfxEnabled)
              }}
            >
              <ArrowDownLeft aria-hidden />
              Receive
            </button>
          </div>

          {mode === 'send' ? (
            <form className="send-form" onSubmit={reviewSend}>
              <label>
                <span>Send to</span>
                <input
                  value={sendForm.to}
                  onChange={event => {
                    setSendPreview(null)
                    setSendForm(current => ({ ...current, to: event.target.value }))
                  }}
                  placeholder="D..."
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Amount</span>
                <div className="amount-input">
                  <input
                    value={sendForm.amount}
                    onChange={event => {
                      setSendPreview(null)
                      setSendForm(current => ({ ...current, amount: event.target.value }))
                    }}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                  <strong>DOGE</strong>
                </div>
              </label>
              <div className="fee-note">
                <ShieldCheck aria-hidden />
                Fee policy is simple: 0.01 DOGE/kB, with tiny change rolled into the fee.
              </div>
              <button className="primary-action full" disabled={isReviewing || isSending}>
                {isReviewing ? <Loader2 className="spin" aria-hidden /> : <Zap aria-hidden />}
                Review Send
              </button>
            </form>
          ) : (
            <div className="receive-panel">
              <div className="qr-shell" aria-label="Dogecoin receive QR code">
                {identity == null ? (
                  <div className="qr-placeholder">Connect</div>
                ) : (
                  <QRCodeSVG value={identity.address} size={320} bgColor="#ffffff" fgColor="#17130b" />
                )}
              </div>
              <p>
                Share this address to receive DOGE. The WebSocket listener will bark when new activity hits the explorer.
              </p>
              <button className="secondary-action" onClick={copyAddress} disabled={identity == null}>
                <Copy aria-hidden />
                Copy Address
              </button>
            </div>
          )}

          {sendPreview != null && (
            <div className="send-preview">
              <div className="preview-row">
                <span>Amount</span>
                <strong>{formatDogeWithUnit(sendPreview.amount)}</strong>
              </div>
              <div className="preview-row">
                <span>Network fee</span>
                <strong>{formatDogeWithUnit(sendPreview.plan.fee)}</strong>
              </div>
              <div className="preview-row">
                <span>Change</span>
                <strong>{formatDogeWithUnit(sendPreview.plan.change)}</strong>
              </div>
              <div className="preview-row">
                <span>Inputs</span>
                <strong>{sendPreview.plan.inputCount}</strong>
              </div>
              <button className="primary-action full" onClick={broadcastSend} disabled={isSending}>
                {isSending ? <Loader2 className="spin" aria-hidden /> : <ArrowUpRight aria-hidden />}
                Sign and Broadcast
              </button>
            </div>
          )}
        </div>

        <div className="tx-panel">
          <div className="panel-topline">
            <span>Transactions</span>
            <button
              className="text-icon-button"
              onClick={() => identity != null && refreshData(identity.address, true)}
              disabled={identity == null || isRefreshing}
            >
              {isRefreshing ? <Loader2 className="spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Sync
            </button>
          </div>
          {lastBroadcastTxid != null && (
            <a className="broadcast-link" href={dogeExplorerTxUrl(lastBroadcastTxid)} target="_blank" rel="noreferrer">
              <Check aria-hidden />
              Last broadcast {truncate(lastBroadcastTxid, 10, 10)}
              <ExternalLink aria-hidden />
            </a>
          )}
          <div className="tx-list">
            {txrefs.length === 0 ? (
              <div className="empty-state">
                <Wallet aria-hidden />
                <strong>No Dogecoin transactions yet.</strong>
                <span>Receive DOGE or connect a funded address to populate the list.</span>
              </div>
            ) : (
              txrefs.slice(0, 18).map((tx, index) => (
                <a
                  className="tx-row"
                  href={dogeExplorerTxUrl(tx.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  key={`${tx.txHash}-${tx.direction}-${index}`}
                >
                  <span className={`tx-icon ${tx.direction}`}>
                    {tx.direction === 'received' ? <ArrowDownLeft aria-hidden /> : <ArrowUpRight aria-hidden />}
                  </span>
                  <span>
                    <strong>{tx.direction === 'received' ? 'Received' : 'Sent'}</strong>
                    <small>{truncate(tx.txHash, 10, 8)}</small>
                  </span>
                  <span className="tx-amount">
                    {tx.direction === 'received' ? '+' : '-'}
                    {formatShibes(tx.value, 4)}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
