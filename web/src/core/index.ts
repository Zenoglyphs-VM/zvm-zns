// Every .znn name, who holds it and until when, read from the registrar's
// and the controller's logs.
//
// ERC-721 has no "tokens of this owner", and ZNS has no server to keep that
// list, so the page keeps it: one pass over the logs from the deployment's
// first block, then only the new blocks each time the head moves. The
// registrar's own events carry everything: Transfer (who holds it),
// NameRegistered and NameRenewed (until when), LabelRecorded (what it is
// called). The controller's NameRegistered adds what was paid, premium
// included, for the recent-registrations list.
//
// Logs from op-reth carry `blockTimestamp`, so no block is read for a time.

import {reactive} from 'vue'
import {parseEventLogs, zeroAddress, type Address, type Hash} from 'viem'
import {zNSControllerAbi, zNSRegistrarAbi} from '../abi'
import {onBlock} from './chain'
import {GRACE, PREMIUM_DAYS, DAY, chainNow, setHolderLookup, zns} from './zns'

export interface NameRow {
  id: bigint
  label: string | null
  holder: Address
  expires: number
  /** When it was last registered, fresh: not a renewal or a sale. */
  registeredAt: number
  lastPaid: bigint | null
}

export type EventKind = 'registered' | 'renewed' | 'sold'

export interface NameEvent {
  kind: EventKind
  id: bigint
  from?: Address
  to?: Address
  /** What the controller was paid: rent plus any premium. */
  cost?: bigint
  premium?: bigint
  expires?: number
  block: number
  time: number
  tx: Hash
}

interface State {
  chainId: number | null
  synced: boolean
  /** The last block read. */
  head: number
  error: string | null
  rows: Map<string, NameRow>
  events: NameEvent[]
  version: number
}

export const index = reactive<State>({
  chainId: null,
  synced: false,
  head: 0,
  error: null,
  rows: new Map(),
  events: [],
  version: 0,
})

const key = (id: bigint) => id.toString(16)
const abi = [...zNSRegistrarAbi, ...zNSControllerAbi]

// The node answers a getLogs over at most 20,000 blocks; ask for less.
const SPAN = 10_000

let running: Promise<void> | null = null

export function syncIndex(): Promise<void> {
  if (running) return running
  running = step().finally(() => (running = null))
  return running
}

async function step() {
  let ctx
  try {
    ctx = zns()
  } catch {
    return
  }
  const {d, client} = ctx
  if (index.chainId !== d.chainId) reset(d.chainId)
  try {
    const head = Number(await client.getBlockNumber({cacheTime: 0}))
    let from = Math.max(index.head + 1, d.startBlock)
    while (from <= head) {
      const to = Math.min(from + SPAN - 1, head)
      const logs = await client.getLogs({
        address: [d.contracts.ZNSRegistrar, d.contracts.ZNSController],
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      })
      apply(parseEventLogs({abi, logs, strict: false}) as any[], d.contracts.ZNSRegistrar, d.contracts.ZNSController)
      index.head = to
      from = to + 1
    }
    index.synced = true
    index.error = null
    index.version++
  } catch (err: any) {
    index.error = err?.shortMessage ?? err?.message ?? String(err)
  }
}

function reset(chainId: number) {
  index.chainId = chainId
  index.synced = false
  index.head = 0
  index.rows = new Map()
  index.events = []
  index.version++
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function apply(logs: any[], registrar: Address, controller: Address) {
  for (const log of logs) {
    const time = Number(log.blockTimestamp ?? 0) || chainNow()
    const block = Number(log.blockNumber)
    const tx = log.transactionHash as Hash
    const a = log.args ?? {}
    if (same(log.address, registrar)) {
      if (log.eventName === 'Transfer') {
        const id = BigInt(a.tokenId)
        const row = rowOf(id)
        row.holder = a.to
        // A mint is the registration's own event; a transfer between two
        // holders is a sale or a gift, which the page shows as one.
        if (a.from !== zeroAddress && a.to !== zeroAddress && !same(a.from, controller)) {
          push({kind: 'sold', id, from: a.from, to: a.to, block, time, tx})
        }
      } else if (log.eventName === 'NameRegistered') {
        const id = BigInt(a.id)
        const row = rowOf(id)
        row.expires = Number(a.expires)
        row.registeredAt = time
      } else if (log.eventName === 'NameRenewed') {
        const id = BigInt(a.id)
        rowOf(id).expires = Number(a.expires)
      } else if (log.eventName === 'LabelRecorded') {
        rowOf(BigInt(a.id)).label = a.label
      }
    } else if (same(log.address, controller)) {
      if (log.eventName === 'NameRegistered') {
        const id = BigInt(a.labelhash)
        const row = rowOf(id)
        row.label ??= a.label
        row.lastPaid = BigInt(a.baseCost) + BigInt(a.premium)
        push({kind: 'registered', id, to: a.owner, cost: row.lastPaid, premium: BigInt(a.premium), expires: Number(a.expires), block, time, tx})
      } else if (log.eventName === 'NameRenewed') {
        const id = BigInt(a.labelhash)
        rowOf(id).label ??= a.label
        push({kind: 'renewed', id, cost: BigInt(a.cost), expires: Number(a.expires), block, time, tx})
      }
    }
  }
}

function rowOf(id: bigint): NameRow {
  const k = key(id)
  let row = index.rows.get(k)
  if (!row) {
    row = {id, label: null, holder: zeroAddress, expires: 0, registeredAt: 0, lastPaid: null}
    index.rows.set(k, row)
  }
  return row
}

function push(e: NameEvent) {
  index.events.push(e)
}

// --- questions the pages ask -------------------------------------------------

export const rowFor = (id: bigint) => index.rows.get(key(id)) ?? null
export const labelFor = (id: bigint) => rowFor(id)?.label ?? null

export function status(row: NameRow, now = chainNow()) {
  if (row.expires > now) return 'active' as const
  if (row.expires + GRACE > now) return 'grace' as const
  return 'released' as const
}

/** An address's names, live and in grace. Released ones are not theirs. */
export function namesOf(address: string): NameRow[] {
  const now = chainNow()
  return [...index.rows.values()].filter((r) => same(r.holder, address) && status(r, now) !== 'released' && r.label)
}

/** Names on their way back: out of grace, their premium still falling. */
export function auctions(): NameRow[] {
  const now = chainNow()
  return [...index.rows.values()]
    .filter((r) => r.label && r.expires + GRACE <= now && now < r.expires + GRACE + PREMIUM_DAYS * DAY)
    .sort((a, b) => a.expires - b.expires)
}

export function expiringSoon(days = 30): NameRow[] {
  const now = chainNow()
  return [...index.rows.values()]
    .filter((r) => r.label && r.expires > now && r.expires < now + days * DAY)
    .sort((a, b) => a.expires - b.expires)
}

export function recent(kind: EventKind | null = null, n = 20): NameEvent[] {
  const list = kind ? index.events.filter((e) => e.kind === kind) : index.events
  return list.slice(-n).reverse()
}

export function historyOf(id: bigint): NameEvent[] {
  return index.events.filter((e) => e.id === id).reverse()
}

export function totals() {
  const now = chainNow()
  let active = 0
  const holders = new Set<string>()
  for (const r of index.rows.values()) {
    if (status(r, now) === 'active') {
      active++
      holders.add(r.holder.toLowerCase())
    }
  }
  const paid = index.events.reduce((s, e) => s + (e.cost ?? 0n), 0n)
  return {active, holders: holders.size, paid, registrations: index.events.filter((e) => e.kind === 'registered').length}
}

// A name in grace has no ownerOf; its holder is the last Transfer's recipient.
setHolderLookup((id) => rowFor(id)?.holder ?? null)

let started = false
export function startIndex() {
  if (started) return
  started = true
  syncIndex()
  onBlock(() => syncIndex())
}
