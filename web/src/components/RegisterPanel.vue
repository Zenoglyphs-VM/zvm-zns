<script setup lang="ts">
// Registering one name: how long, what it costs, and the three steps.
//
// The price is read from the controller for the chosen term, and again just
// before the reveal. A premium, when there is one, is shown with where it
// will be tomorrow, because waiting a day halves it and a person should be
// able to choose that.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {wallet, askToConnect, wrongChain, switchToChain} from '../core/wallet'
import {chain} from '../core/chain'
import {publicClient} from '@zvm/web/evm'
import {endpoint} from '../core/endpoint'
import {date, span, term, znn} from '../core/format'
import {DAY, YEAR, premiumAfter, premiumStart, primaryName, rentPrice, chainNow, type NameState, type Price} from '../core/zns'
import {clearPending, loadPending, register} from '../core/register'
import {toast} from '../core/toast'
import type {Step} from '../core/tx'
import Icon from './Icon.vue'
import InfoTip from './InfoTip.vue'
import StepRail from './StepRail.vue'

const props = defineProps<{name: NameState}>()
const emit = defineEmits<{(e: 'done'): void}>()

const years = ref(1)
const seconds = computed(() => years.value * YEAR)
const price = ref<Price | null>(null)
const tomorrow = ref<bigint | null>(null)
const primary = ref(true)
const hasPrimary = ref<string | null>(null)
const balance = ref<bigint | null>(null)
const steps = ref<Step[]>([])
const busy = ref(false)
const left = ref<number | null>(null)
const burst = ref(false)

async function loadPrice() {
  try {
    price.value = await rentPrice(props.name.label, seconds.value)
    const start = premiumStart(props.name.label, props.name.expires)
    if (price.value.premium > 0n && start) {
      const [t] = await premiumAfter([chainNow() - start + DAY])
      tomorrow.value = t
    } else tomorrow.value = null
  } catch {
    price.value = null
  }
}
watch(seconds, loadPrice)
// The premium falls every block; the quote follows it.
watch(() => chain.head, () => props.name.status === 'auction' && !busy.value && loadPrice())

async function loadWallet() {
  if (!wallet.address || endpoint.chainId === null) return
  hasPrimary.value = await primaryName(wallet.address)
  // A wallet that already has a primary name keeps it unless asked.
  primary.value = !hasPrimary.value
  balance.value = await publicClient(endpoint.chainId).getBalance({address: wallet.address})
}
watch(() => wallet.address, loadWallet)

const pending = ref(false)
function checkPending() {
  pending.value = !!(wallet.address && loadPending(props.name.label, wallet.address)?.committedAt)
}
watch(() => wallet.address, checkPending)

onMounted(() => {
  loadPrice()
  loadWallet()
  checkPending()
})

const total = computed(() => (price.value ? price.value.base + price.value.premium : null))
const short = computed(() => balance.value !== null && total.value !== null && balance.value < total.value)
const endDate = computed(() => chainNow() + seconds.value)

async function go() {
  if (!wallet.address) return askToConnect()
  if (wrongChain.value) await switchToChain()
  busy.value = true
  try {
    const ok = await register(
      {label: props.name.label, owner: wallet.address, seconds: seconds.value, primary: primary.value},
      (s) => (steps.value = s),
      (s) => (left.value = s),
    )
    if (ok) {
      burst.value = true
      toast(`${props.name.full} is yours`, 'good', {to: '/names', label: 'My names'})
      setTimeout(() => emit('done'), 1400)
    }
  } catch (err: any) {
    toast(err?.shortMessage ?? err?.message ?? String(err), 'bad')
  } finally {
    busy.value = false
  }
}

function startOver() {
  if (wallet.address) clearPending(props.name.label, wallet.address)
  pending.value = false
  steps.value = []
}

// The wait's ring: 60 s from the commitment, drawn as it empties.
const ring = computed(() => (left.value === null ? 0 : Math.max(0, Math.min(1, left.value / 61))))
let tick: number | undefined
onMounted(() => (tick = window.setInterval(() => left.value !== null && left.value > 0 && (left.value = left.value - 1), 1000)))
onUnmounted(() => window.clearInterval(tick))
</script>

<template>
  <section class="panel p-5 grid gap-5 relative overflow-hidden" data-testid="register">
    <div class="flex items-center gap-2">
      <h2 class="text-[17px] font-semibold">Register {{ name.full }}</h2>
      <InfoTip text="Two transactions a minute apart. The first commits to the name without revealing it, so nobody watching can take it first; the second registers it." />
    </div>

    <div class="grid sm:grid-cols-[auto_1fr] gap-4 items-center">
      <div class="seg" role="group" aria-label="Years">
        <button :disabled="years <= 1 || busy" aria-label="One year less" @click="years--"><Icon name="minus" :size="14" /></button>
        <span class="px-4 min-w-[110px] text-center font-semibold num" data-testid="years">{{ term(seconds) }}</span>
        <button :disabled="years >= 10 || busy" aria-label="One year more" @click="years++"><Icon name="plus" :size="14" /></button>
      </div>
      <div class="text-[13px] text-dim">until {{ date(endDate) }}</div>
    </div>

    <dl class="grid gap-2 text-[14px]">
      <div class="flex justify-between gap-3">
        <dt class="text-soft">Rent, {{ term(seconds) }}</dt>
        <dd class="num">{{ price ? znn(price.base, 4) : '-' }} ZNN</dd>
      </div>
      <div v-if="price && price.premium > 0n" class="flex justify-between gap-3">
        <dt class="text-soft flex items-center gap-1.5">
          Premium
          <InfoTip
            :text="`This name is coming back into circulation, so it carries a premium that halves every day. Tomorrow it will be about ${tomorrow !== null ? znn(tomorrow, 2) : '-'} ZNN.`"
          />
        </dt>
        <dd class="num" style="color: var(--new-ink)">{{ znn(price.premium, 4) }} ZNN</dd>
      </div>
      <div class="flex justify-between gap-3 border-t border-line pt-2 text-[16px] font-semibold">
        <dt>Total</dt>
        <dd class="num" data-testid="total">{{ total !== null ? znn(total, 4) : '-' }} ZNN</dd>
      </div>
      <p class="text-[12px] text-dim">Plus gas for two transactions, well under 0.1 ZNN. Anything paid over the price is sent back.</p>
    </dl>

    <label class="flex items-start gap-2.5 text-[14px] cursor-pointer">
      <input v-model="primary" type="checkbox" class="check mt-0.5" :disabled="busy" data-testid="primary" />
      <span>
        Make it my primary name
        <span v-if="hasPrimary" class="block text-[12.5px] text-dim">Your primary name is {{ hasPrimary }} now.</span>
      </span>
    </label>

    <p v-if="short" class="text-[13px]" style="color: var(--warn)">This wallet holds {{ znn(balance, 2) }} ZNN, less than the price.</p>

    <div v-if="pending && !steps.length" class="card p-3 text-[13px] flex items-center gap-3">
      <Icon name="clock" :size="16" style="color: var(--nom-ink)" />
      <span class="grow">You already committed to this name. Finishing reveals it; no second commitment is needed.</span>
      <button class="btn btn-sm btn-quiet" :disabled="busy" @click="startOver">Start over</button>
    </div>

    <button v-if="!wallet.address" class="btn btn-plasma !py-3 text-[15px]" @click="askToConnect()">Connect a wallet to register</button>
    <button v-else class="btn btn-plasma !py-3 text-[15px]" :disabled="busy || !price" data-testid="register-go" @click="go">
      <Icon v-if="busy" name="refresh" :size="15" class="spin" />
      {{ busy ? 'Registering' : pending ? 'Finish registering' : `Register for ${total !== null ? znn(total, 2) : '-'} ZNN` }}
    </button>

    <div v-if="steps.length" class="grid sm:grid-cols-[1fr_auto] gap-4 items-center">
      <StepRail :steps="steps" />
      <div v-if="left !== null && left > 0" class="relative grid place-items-center" aria-live="polite">
        <svg width="84" height="84" viewBox="0 0 84 84" class="-rotate-90">
          <circle cx="42" cy="42" r="36" fill="none" stroke="var(--line)" stroke-width="5" />
          <circle
            cx="42"
            cy="42"
            r="36"
            fill="none"
            stroke="var(--nom-ink)"
            stroke-width="5"
            stroke-linecap="round"
            :stroke-dasharray="226.2"
            :stroke-dashoffset="226.2 * (1 - ring)"
            style="transition: stroke-dashoffset 1s linear"
          />
        </svg>
        <span class="absolute text-[15px] font-semibold num">{{ span(left) }}</span>
      </div>
    </div>

    <div v-if="burst" class="burst" aria-hidden="true">
      <span v-for="i in 18" :key="i" class="burst-dot" :style="{'--a': `${i * 20}deg`, '--d': `${60 + (i % 3) * 30}px`}" />
    </div>
  </section>
</template>

<style scoped>
.burst {
  position: absolute;
  left: 50%;
  bottom: 60px;
  width: 0;
  height: 0;
  pointer-events: none;
}
.burst .burst-dot {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 99px;
  background: var(--znn);
  animation: burst-out 900ms var(--ease) forwards;
}
.burst .burst-dot:nth-child(3n) {
  background: var(--new);
}
.burst .burst-dot:nth-child(4n) {
  background: var(--nom-ink);
}
@keyframes burst-out {
  from {
    transform: rotate(var(--a)) translateX(0) scale(1);
    opacity: 1;
  }
  to {
    transform: rotate(var(--a)) translateX(var(--d)) scale(0.3);
    opacity: 0;
  }
}
</style>
