<script setup lang="ts">
// The owner's one lever, for the wallet that holds it: the rate every price
// is converted at. There is no rent to collect: the controller burns it as it
// is paid (ZNSController.BURN).
import {computed, ref, watch} from 'vue'
import type {Address} from 'viem'
import {hasZns} from '../core/endpoint'
import {wallet} from '../core/wallet'
import {chain} from '../core/chain'
import {index, totals} from '../core/index'
import {feedAnswer, ownerOf} from '../core/zns'
import {feedCall} from '../core/actions'
import {useRun} from '../core/run'
import {same, znn} from '../core/format'
import Addr from '../components/Addr.vue'
import StepRail from '../components/StepRail.vue'
import InfoTip from '../components/InfoTip.vue'

const owner = ref<Address | null>(null)
const answer = ref<bigint | null>(null)
const multiplier = ref('1')

async function load() {
  if (!hasZns.value) return
  const [o, a] = await Promise.all([ownerOf('ZNSPriceFeed'), feedAnswer()])
  owner.value = o
  answer.value = a
}
watch([hasZns, () => chain.head], load, {immediate: true})

const burned = computed(() => (index.version, totals().paid))
const isOwner = computed(() => same(owner.value, wallet.address))
// The feed answers "oracle units per ZNN, times 1e8". A multiplier of 2 is an
// answer of 5e7, which doubles every price.
const current = computed(() => (answer.value ? 1e8 / Number(answer.value) : null))
const nextAnswer = computed(() => {
  const m = Number(multiplier.value)
  return m > 0 && isFinite(m) ? BigInt(Math.round(1e8 / m)) : null
})

const run = useRun()
const setFeed = async () => nextAnswer.value && (await run.run([feedCall(nextAnswer.value)], 'Prices changed')) && load()
</script>

<template>
  <div class="grid gap-5 max-w-[640px] mx-auto">
    <section class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h1 class="text-[20px] font-semibold">Owner</h1>
        <InfoTip text="Rent is burned as it is paid, so there is nothing to withdraw. The price feed sets what every price is multiplied by." />
      </div>
      <div class="flex justify-between text-[14px]"><span class="text-dim">Owner</span><Addr :address="owner" /></div>
      <div class="flex justify-between text-[14px]"><span class="text-dim">Rent burned</span><span class="num">{{ znn(burned, 4) }} ZNN</span></div>
      <div class="flex justify-between text-[14px]"><span class="text-dim">Price multiplier</span><span class="num">{{ current === null ? '-' : `${current}x` }}</span></div>
      <p v-if="!isOwner" class="text-[13px] text-dim">Only the owner's wallet can change the price.</p>
      <div v-else class="grid gap-2 border-t border-line pt-4">
        <label class="ledger" for="mult">New multiplier</label>
        <div class="flex gap-2">
          <input id="mult" v-model="multiplier" class="input num" inputmode="decimal" />
          <button class="btn btn-plasma" :disabled="run.busy.value || !nextAnswer" @click="setFeed">Set</button>
        </div>
        <p class="text-[12.5px] text-dim">Every rent and premium is multiplied by this. 2 doubles them; 0.5 halves them.</p>
      </div>
      <StepRail :steps="run.steps.value" />
    </section>
  </div>
</template>
