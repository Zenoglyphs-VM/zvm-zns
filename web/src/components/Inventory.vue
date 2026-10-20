<script setup lang="ts">
// The names an address holds, with its primary name first.
//
// For the connected wallet this is where names are managed in bulk: pick
// which one is the primary name (one transaction, the reverse record), renew
// several at once (one transaction, ENS's StaticBulkRenewal), and send any of
// them to Karum to sell. For anyone else it is a read-only shelf.
import {computed, ref, watch} from 'vue'
import type {Address} from 'viem'
import {index, namesOf, status as statusOf} from '../core/index'
import {primaries, primaryName, records, chainNow, YEAR, zns} from '../core/zns'
import {primaryCall, recordsCall, renewAllCall} from '../core/actions'
import {karumItem} from '../core/links'
import {nodeOf} from '../core/names'
import {useRun} from '../core/run'
import {same, term, znn} from '../core/format'
import {staticBulkRenewalAbi} from '../abi'
import NameCard from './NameCard.vue'
import Icon from './Icon.vue'
import InfoTip from './InfoTip.vue'
import Modal from './Modal.vue'
import StepRail from './StepRail.vue'
import Chip from '@zvm/web/components/Chip.vue'

const props = defineProps<{address: Address; editable: boolean}>()

type Sort = 'expiry' | 'name' | 'newest'
const sort = ref<Sort>('expiry')
const q = ref('')

const primary = computed(() => primaries.get(props.address.toLowerCase()) ?? null)
watch(() => props.address, (a) => a && primaryName(a), {immediate: true})

const all = computed(() => {
  void index.version
  const rows = namesOf(props.address)
  const f = q.value.trim().toLowerCase()
  const list = f ? rows.filter((r) => r.label!.includes(f)) : rows
  const by: Record<Sort, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
    expiry: (a, b) => a.expires - b.expires,
    name: (a, b) => a.label!.localeCompare(b.label!),
    newest: (a, b) => b.registeredAt - a.registeredAt,
  }
  // The primary name leads whatever the order.
  return [...list].sort((a, b) => Number(`${b.label}.znn` === primary.value) - Number(`${a.label}.znn` === primary.value) || by[sort.value](a, b))
})
const graceCount = computed(() => all.value.filter((r) => statusOf(r) === 'grace').length)

// --- selection and bulk renewal -----------------------------------------

const picked = ref(new Set<string>())
const toggle = (label: string) => {
  const s = new Set(picked.value)
  s.has(label) ? s.delete(label) : s.add(label)
  picked.value = s
}
const pickAll = () => (picked.value = new Set(all.value.map((r) => r.label!)))
const clearPick = () => (picked.value = new Set())

const run = useRun()
const renewing = ref(false)
const years = ref(1)
const bulkPrice = ref<bigint | null>(null)
watch([renewing, years, picked], async () => {
  if (!renewing.value || !picked.value.size) return
  bulkPrice.value = null
  const {d, client} = zns()
  bulkPrice.value = await client
    .readContract({address: d.contracts.StaticBulkRenewal, abi: staticBulkRenewalAbi, functionName: 'rentPrice', args: [[...picked.value], BigInt(years.value * YEAR)]})
    .catch(() => null)
})
async function renewPicked() {
  const labels = [...picked.value]
  const ok = await run.run(async () => [await renewAllCall(labels, years.value * YEAR)], `${labels.length} names renewed`)
  if (ok) {
    renewing.value = false
    clearPick()
  }
}

// --- the primary name -----------------------------------------------------

const switching = ref<string | null>(null)
async function makePrimary(label: string) {
  const full = `${label}.znn`
  switching.value = label
  try {
    const {d} = zns()
    const r = await records(nodeOf(full), d.contracts.PublicResolver)
    const calls = []
    // A name that does not point at its holder cannot be their primary name:
    // the reverse lookup checks both ways. Point it first, in the same run.
    if (!same(r.addr, props.address)) calls.push(recordsCall(full, d.contracts.PublicResolver, {addr: props.address})!)
    calls.push(primaryCall(full))
    if (await run.run(calls, `${full} is your primary name`)) {
      primaries.delete(props.address.toLowerCase())
      await primaryName(props.address, true)
    }
  } finally {
    switching.value = null
  }
}
async function clearPrimary() {
  if (await run.run([primaryCall('')], 'Primary name cleared')) {
    primaries.delete(props.address.toLowerCase())
    await primaryName(props.address, true)
  }
}

const now = computed(() => (void index.version, chainNow()))
</script>

<template>
  <div class="grid gap-4 grid-cols-[minmax(0,1fr)]">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-[17px] font-semibold">{{ editable ? 'Your names' : 'Names' }}</h2>
      <Chip tone="plain">{{ all.length }}</Chip>
      <InfoTip v-if="editable" text="Your primary name is what apps show instead of your address. Switch it with one transaction; renew several names in one." />
      <Chip v-if="graceCount" tone="warn" dot>{{ graceCount }} expired, renew to keep</Chip>
      <span class="grow" />
      <input v-model="q" class="input !w-[180px] !py-1.5 text-[13px]" placeholder="Filter" spellcheck="false" />
      <div class="seg text-[12.5px]" role="group" aria-label="Order">
        <button :class="{on: sort === 'expiry'}" @click="sort = 'expiry'">Expiring</button>
        <button :class="{on: sort === 'name'}" @click="sort = 'name'">A-Z</button>
        <button :class="{on: sort === 'newest'}" @click="sort = 'newest'">Newest</button>
      </div>
    </div>

    <div v-if="editable && all.length" class="card px-3 py-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span v-if="picked.size" class="font-medium">{{ picked.size }} selected</span>
      <span v-else class="text-dim">Select names to renew them together</span>
      <button class="btn btn-sm btn-quiet" @click="picked.size === all.length ? clearPick() : pickAll()">{{ picked.size === all.length ? 'Select none' : 'Select all' }}</button>
      <span class="grow" />
      <button v-if="primary" class="btn btn-sm btn-quiet" :disabled="run.busy.value" @click="clearPrimary">Clear primary name</button>
      <button class="btn btn-sm btn-plasma" :disabled="!picked.size || run.busy.value" data-testid="bulk-renew" @click="(run.reset(), (renewing = true))">
        <Icon name="clock" :size="13" /> Renew selected
      </button>
    </div>

    <StepRail v-if="run.steps.value.length && !renewing" :steps="run.steps.value" />

    <div v-if="!index.synced" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <div v-for="i in 5" :key="i" class="skeleton aspect-[3/4]" />
    </div>
    <p v-else-if="!all.length" class="text-[14px] text-dim py-8 text-center">
      {{ q ? 'No names match.' : editable ? 'No names yet.' : 'This address holds no .znn names.' }}
      <router-link v-if="editable && !q" to="/" class="link">Find one</router-link>
    </p>
    <TransitionGroup v-else tag="div" name="list" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="inventory">
      <NameCard
        v-for="(r, i) in all"
        :key="r.id.toString()"
        :label="r.label!"
        :expires="r.expires"
        :index="i"
        :primary="`${r.label}.znn` === primary"
        :selectable="editable"
        :selected="picked.has(r.label!)"
        @toggle="toggle(r.label!)"
      >
        <div v-if="editable" class="flex gap-1.5 pt-1">
          <button
            v-if="`${r.label}.znn` !== primary && r.expires > now"
            class="btn btn-sm grow !px-2 !text-[12px]"
            :disabled="run.busy.value"
            :data-testid="`primary-${r.label}`"
            @click="makePrimary(r.label!)"
          >
            <Icon v-if="switching === r.label" name="refresh" :size="12" class="spin" />
            <Icon v-else name="star" :size="12" /> Primary
          </button>
          <a v-if="r.expires > now && karumItem(r.label!, true)" class="btn btn-sm grow !px-2 !text-[12px]" :href="karumItem(r.label!, true)!" target="_blank" rel="noopener" title="List it on Karum">
            <Icon name="tag" :size="12" /> Sell
          </a>
        </div>
      </NameCard>
    </TransitionGroup>

    <Modal :open="renewing" :title="`Renew ${picked.size} name${picked.size === 1 ? '' : 's'}`" :width="440" @close="!run.busy.value && (renewing = false)">
      <div class="p-4 grid gap-4">
        <div class="flex flex-wrap gap-1.5">
          <Chip v-for="l in picked" :key="l" tone="plain">{{ l }}.znn</Chip>
        </div>
        <div class="seg justify-self-start" role="group" aria-label="Years">
          <button :disabled="years <= 1" @click="years--"><Icon name="minus" :size="14" /></button>
          <span class="px-4 min-w-[110px] text-center font-semibold num">{{ term(years * YEAR) }}</span>
          <button :disabled="years >= 10" @click="years++"><Icon name="plus" :size="14" /></button>
        </div>
        <div class="flex justify-between text-[15px] font-semibold"><span>Total</span><span class="num">{{ bulkPrice !== null ? znn(bulkPrice, 4) : '-' }} ZNN</span></div>
        <p class="text-[12.5px] text-dim">One transaction for all of them.</p>
        <StepRail :steps="run.steps.value" />
        <button class="btn btn-plasma" :disabled="run.busy.value || bulkPrice === null" data-testid="bulk-renew-go" @click="renewPicked">Renew</button>
      </div>
    </Modal>
  </div>
</template>
