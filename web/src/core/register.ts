// Registering a name: commit, wait, reveal, as ENS does it.
//
// The commitment is a hash of the whole registration, secret included, so the
// relayer that carries it learns nothing it could register first. The
// controller will not take the reveal until the commitment is a minute old
// (and not after a day), measured by block time. On the ZVM a minute is four
// momentums or so.
//
// The pending registration is saved in this browser the moment its secret
// exists, keyed by chain, name and wallet: a reload, a closed tab or a crashed
// wallet in the middle of the wait resumes where it stopped, rather than
// spending the commitment's fee again or, worse, losing the secret that makes
// the reveal possible.

import {encodeFunctionData, toHex, zeroHash, type Address, type Hex} from 'viem'
import {publicResolverAbi, zNSControllerAbi} from '../abi'
import {chain} from './chain'
import {endpoint} from './endpoint'
import {nodeOf} from './names'
import {sendStep, type Step} from './tx'
import {rentPrice, zns} from './zns'
import {syncIndex} from './index'
import {primaries} from './zns'

export interface Registration {
  label: string
  owner: Address
  duration: bigint
  secret: Hex
  resolver: Address
  data: Hex[]
  reverseRecord: number
  referrer: Hex
}

interface Pending {
  reg: Omit<Registration, 'duration'> & {duration: string}
  commitment: Hex
  /** Block time of the commitment's block, once it executed. */
  committedAt: number | null
  commitTx: Hex | null
}

const MIN_AGE = 60
const MAX_AGE = 86_400

const storeKey = (label: string, owner: string) => `zns.pending.${endpoint.chainId}.${label}.${owner.toLowerCase()}`

export function loadPending(label: string, owner: string): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(storeKey(label, owner)) ?? 'null') as Pending | null
    if (!p) return null
    // Too old to reveal: the commitment has lapsed, and a new one is needed.
    if (p.committedAt && p.committedAt + MAX_AGE < (chain.timestamp ?? Date.now() / 1000)) {
      clearPending(label, owner)
      return null
    }
    return p
  } catch {
    return null
  }
}

function savePending(p: Pending) {
  try {
    localStorage.setItem(storeKey(p.reg.label, p.reg.owner), JSON.stringify(p))
  } catch {
    /* storage can be blocked: the flow still works if the tab stays open */
  }
}

export function clearPending(label: string, owner: string) {
  try {
    localStorage.removeItem(storeKey(label, owner))
  } catch {
    /* nothing to clear */
  }
}

const unpack = (p: Pending): Registration => ({...p.reg, duration: BigInt(p.reg.duration)})

export interface Choices {
  label: string
  owner: Address
  seconds: number
  /** Make this the wallet's primary name in the same transaction. */
  primary: boolean
}

/** A registration that points the name at its owner, and optionally names the
 *  owner back, all inside the reveal. */
export function buildRegistration(c: Choices): Registration {
  const {d} = zns()
  const node = nodeOf(`${c.label}.znn`)
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)))
  return {
    label: c.label,
    owner: c.owner,
    duration: BigInt(c.seconds),
    secret,
    resolver: d.contracts.PublicResolver,
    data: [encodeFunctionData({abi: publicResolverAbi, functionName: 'setAddr', args: [node, c.owner]})],
    reverseRecord: c.primary ? 1 : 0,
    referrer: zeroHash,
  }
}

export const STEP_LABELS = (label: string) => [
  `Commit to ${label}.znn`,
  'Wait a minute, so nobody can take it first',
  `Register ${label}.znn`,
]

/**
 * Runs the whole registration, or the rest of one that stopped. `update`
 * receives the steps each time one moves; `tick` the seconds left while
 * waiting.
 */
export async function register(
  choices: Choices,
  update: (steps: Step[]) => void,
  tick: (secondsLeft: number) => void,
): Promise<boolean> {
  const {d, client} = zns()
  const labels = STEP_LABELS(choices.label)
  const steps: Step[] = labels.map((label) => ({label, state: 'queued'}))
  const emit = () => update(steps.map((s) => ({...s})))

  let pending = loadPending(choices.label, choices.owner)
  // A saved registration for a different term or primary choice is replaced,
  // unless its commitment already executed: then it is what gets revealed.
  if (pending && !pending.committedAt) {
    const same = pending.reg.duration === String(choices.seconds) && pending.reg.reverseRecord === (choices.primary ? 1 : 0)
    if (!same) pending = null
  }
  if (!pending) {
    const reg = buildRegistration(choices)
    const commitment = await client.readContract({
      address: d.contracts.ZNSController,
      abi: zNSControllerAbi,
      functionName: 'makeCommitment',
      args: [reg],
    })
    pending = {reg: {...reg, duration: String(reg.duration)}, commitment, committedAt: null, commitTx: null}
    savePending(pending)
  }
  const reg = unpack(pending)

  // 1. The commitment.
  if (pending.committedAt) {
    steps[0].state = 'done'
    steps[0].hash = pending.commitTx ?? undefined
  } else {
    emit()
    const ok = await sendStep(
      {
        to: d.contracts.ZNSController,
        data: encodeFunctionData({abi: zNSControllerAbi, functionName: 'commit', args: [pending.commitment]}),
        value: 0n,
        label: labels[0],
      },
      steps[0],
      emit,
    )
    if (!ok) return false
    const block = await client.getBlock({blockNumber: BigInt(steps[0].block!)})
    pending.committedAt = Number(block.timestamp)
    pending.commitTx = steps[0].hash ?? null
    savePending(pending)
  }

  // 2. The wait, by block time: the reveal is judged by the timestamp of the
  // block that runs it, which is at least the next one.
  steps[1].state = 'waiting'
  emit()
  const readyAt = pending.committedAt! + MIN_AGE + 1
  for (;;) {
    const now = Number((await client.getBlock({blockTag: 'latest'})).timestamp)
    const left = readyAt - now
    tick(Math.max(0, left))
    if (left <= 0) break
    steps[1].detail = `${left} s left`
    emit()
    await new Promise((r) => setTimeout(r, Math.min(3_000, left * 1000)))
  }
  steps[1].state = 'done'
  steps[1].detail = undefined
  emit()

  // 3. The reveal. The premium only falls while this waits, so today's price
  // is enough; a sliver is added for a price the owner might move meanwhile,
  // and the controller refunds whatever is over.
  const price = await rentPrice(reg.label, Number(reg.duration))
  const value = price.base + price.premium + (price.base + price.premium) / 200n
  const ok = await sendStep(
    {
      to: d.contracts.ZNSController,
      data: encodeFunctionData({abi: zNSControllerAbi, functionName: 'register', args: [reg]}),
      value,
      label: labels[2],
    },
    steps[2],
    emit,
  )
  if (!ok) {
    // A lapsed commitment cannot be revealed; start over next time.
    if (/CommitmentTooOld|CommitmentNotFound/.test(steps[2].detail ?? '')) clearPending(reg.label, reg.owner)
    return false
  }
  clearPending(reg.label, reg.owner)
  if (reg.reverseRecord) primaries.delete(reg.owner.toLowerCase())
  syncIndex()
  return true
}
