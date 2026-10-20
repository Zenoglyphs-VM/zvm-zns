// The state every form that sends transactions shares: the steps drawn by
// StepRail, whether it is busy, and a toast with the outcome.

import {ref} from 'vue'
import {allDone, runCalls, type Call, type Step} from './tx'
import {askToConnect, wallet, wrongChain, switchToChain} from './wallet'
import {toast} from './toast'
import {syncIndex} from './index'

export function useRun() {
  const steps = ref<Step[]>([])
  const busy = ref(false)

  /** Sends `calls` in order. Resolves true once every one executed. */
  async function run(calls: Call[] | (() => Promise<Call[]>), done?: string): Promise<boolean> {
    if (!wallet.address) {
      askToConnect()
      return false
    }
    if (wrongChain.value) await switchToChain()
    busy.value = true
    steps.value = []
    try {
      const list = typeof calls === 'function' ? await calls() : calls
      const result = await runCalls(list, (s) => (steps.value = s))
      const ok = allDone(result)
      if (ok && done) toast(done, 'good')
      // The page reads the chain once a minute; what this wallet just did is
      // read now, so its own change shows at once.
      if (ok) syncIndex()
      if (!ok) toast(result.find((s) => s.state === 'failed')?.detail ?? 'It did not go through.', 'bad')
      return ok
    } catch (err: any) {
      toast(err?.shortMessage ?? err?.message ?? String(err), 'bad')
      return false
    } finally {
      busy.value = false
    }
  }

  const reset = () => (steps.value = [])
  return {steps, busy, run, reset}
}
