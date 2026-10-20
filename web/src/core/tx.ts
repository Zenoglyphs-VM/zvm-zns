// Sending calls from the connected wallet, and knowing when they landed.
//
// The wallet signs an ordinary EIP-1559 transaction. The node hands it to a
// relayer, which posts it to NoM; it becomes a ZVM transaction once the
// momentum carrying it is derived. That is why a step here has a state between
// "sent" and "confirmed" that an ordinary chain does not: the transaction has
// been ordered, and is waiting to be executed.

import {reactive} from 'vue'
import type {Address, Hash, Hex} from 'viem'
import {estimateFees, publicClient, walletClient} from '@zvm/web/evm'
import {endpoint} from './endpoint'
import {wallet} from './wallet'

/** One transaction a flow needs, with the words a person reads while it runs. */
export interface Call {
  to: Address
  data: Hex
  value: bigint
  label: string
}

/** A step that is a wallet signature, not a transaction. */
export interface SignStep {
  label: string
  run: () => Promise<void>
}

export type StepState = 'queued' | 'signing' | 'ordered' | 'waiting' | 'done' | 'failed'

export interface Step {
  label: string
  state: StepState
  hash?: Hash
  detail?: string
  /** A signature step: it is never ordered or executed, only signed. */
  signature?: boolean
  /** The block that executed it. */
  block?: number
}

export const STEP_WORD: Record<StepState, string> = {
  queued: 'Next',
  signing: 'Waiting for your wallet',
  ordered: 'Ordered by NoM',
  waiting: 'Waiting',
  done: 'Executed',
  failed: 'Failed',
}

export const reason = (err: any): string => {
  const s = err?.shortMessage ?? err?.details ?? err?.message ?? String(err)
  // Wallets all phrase a rejection differently, and none of them phrase it well.
  if (/user rejected|denied transaction|user denied/i.test(s)) return 'You dismissed the request in your wallet.'
  return s
}

const RECEIPT = {pollingInterval: 2_000, timeout: 600_000} as const

async function estimate(from: Address, call: Call): Promise<bigint> {
  const client = publicClient(endpoint.chainId!)
  const est = await client.estimateGas({account: from, to: call.to, data: call.data, value: call.value})
  return (est * 13n) / 10n
}

/**
 * Runs calls in order, waiting for each receipt, because a wallet estimates the
 * next transaction against the chain as it is: setting an address and then a
 * primary name that depends on it is two momentums, and pretending otherwise
 * is what makes the second one revert.
 */
export async function runCalls(calls: Call[], update: (steps: Step[]) => void, sign?: SignStep): Promise<Step[]> {
  const chainId = endpoint.chainId
  if (chainId === null) throw new Error('No node connected.')
  const steps: Step[] = calls.map((c) => ({label: c.label, state: 'queued'}))
  if (sign) steps.push({label: sign.label, state: 'queued', signature: true})
  const emit = () => update(steps.map((s) => ({...s})))
  emit()
  if (!wallet.address || !wallet.provider) throw new Error('Connect a wallet first.')

  for (const [i, call] of calls.entries()) {
    if (!(await sendStep(call, steps[i], emit))) return steps
  }
  if (sign) {
    const step = steps[steps.length - 1]
    try {
      step.state = 'signing'
      emit()
      await sign.run()
      step.state = 'done'
      emit()
    } catch (err) {
      step.state = 'failed'
      step.detail = reason(err)
      emit()
    }
  }
  return steps
}

/**
 * Sends one call from the connected wallet and waits for it to execute,
 * moving `step` through signing, ordered and done (or failed). Returns
 * whether it executed.
 */
export async function sendStep(call: Call, step: Step, emit: () => void): Promise<boolean> {
  const chainId = endpoint.chainId
  const from = wallet.address
  if (chainId === null || !from || !wallet.provider) {
    step.state = 'failed'
    step.detail = 'Connect a wallet first.'
    emit()
    return false
  }
  const client = publicClient(chainId)
  const signer = walletClient(wallet.provider, chainId, from)
  try {
    step.state = 'signing'
    emit()
    const [gas, fees] = await Promise.all([estimate(from, call), estimateFees(chainId)])
    const hash = await signer.sendTransaction({to: call.to, data: call.data, value: call.value, gas, ...fees})
    step.hash = hash
    step.state = 'ordered'
    emit()
    record({hash, label: call.label, chainId, at: Date.now(), state: 'ordered'})
    const r = await client.waitForTransactionReceipt({hash, ...RECEIPT})
    if (r.status !== 'success') throw new Error('The ZVM reverted this transaction.')
    step.state = 'done'
    step.block = Number(r.blockNumber)
    emit()
    record({hash, label: call.label, chainId, at: Date.now(), state: 'done'})
    return true
  } catch (err) {
    step.state = 'failed'
    step.detail = reason(err)
    emit()
    if (step.hash) record({hash: step.hash, label: call.label, chainId, at: Date.now(), state: 'failed'})
    return false
  }
}

export const allDone = (steps: Step[]) => steps.length > 0 && steps.every((s) => s.state === 'done')

/** The last transaction hash a run produced, for reading what it created. */
export const lastHash = (steps: Step[]) => [...steps].reverse().find((s) => s.hash)?.hash ?? null

// --- what this browser has sent --------------------------------------------

export interface Sent {
  hash: Hash
  label: string
  chainId: number
  at: number
  state: 'ordered' | 'done' | 'failed'
}

const ACTIVITY_KEY = 'zns.activity'
const ACTIVITY_MAX = 25

export const activity = reactive<{items: Sent[]}>({items: readActivity()})

function readActivity(): Sent[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function record(entry: Sent) {
  const rest = activity.items.filter((a) => a.hash !== entry.hash)
  activity.items = [entry, ...rest].slice(0, ACTIVITY_MAX)
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity.items))
  } catch {
    /* storage can be blocked; the list still holds for this tab */
  }
}

export function clearActivity() {
  activity.items = []
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    /* nothing to clear */
  }
}
