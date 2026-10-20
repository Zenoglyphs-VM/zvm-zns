<script setup lang="ts">
// Every name, from the logs: what just happened, what is coming back at a
// premium, what is about to lapse, and the whole directory.
import {computed, ref} from 'vue'
import {index, recent, auctions, expiringSoon, labelFor, status as statusOf} from '../core/index'
import {chainNow, DAY, GRACE, PREMIUM_DAYS} from '../core/zns'
import {explorer} from '../core/links'
import {ago, date, span, znn} from '../core/format'
import NameCard from '../components/NameCard.vue'
import Addr from '../components/Addr.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'
import Chip from '@zvm/web/components/Chip.vue'

type Tab = 'activity' | 'auctions' | 'expiring' | 'all'
const tab = ref<Tab>('activity')
const q = ref('')

const activity = computed(() => (index.version, recent(null, 100)))
const back = computed(() => (index.version, auctions()))
const soon = computed(() => (index.version, expiringSoon(30)))
const everything = computed(() => {
  void index.version
  const f = q.value.trim().toLowerCase()
  return [...index.rows.values()]
    .filter((r) => r.label && statusOf(r) !== 'released' && (!f || r.label.includes(f)))
    .sort((a, b) => a.label!.length - b.label!.length || a.label!.localeCompare(b.label!))
})

const word = {registered: 'Registered', renewed: 'Renewed', sold: 'Changed hands'} as const
const tone = {registered: 'l2', renewed: 'l1', sold: 'new'} as const

// Where a returning name's premium stands, by the oracle's curve: halved each
// day from its start, less the 21-day remainder.
function premiumLeft(expires: number): number {
  const elapsed = chainNow() - (expires + GRACE)
  return Math.max(0, PREMIUM_DAYS * DAY - elapsed)
}
</script>

<template>
  <div class="grid gap-5 grid-cols-[minmax(0,1fr)]">
    <div class="tabbar tab-shelf">
      <button :class="{on: tab === 'activity'}" @click="tab = 'activity'">Activity</button>
      <button :class="{on: tab === 'auctions'}" @click="tab = 'auctions'">Back from expiry <span class="count">{{ back.length }}</span></button>
      <button :class="{on: tab === 'expiring'}" @click="tab = 'expiring'">Expiring soon <span class="count">{{ soon.length }}</span></button>
      <button :class="{on: tab === 'all'}" @click="tab = 'all'">All names <span class="count">{{ everything.length }}</span></button>
    </div>

    <section v-if="tab === 'activity'" class="shelf">
      <p v-if="!index.synced" class="text-dim text-[14px]">Reading the chain…</p>
      <p v-else-if="!activity.length" class="text-dim text-[14px] py-6 text-center">Nothing has happened yet.</p>
      <table v-else class="w-full text-[13.5px]">
        <thead>
          <tr><th class="th text-left">Name</th><th class="th text-left">What</th><th class="th text-left hidden sm:table-cell">Who</th><th class="th text-right">Paid</th><th class="th text-right">When</th></tr>
        </thead>
        <TransitionGroup tag="tbody" name="list">
          <tr v-for="e in activity" :key="e.tx + e.kind + e.id">
            <td class="td"><router-link class="link font-medium" :to="`/name/${labelFor(e.id)}.znn`">{{ labelFor(e.id) }}.znn</router-link></td>
            <td class="td"><Chip :tone="tone[e.kind]" dot>{{ word[e.kind] }}</Chip></td>
            <td class="td hidden sm:table-cell">
              <span v-if="e.kind === 'sold'"><Addr :address="e.from" /> → <Addr :address="e.to" /></span>
              <Addr v-else-if="e.to" :address="e.to" />
              <span v-else class="text-dim">until {{ date(e.expires) }}</span>
            </td>
            <td class="td text-right num">{{ e.cost ? `${znn(e.cost, 2)} ZNN` : '-' }}</td>
            <td class="td text-right text-dim whitespace-nowrap">
              {{ ago(e.time) }}
              <a v-if="explorer(`/tx/${e.tx}`)" class="link ml-1" :href="explorer(`/tx/${e.tx}`)!" target="_blank" rel="noopener"><Icon name="external" :size="12" /></a>
            </td>
          </tr>
        </TransitionGroup>
      </table>
    </section>

    <section v-else-if="tab === 'auctions'" class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h2 class="text-[15px] font-semibold">Back from expiry</h2>
        <InfoTip text="Out of their 90-day grace and priced at a premium that halves every day. Whoever pays first gets it; waiting makes it cheaper, and riskier." />
      </div>
      <p v-if="!back.length" class="text-dim text-[14px] py-6 text-center">No names are coming back right now.</p>
      <div v-else class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <NameCard v-for="(r, i) in back" :key="r.id.toString()" :label="r.label!" :expires="r.expires" :index="i">
          <div class="text-[12px]" style="color: var(--new-ink)">Premium ends in {{ span(premiumLeft(r.expires)) }}</div>
        </NameCard>
      </div>
    </section>

    <section v-else-if="tab === 'expiring'" class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h2 class="text-[15px] font-semibold">Expiring within 30 days</h2>
        <InfoTip text="Anyone may renew any name, so a friend's name can be kept alive as a gift." />
      </div>
      <p v-if="!soon.length" class="text-dim text-[14px] py-6 text-center">Nothing expires in the next 30 days.</p>
      <div v-else class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <NameCard v-for="(r, i) in soon" :key="r.id.toString()" :label="r.label!" :expires="r.expires" :index="i" />
      </div>
    </section>

    <section v-else class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <input v-model="q" class="input !w-[240px]" placeholder="Filter names" spellcheck="false" />
        <span class="grow" />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <NameCard v-for="(r, i) in everything.slice(0, 120)" :key="r.id.toString()" :label="r.label!" :expires="r.expires" :index="i">
          <div class="text-[11.5px] text-dim truncate"><Addr :address="r.holder" /></div>
        </NameCard>
      </div>
      <p v-if="everything.length > 120" class="text-[12.5px] text-dim">Showing the first 120 of {{ everything.length }}. Filter to find the rest.</p>
    </section>
  </div>
</template>

<style scoped>
/* The tabs on the same translucent box as the sections under them. */
.tab-shelf {
  border: 1px solid color-mix(in srgb, var(--fg) 11%, transparent);
  border-radius: calc(var(--radius) + 4px);
  background: color-mix(in srgb, var(--fg) 6%, transparent);
  backdrop-filter: blur(6px);
  padding: 0 16px;
}
</style>
