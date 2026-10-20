// The chain's heartbeat.
//
// One NoM momentum orders exactly one ZVM block, so this chain does not have a
// mempool that drains continuously: it has a beat, measured at about fifteen
// seconds on the devnets. Everything that looks slow about a purchase here follows
// from that, so the beat is tracked once, in one place, and drawn under the
// header where a person can see what they are waiting for.

import {reactive, watch} from 'vue'
import {endpoint, reachable} from './endpoint'
import {publicClient} from '@zvm/web/evm'

export interface ChainState {
  chainId: number | null
  head: number | null
  /** Unix seconds of the head block. */
  timestamp: number | null
  baseFee: bigint | null
  /** Measured seconds between the last few blocks, not the nominal ten. */
  interval: number
  /** Wall clock (ms) when the head last changed. */
  landedAt: number
  /** Wall clock (ms) of the last poll, and the gap to the next: the pulse
   *  under the header fills across it. */
  polledAt: number
  pollMs: number
  error: string | null
}

export const chain = reactive<ChainState>({
  chainId: null,
  head: null,
  timestamp: null,
  baseFee: null,
  interval: 15,
  landedAt: Date.now(),
  polledAt: Date.now(),
  pollMs: 60_000,
  error: null,
})

/** Called once per new block, by whoever wants to refresh on the beat. */
const onBlockListeners = new Set<(head: number) => void>()

export function onBlock(fn: (head: number) => void): () => void {
  onBlockListeners.add(fn)
  return () => onBlockListeners.delete(fn)
}

let timer: number | undefined
let lastSeen = 0
const gaps: number[] = []

// A hidden tab does not poll. Every page refreshes on the beat, so a
// background tab left open all day was one block read every three seconds plus
// each page's own refetch on every block, for a screen nobody was looking at.
// Coming back polls at once, and the listeners catch the page up.
const hidden = () => typeof document !== 'undefined' && document.hidden

async function poll() {
  if (!reachable.value || endpoint.chainId === null || hidden()) return
  try {
    const client = publicClient(endpoint.chainId)
    // The height first, and the block only when it moved. cacheTime 0 because
    // viem otherwise caches the height for its polling interval.
    const number = await client.getBlockNumber({cacheTime: 0})
    chain.polledAt = Date.now()
    chain.chainId = endpoint.chainId
    chain.error = null
    if (Number(number) === lastSeen) return
    const block = await client.getBlock({blockNumber: number})
    const head = Number(block.number)
    chain.baseFee = block.baseFeePerGas ?? null
    if (head !== lastSeen) {
      // Blocks carry NoM's own timestamps, so the gap between two of them is
      // the momentum cadence rather than this browser's clock drift. A poll
      // a minute apart sees several blocks at once; the gap is per block.
      if (chain.timestamp && block.timestamp && lastSeen) {
        const gap = (Number(block.timestamp) - chain.timestamp) / Math.max(1, head - lastSeen)
        if (gap > 0 && gap < 120) {
          gaps.push(gap)
          if (gaps.length > 8) gaps.shift()
          chain.interval = gaps.reduce((a, b) => a + b, 0) / gaps.length
        }
      }
      lastSeen = head
      chain.head = head
      chain.timestamp = Number(block.timestamp)
      chain.landedAt = Date.now()
      onBlockListeners.forEach((fn) => fn(head))
    }
  } catch (err: any) {
    chain.error = err?.shortMessage ?? err?.message ?? String(err)
  }
}

export function startChainPolling(intervalMs = 60_000) {
  if (timer) return
  chain.pollMs = intervalMs
  poll()
  timer = window.setInterval(poll, intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll()
  })
}

// A new node is a new chain until proven otherwise: drop what the old one said
// rather than showing its head height under the new endpoint's name.
watch(
  () => endpoint.rpc,
  () => {
    lastSeen = 0
    gaps.length = 0
    chain.head = null
    chain.timestamp = null
    chain.baseFee = null
    chain.error = null
    poll()
  },
)
