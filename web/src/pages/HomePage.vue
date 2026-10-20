<script setup lang="ts">
// Search first: the one question a visitor brings is "is my name free, and
// what does it cost". The answer is drawn as they type, from the controller
// itself, so the price shown is the price charged.
import {computed, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {hasZns} from '../core/endpoint'
import {index, recent, auctions, labelFor, totals} from '../core/index'
import {isAddress, parse, tintOf} from '../core/names'
import {nameState, rentPrice, YEAR, type NameState} from '../core/zns'
import {compact, number, znn} from '../core/format'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'
import NameArt from '../components/NameArt.vue'
import NameCard from '../components/NameCard.vue'
import CometRing from '../components/CometRing.vue'
import Addr from '../components/Addr.vue'
import Chip from '@zvm/web/components/Chip.vue'

const router = useRouter()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const result = ref<NameState | null>(null)
const looking = ref(false)
const lookError = ref('')

const parsed = computed(() => parse(q.value))
const asAddress = computed(() => isAddress(q.value))

let seq = 0
let timer: number | undefined
watch([q, hasZns], () => {
  window.clearTimeout(timer)
  result.value = null
  lookError.value = ''
  const p = parsed.value
  if (!q.value.trim() || asAddress.value || p.problem || p.sub.length || !hasZns.value) {
    looking.value = false
    return
  }
  looking.value = true
  const mine = ++seq
  timer = window.setTimeout(async () => {
    try {
      const s = await nameState(p.label)
      if (mine === seq) result.value = s
    } catch (err: any) {
      if (mine === seq) lookError.value = err?.shortMessage ?? err?.message ?? String(err)
    } finally {
      if (mine === seq) looking.value = false
    }
  }, 220)
})

function submit() {
  const s = q.value.trim()
  if (!s) return
  if (asAddress.value) router.push(`/address/${s}`)
  else router.push(`/name/${parsed.value.full}`)
}

const statusWord = {
  available: 'Available',
  auction: 'Available at a premium',
  registered: 'Registered',
  grace: 'In its grace period',
  invalid: 'Not allowed',
} as const
const statusTone = {available: 'l2', auction: 'new', registered: 'plain', grace: 'warn', invalid: 'bad'} as const

// The rent table, read from the controller for a five-, four- and
// three-character name, so a price change by the owner shows here at once.
const tiers = ref<{len: string; example: string; yearly: bigint | null}[]>([
  {len: '5+ characters', example: 'zenon', yearly: null},
  {len: '4 characters', example: 'moon', yearly: null},
  {len: '3 characters', example: 'znn', yearly: null},
])
async function loadTiers() {
  if (!hasZns.value) return
  // Long placeholders, never registered, so only the base rent is in them.
  const probes = ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'zzqq', 'zqq']
  const got = await Promise.all(probes.map((p) => rentPrice(p, YEAR).catch(() => null)))
  tiers.value = tiers.value.map((t, i) => ({...t, yearly: got[i]?.base ?? null}))
}
onMounted(() => {
  input.value?.focus()
  loadTiers()
})
watch(hasZns, loadTiers)

const fresh = computed(() => (index.version, recent('registered', 12)))
const onAuction = computed(() => (index.version, auctions().slice(0, 6)))
const stats = computed(() => (index.version, totals()))
</script>

<template>
  <div class="grid gap-8 grid-cols-[minmax(0,1fr)]">
    <section class="relative pt-8 sm:pt-14 pb-2 text-center grid gap-6 justify-items-center grid-cols-[minmax(0,1fr)]">
      <!-- Three lights, ZVM green, NoM blue and plasma pink, orbiting the
           title and the search a third of a turn apart on one slow ellipse. -->
      <div class="hero-orbit" aria-hidden="true">
        <span class="spot spot-green" />
        <span class="spot spot-blue" />
        <span class="spot spot-pink" />
      </div>
      <h1 class="text-[34px] sm:text-[52px] leading-[1.05] font-semibold tracking-[-0.03em] max-w-[760px] rise-in">
        Your name on the <span class="plasma-text">ZVM</span>
      </h1>
      <form class="w-full max-w-[640px] rise-in" style="animation-delay: 80ms" role="search" @submit.prevent="submit">
        <!-- A comet circles the search, at a steady pace. -->
        <div class="search-well">
          <CometRing :radius="14" />
          <Icon name="search" :size="20" class="text-dim shrink-0" />
          <input
            ref="input"
            v-model="q"
            class="grow w-0 min-w-0 bg-transparent outline-none text-[19px] sm:text-[21px] font-medium placeholder:text-dim"
            placeholder="Search for a name"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            aria-label="Search for a name or an address"
            data-testid="search"
          />
          <span v-if="q && !asAddress && !parsed.sub.length" class="text-dim text-[19px] sm:text-[21px] -ml-1 hidden sm:inline">.znn</span>
          <button class="btn btn-plasma !px-4" type="submit" :disabled="!q.trim()">Search</button>
        </div>
      </form>

      <!-- The answer, as the name is typed. -->
      <div class="w-full max-w-[640px] min-h-[80px]">
        <Transition name="fade" mode="out-in">
          <div v-if="asAddress" key="addr" class="result">
            <Icon name="user" :size="18" class="text-dim" />
            <span class="grow text-left text-[14px]">Look up what <span class="mono">{{ q.trim().slice(0, 10) }}…</span> holds</span>
            <button class="btn btn-sm" @click="submit">Open <Icon name="arrow" :size="13" /></button>
          </div>
          <div v-else-if="q.trim() && parsed.problem" key="bad" class="result">
            <Icon name="alert" :size="18" style="color: var(--warn)" />
            <span class="grow text-left text-[14px]">{{ parsed.problem }}</span>
          </div>
          <div v-else-if="looking" key="look" class="result">
            <div class="skeleton w-14 h-14 rounded" />
            <div class="grow grid gap-2"><div class="skeleton h-4 w-40" /><div class="skeleton h-3 w-24" /></div>
          </div>
          <div v-else-if="lookError" key="err" class="result">
            <Icon name="alert" :size="18" style="color: var(--danger)" />
            <span class="grow text-left text-[13.5px]" style="color: var(--danger)">{{ lookError }}</span>
          </div>
          <router-link v-else-if="result" :key="result.label" :to="`/name/${result.full}`" class="result result-link" data-testid="result">
            <div class="w-14 h-14 rounded overflow-hidden shrink-0"><NameArt :label="result.label" :expires="result.expires" /></div>
            <div class="grow min-w-0 text-left grid gap-1">
              <div class="text-[18px] font-semibold truncate">
                {{ result.label }}<span :style="{color: tintOf(result.label)}">.znn</span>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <Chip :tone="statusTone[result.status]" dot>{{ statusWord[result.status] }}</Chip>
                <span v-if="result.status === 'available' || result.status === 'auction'" class="text-[13px] text-soft num">
                  {{ znn(result.yearly.base + result.yearly.premium, 2) }} ZNN
                  <span class="text-dim">for the first year</span>
                </span>
              </div>
            </div>
            <span class="btn btn-sm" :class="result.status === 'available' || result.status === 'auction' ? 'btn-plasma' : ''">
              {{ result.status === 'available' || result.status === 'auction' ? 'Register' : 'View' }}
              <Icon name="arrow" :size="13" />
            </span>
          </router-link>
        </Transition>
      </div>
    </section>

    <!-- Each number in its own colour: names in plasma pink, holders in NoM
         blue, burned ZNN in ZVM green. -->
    <section class="grid grid-cols-3 gap-3 max-w-[760px] w-full mx-auto">
      <div class="stat-tile"><b class="num" style="color: var(--new-ink)">{{ number(stats.active) }}</b><span class="ledger">Names</span></div>
      <div class="stat-tile"><b class="num" style="color: var(--nom-ink)">{{ number(stats.holders) }}</b><span class="ledger">Holders</span></div>
      <div class="stat-tile"><b class="num" style="color: var(--znn-ink)">{{ compact(Number(stats.paid / 10n ** 14n) / 1e4) }}</b><span class="ledger">ZNN burned</span></div>
    </section>

    <section class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h2 class="text-[17px] font-semibold">Just registered</h2>
        <InfoTip text="The newest names, straight from the controller's logs." />
        <span class="grow" />
        <router-link to="/explore" class="btn btn-sm btn-quiet">Explore <Icon name="arrow" :size="13" /></router-link>
      </div>
      <div v-if="!index.synced" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div v-for="i in 6" :key="i" class="skeleton aspect-[3/4]" />
      </div>
      <p v-else-if="!fresh.length" class="text-[14px] text-dim py-6 text-center">No names yet. The first one is yours to take.</p>
      <div v-else class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <NameCard v-for="(e, i) in fresh.slice(0, 6)" :key="e.tx" :label="labelFor(e.id) ?? '?'" :expires="e.expires ?? 0" :index="i">
          <div class="text-[11.5px] text-dim truncate">by <Addr :address="e.to" /></div>
        </NameCard>
      </div>
    </section>

    <section v-if="onAuction.length" class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h2 class="text-[17px] font-semibold">Back from expiry</h2>
        <InfoTip text="Names nobody renewed, out of their 90-day grace. Each is priced at a premium that halves every day and is gone after 21." />
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <NameCard v-for="(r, i) in onAuction" :key="r.id.toString()" :label="r.label!" :expires="r.expires" :index="i" />
      </div>
    </section>

    <section class="shelf grid gap-4">
      <div class="flex items-center gap-2">
        <h2 class="text-[17px] font-semibold">What a name costs</h2>
        <InfoTip text="Rent by the year, by length, in ENS's ratios, burned as it is paid. Anyone may renew any name. A name that lapses is held 90 days for its holder, then returns at a premium that falls to zero over 21 days." />
      </div>
      <div class="grid sm:grid-cols-3 gap-3">
        <div v-for="t in tiers" :key="t.len" class="card px-4 py-3.5 grid gap-1">
          <span class="ledger">{{ t.len }}</span>
          <span class="text-[22px] font-semibold num">{{ t.yearly === null ? '-' : znn(t.yearly, 2) }} <span class="text-[14px] text-dim font-normal">ZNN / year</span></span>
          <span class="text-[13px] text-dim">{{ t.example }}<span :style="{color: tintOf(t.example)}">.znn</span></span>
        </div>
      </div>
      <p class="text-[13px] text-dim">
        Names of up to six characters opened with a launch premium that halves daily until it is gone.
      </p>
    </section>
  </div>
</template>

<style scoped>
.search-well {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 18px;
  border-radius: 14px;
  background: var(--surface-glass);
  border: 1px solid var(--line-strong);
  box-shadow: var(--edge), var(--shadow-pop);
  transition:
    border-color 200ms var(--ease),
    box-shadow 200ms var(--ease);
}
.search-well input:focus-visible {
  outline: none;
}
.search-well:focus-within {
  border-color: color-mix(in srgb, var(--znn) 55%, transparent);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--znn) 12%, transparent),
    var(--shadow-pop);
}
.result {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-glass);
  border: 1px solid var(--line);
  box-shadow: var(--edge);
}
.result-link {
  transition:
    transform 200ms var(--ease),
    border-color 200ms var(--ease);
}
.result-link:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--znn) 40%, transparent);
}
.stat-tile {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 12px;
}
.stat-tile b {
  font-size: 24px;
  font-weight: 600;
}
.hero-orbit {
  position: absolute;
  left: 50%;
  top: 96px;
  width: 0;
  height: 0;
  z-index: -1;
  pointer-events: none;
}
@media (min-width: 640px) {
  .hero-orbit {
    top: 128px;
  }
}
/* Each light's position on the ellipse is an angle, registered so the
   browser can animate it and then place the light with cos() and sin(). A
   plain rotate() would carry the light round a circle and spin its gradient
   with it; this keeps the light upright and the path wide and shallow, the
   shape of the title and the bar it circles. */
@property --orbit {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes orbit {
  to {
    --orbit: 360deg;
  }
}
.spot {
  position: absolute;
  width: 380px;
  height: 260px;
  margin: -130px 0 0 -190px;
  border-radius: 50%;
  filter: blur(34px);
  --rx: min(300px, 34vw);
  --ry: 74px;
  translate: calc(cos(var(--orbit)) * var(--rx)) calc(sin(var(--orbit)) * var(--ry));
  animation: orbit 32s linear infinite;
}
.spot-green {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--znn) 30%, transparent), transparent);
}
.spot-blue {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--nom) 34%, transparent), transparent);
  /* A third of a turn behind the green, and the pink a third behind that, so
     the three stay evenly spaced round the title. */
  animation-delay: -10.667s;
}
.spot-pink {
  background: radial-gradient(closest-side, color-mix(in srgb, var(--new) 26%, transparent), transparent);
  animation-delay: -21.333s;
}
</style>
