<script setup lang="ts">
// One name: register it if it is free, and otherwise everything about it.
//
// Two different people can act on a registered name, and the page keeps them
// apart the way the contracts do. The *holder* has the token: they renew
// (anyone may), send it, sell it on Karum. The *manager* has the registry
// node: they set its records and make subnames. They are the same wallet
// unless the holder handed management to someone else; a sale moves both
// (ZNSRegistrar note 3).
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {zeroAddress, type Address} from 'viem'
import {eNSRegistryAbi} from '../abi'
import {hasZns, endpoint} from '../core/endpoint'
import {wallet, askToConnect} from '../core/wallet'
import {chain} from '../core/chain'
import {index, historyOf} from '../core/index'
import {parse, nodeOf, tintOf, tierOf} from '../core/names'
import {
  GRACE,
  TEXT_KEYS,
  YEAR,
  chainNow,
  nameState,
  primaries,
  primaryName,
  records,
  rentPrice,
  subnamesOf,
  tokenMeta,
  zns,
  type NameState,
  type Records,
  type Subname,
  type TokenMeta,
} from '../core/zns'
import {
  deleteSubnameCall,
  primaryCall,
  reclaimCall,
  recordsCall,
  renewCall,
  subnameCalls,
  transferCall,
  useResolverCall,
} from '../core/actions'
import {expiryCalendar, explorer, karumItem} from '../core/links'
import {useRun} from '../core/run'
import {date, same, short, span, term, znn, ago} from '../core/format'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'
import Modal from '../components/Modal.vue'
import StepRail from '../components/StepRail.vue'
import NameArt from '../components/NameArt.vue'
import NameAvatar from '../components/NameAvatar.vue'
import Addr from '../components/Addr.vue'
import AddressInput from '../components/AddressInput.vue'
import RegisterPanel from '../components/RegisterPanel.vue'
import Chip from '@zvm/web/components/Chip.vue'

const route = useRoute()
const parsed = computed(() => parse(String(route.params.name ?? '')))
const isSub = computed(() => parsed.value.sub.length > 0)

const state = ref<NameState | null>(null)
const manager = ref<Address | null>(null)
const resolver = ref<Address | null>(null)
const rec = ref<Records | null>(null)
const meta = ref<TokenMeta | null>(null)
const subs = ref<Subname[]>([])
const listing = ref<{price: number; currency: string} | null>(null)
const loading = ref(true)
const error = ref('')

async function load(quiet = false) {
  const p = parsed.value
  if (p.problem || !hasZns.value) {
    loading.value = false
    return
  }
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const s = await nameState(p.label)
    state.value = s
    const {d, client} = zns()
    if (isSub.value) {
      const node = nodeOf(p.full)
      const [o, r] = await Promise.all([
        client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'owner', args: [node]}),
        client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'resolver', args: [node]}),
      ])
      manager.value = o === zeroAddress ? null : o
      resolver.value = r === zeroAddress ? null : r
    } else {
      manager.value = s.controller
      resolver.value = s.resolver
    }
    const [r, m, sn] = await Promise.all([
      records(nodeOf(p.full), resolver.value),
      s.status === 'registered' || s.status === 'grace' ? tokenMeta(s.id, s.expires) : Promise.resolve(null),
      s.status === 'registered' || s.status === 'grace' ? subnamesOf(p.full).catch(() => []) : Promise.resolve([]),
    ])
    rec.value = r
    meta.value = m
    subs.value = sn
    if (s.registrant) primaryName(s.registrant)
    if (!isSub.value && s.status === 'registered') loadListing(s.id)
  } catch (err: any) {
    error.value = err?.shortMessage ?? err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

// Karum's order book lives in the node, not on chain; a node without the API
// simply shows no listing.
async function loadListing(id: bigint) {
  listing.value = null
  if (!endpoint.apiBase) return
  try {
    const {d} = zns()
    const res = await fetch(`${endpoint.apiBase}/api/nft/items/${d.contracts.ZNSRegistrar}/${id}`, {signal: AbortSignal.timeout(6000)})
    if (!res.ok) return
    const item = await res.json()
    if (item?.listing) listing.value = {price: item.listing.priceNum, currency: item.listing.currency}
  } catch {
    /* no market on this node */
  }
}

watch(() => [route.params.name, hasZns.value], () => load(), {immediate: false})
onMounted(load)
// Registered by someone else while it was on screen, or renewed: the index
// moving is the cue to read again.
watch(() => index.version, () => state.value && !run.busy.value && load(true))

const me = computed(() => wallet.address)
const isHolder = computed(() => same(state.value?.registrant, me.value))
const isManager = computed(() => same(manager.value, me.value))
const ourResolver = computed(() => {
  try {
    return same(resolver.value, zns().d.contracts.PublicResolver)
  } catch {
    return false
  }
})
const live = computed(() => state.value?.status === 'registered' || state.value?.status === 'grace' || (isSub.value && !!manager.value))
const left = computed(() => (state.value ? state.value.expires - (chain.timestamp ?? chainNow()) : 0))
const holderPrimary = computed(() => (state.value?.registrant ? (primaries.get(state.value.registrant.toLowerCase()) ?? null) : null))
const isHoldersPrimary = computed(() => holderPrimary.value === parsed.value.full)
const myPrimary = computed(() => (me.value ? (primaries.get(me.value.toLowerCase()) ?? null) : null))
const pointsAtMe = computed(() => same(rec.value?.addr, me.value))
const pointsElsewhere = computed(() => !!rec.value?.addr && !!state.value?.registrant && !same(rec.value.addr, state.value.registrant))
const history = computed(() => (index.version, state.value ? historyOf(state.value.id) : []))
const texts = computed(() => TEXT_KEYS.filter((t) => t.key !== 'avatar' && rec.value?.texts[t.key]))

// --- actions ------------------------------------------------------------------

const run = useRun()
const dialog = ref<'' | 'records' | 'renew' | 'send' | 'sub' | 'primary'>('')
function open(which: typeof dialog.value) {
  if (!me.value) return askToConnect()
  run.reset()
  dialog.value = which
}
const close = () => {
  if (!run.busy.value) dialog.value = ''
}

async function after(ok: boolean) {
  if (!ok) return
  if (me.value) primaries.delete(me.value.toLowerCase())
  if (state.value?.registrant) primaries.delete(state.value.registrant.toLowerCase())
  await load(true)
}

// Records
const draft = ref<{addr: Address | null; texts: Record<string, string>}>({addr: null, texts: {}})
function openRecords() {
  draft.value = {addr: rec.value?.addr ?? null, texts: {...(rec.value?.texts ?? {})}}
  open('records')
}
const changes = computed(() => {
  const c: {addr?: Address | null; texts: Record<string, string>} = {texts: {}}
  if (!same(draft.value.addr, rec.value?.addr) && !(draft.value.addr === null && !rec.value?.addr)) c.addr = draft.value.addr
  for (const t of TEXT_KEYS) {
    const now = (draft.value.texts[t.key] ?? '').trim()
    if (now !== (rec.value?.texts[t.key] ?? '')) c.texts[t.key] = now
  }
  return c
})
const changeCount = computed(() => (changes.value.addr !== undefined ? 1 : 0) + Object.keys(changes.value.texts).length)
async function saveRecords() {
  const call = recordsCall(parsed.value.full, resolver.value!, changes.value)
  if (!call) return
  if (await run.run([call], 'Records saved')) {
    dialog.value = ''
    after(true)
  }
}
async function pointHere() {
  const call = recordsCall(parsed.value.full, resolver.value!, {addr: me.value!})
  after(await run.run([call!], `${parsed.value.full} points at you`))
}
async function adoptResolver() {
  after(await run.run([useResolverCall(parsed.value.full)], 'Resolver set'))
}

// Primary name
async function makePrimary() {
  if (!me.value) return askToConnect()
  const calls = []
  if (!pointsAtMe.value && isManager.value && ourResolver.value) calls.push(recordsCall(parsed.value.full, resolver.value!, {addr: me.value})!)
  calls.push(primaryCall(parsed.value.full))
  after(await run.run(calls, `${parsed.value.full} is your primary name`))
}

// Renew
const renewYears = ref(1)
const renewPrice = ref<bigint | null>(null)
watch([renewYears, dialog], async () => {
  if (dialog.value !== 'renew' || !state.value) return
  renewPrice.value = null
  renewPrice.value = (await rentPrice(state.value.label, renewYears.value * YEAR).catch(() => null))?.base ?? null
})
async function renew() {
  const ok = await run.run(async () => [await renewCall(state.value!.label, renewYears.value * YEAR)], `${parsed.value.full} renewed`)
  if (ok) dialog.value = ''
  after(ok)
}

// Send
const sendTo = ref<Address | null>(null)
async function send() {
  if (!sendTo.value || !state.value) return
  const ok = await run.run([transferCall(state.value.label, me.value!, sendTo.value)], `${parsed.value.full} sent`)
  if (ok) dialog.value = ''
  after(ok)
}
async function reclaim() {
  after(await run.run([reclaimCall(state.value!.label, me.value!)], 'You manage it again'))
}

// Subnames
const subLabel = ref('')
const subTarget = ref<Address | null>(null)
const subHand = ref(true)
const subProblem = computed(() => (subLabel.value && !/^[a-z0-9-]{1,63}$/.test(subLabel.value) ? 'Use a-z, 0-9 and "-"' : ''))
function openSub() {
  subLabel.value = ''
  subTarget.value = me.value ?? null
  subHand.value = true
  open('sub')
}
async function makeSub() {
  if (!subTarget.value || !subLabel.value || subProblem.value) return
  const ok = await run.run(subnameCalls(parsed.value.full, subLabel.value, subTarget.value, me.value!, subHand.value), `${subLabel.value}.${parsed.value.full} created`)
  if (ok) dialog.value = ''
  after(ok)
}
async function dropSub(s: Subname) {
  const label = s.full ? s.full.split('.')[0] : null
  if (!label) return
  after(await run.run([deleteSubnameCall(parsed.value.full, label)], `${s.full} deleted`))
}

function calendar() {
  if (!state.value) return
  const url = URL.createObjectURL(expiryCalendar(parsed.value.full, state.value.expires, location.href))
  const a = document.createElement('a')
  a.href = url
  a.download = `${parsed.value.full}-expiry.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const copied = ref('')
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = ''), 1200)
  } catch {
    /* the text stays on screen to select */
  }
}

const eventWord = {registered: 'Registered', renewed: 'Renewed', sold: 'Changed hands'} as const
const textHref = (key: string, v: string) =>
  key === 'url' ? (/^https?:\/\//.test(v) ? v : `https://${v}`) : key === 'email' ? `mailto:${v}` : key === 'com.twitter' ? `https://x.com/${v.replace(/^@/, '')}` : key === 'com.github' ? `https://github.com/${v}` : key === 'org.telegram' ? `https://t.me/${v.replace(/^@/, '')}` : null
</script>

<template>
  <div class="grid gap-6 grid-cols-[minmax(0,1fr)]">
    <!-- A name that cannot exist. -->
    <section v-if="parsed.problem" class="shelf grid gap-3 max-w-[640px] mx-auto w-full text-center py-10">
      <Icon name="alert" :size="28" class="mx-auto" style="color: var(--warn)" />
      <h1 class="text-[22px] font-semibold break-all">{{ parsed.input || 'Nothing' }} is not a .znn name</h1>
      <p class="text-dim">{{ parsed.problem }}</p>
      <router-link to="/" class="btn mx-auto">Search again</router-link>
    </section>

    <template v-else>
      <header class="flex flex-wrap items-end gap-x-4 gap-y-2 rise-in">
        <h1 class="text-[30px] sm:text-[40px] font-semibold tracking-[-0.03em] leading-none break-all" data-testid="title">
          <span v-if="isSub" class="text-soft">{{ parsed.sub.join('.') }}.</span>{{ parsed.label }}<span :style="{color: tintOf(parsed.label)}">.znn</span>
        </h1>
        <div v-if="state && !loading" class="flex items-center gap-2 pb-1 flex-wrap">
          <Chip v-if="state.status === 'registered'" tone="l2" dot>Registered</Chip>
          <Chip v-else-if="state.status === 'grace'" tone="warn" dot>Expired, in grace</Chip>
          <Chip v-else-if="state.status === 'auction'" tone="new" dot>Available at a premium</Chip>
          <Chip v-else-if="state.status === 'available'" tone="l2" dot>Available</Chip>
          <Chip v-if="!isSub" tone="plain">{{ tierOf(parsed.label) }}</Chip>
          <Chip v-if="isHoldersPrimary" tone="l1" dot>Primary name</Chip>
          <Chip v-if="listing" tone="new" dot>On sale on Karum</Chip>
        </div>
        <span class="grow" />
        <button class="btn btn-sm btn-quiet" :title="copied === parsed.full ? 'Copied' : 'Copy the name'" @click="copy(parsed.full)">
          <Icon :name="copied === parsed.full ? 'check' : 'copy'" :size="13" /> {{ copied === parsed.full ? 'Copied' : 'Copy' }}
        </button>
      </header>

      <p v-if="error" class="card px-4 py-3 text-[13px]" style="color: var(--danger)">{{ error }}</p>

      <div v-if="loading" class="grid lg:grid-cols-[380px_1fr] gap-6">
        <div class="skeleton aspect-square" />
        <div class="grid gap-3 content-start"><div class="skeleton h-40" /><div class="skeleton h-40" /></div>
      </div>

      <!-- Free, or back at a premium: register it. -->
      <div v-else-if="state && !isSub && (state.status === 'available' || state.status === 'auction')" class="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        <div class="panel overflow-hidden rise-in">
          <NameArt :label="parsed.label" :expires="chainNow() + YEAR" />
          <p class="px-4 py-3 text-[12.5px] text-dim">The card your name will carry, drawn on chain.</p>
        </div>
        <RegisterPanel :name="state" @done="load()" />
      </div>

      <!-- A subname nobody made. -->
      <section v-else-if="isSub && !manager" class="shelf text-center py-10 grid gap-3">
        <p class="text-[15px]">{{ parsed.full }} does not exist.</p>
        <router-link :to="`/name/${parsed.label}.znn`" class="btn mx-auto">Go to {{ parsed.label }}.znn</router-link>
      </section>

      <!-- Registered, or in its grace period, or a subname. -->
      <div v-else-if="state && live" class="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        <aside class="grid gap-4">
          <div class="panel overflow-hidden rise-in">
            <NameArt :label="parsed.label" :expires="state.expires" :src="isSub ? null : (meta?.image ?? null)" :dim="state.status === 'grace'" />
            <div class="p-4 grid gap-3 text-[13.5px]">
              <div v-if="!isSub" class="flex justify-between gap-3">
                <span class="text-dim flex items-center gap-1.5">Holder <InfoTip text="Holds the token: renews, sends, sells." /></span>
                <Addr :address="state.registrant" avatar />
              </div>
              <div v-if="isSub || !same(manager, state.registrant)" class="flex justify-between gap-3">
                <span class="text-dim flex items-center gap-1.5">Manager <InfoTip text="Controls the records and subnames." /></span>
                <Addr :address="manager" avatar />
              </div>
              <div v-if="!isSub" class="flex justify-between gap-3">
                <span class="text-dim">Expires</span>
                <span class="text-right" data-testid="expires">
                  {{ date(state.expires) }}
                  <span class="block text-[12px]" :style="{color: left < 0 ? 'var(--danger)' : left < 30 * 86400 ? 'var(--warn)' : 'var(--dim)'}">
                    {{ left > 0 ? `in ${span(left)}` : `${span(-left)} ago` }}
                  </span>
                </span>
              </div>
              <div v-if="state.status === 'grace'" class="text-[12.5px] rounded p-2.5" style="background: color-mix(in srgb, var(--warn) 10%, transparent); color: var(--warn)">
                Expired. Its holder can renew it until {{ date(state.expires + GRACE) }}; after that it returns to the pool at a premium.
              </div>
            </div>
            <div v-if="!isSub" class="border-t border-line p-3 grid grid-cols-2 gap-2">
              <button class="btn btn-sm" data-testid="renew" @click="open('renew')"><Icon name="clock" :size="13" /> {{ isHolder ? 'Renew' : 'Renew as a gift' }}</button>
              <button class="btn btn-sm" title="Reminders a month, a week and a day before it expires" @click="calendar"><Icon name="calendar" :size="13" /> Remind me</button>
              <template v-if="isHolder && state.status === 'registered'">
                <a v-if="karumItem(parsed.label, true)" class="btn btn-sm btn-plasma" :href="karumItem(parsed.label, true)!" target="_blank" rel="noopener" data-testid="sell">
                  <Icon name="tag" :size="13" /> {{ listing ? 'Change price' : 'Sell on Karum' }}
                </a>
                <button class="btn btn-sm" data-testid="send" @click="(sendTo = null), open('send')"><Icon name="send" :size="13" /> Send</button>
              </template>
              <a v-else-if="listing && karumItem(parsed.label)" class="btn btn-sm btn-plasma col-span-2" :href="karumItem(parsed.label)!" target="_blank" rel="noopener">
                <Icon name="cart" :size="13" /> Buy on Karum for {{ listing.price }} ZNN
              </a>
              <a v-else-if="karumItem(parsed.label)" class="btn btn-sm btn-quiet col-span-2" :href="karumItem(parsed.label)!" target="_blank" rel="noopener">
                <Icon name="external" :size="13" /> View on Karum
              </a>
            </div>
          </div>
          <div v-if="isHolder && !isManager && !isSub" class="card p-3 text-[13px] grid gap-2">
            <span>You hold this name, but {{ short(manager ?? '', 6, 4) }} manages its records.</span>
            <button class="btn btn-sm" :disabled="run.busy.value" @click="reclaim">Take back control</button>
          </div>
        </aside>

        <div class="grid gap-4 content-start">
          <!-- Who it points at, and whether it names them back. -->
          <section class="panel p-5 grid gap-4">
            <div class="flex items-center gap-3">
              <NameAvatar :record="rec?.texts.avatar" :owner="rec?.addr" :seed="rec?.addr ?? parsed.full" :size="56" />
              <div class="min-w-0 grow">
                <div class="ledger">Points at</div>
                <div v-if="rec?.addr" class="flex items-center gap-2 min-w-0">
                  <span class="mono text-[14px] truncate" data-testid="addr">{{ rec.addr }}</span>
                  <button class="icon-btn" :title="copied === rec.addr ? 'Copied' : 'Copy'" @click="copy(rec.addr)"><Icon :name="copied === rec.addr ? 'check' : 'copy'" :size="13" /></button>
                </div>
                <div v-else class="text-dim text-[14px]">Nothing yet</div>
                <p v-if="rec?.texts.description" class="text-[13.5px] text-soft mt-1">{{ rec.texts.description }}</p>
              </div>
            </div>

            <div v-if="pointsElsewhere && isManager" class="card p-3 text-[13px] flex flex-wrap items-center gap-3" style="border-color: color-mix(in srgb, var(--warn) 40%, transparent)">
              <Icon name="alert" :size="15" style="color: var(--warn)" />
              <span class="grow">This name still points at its previous holder. Point it at yourself so payments to it reach you.</span>
              <button class="btn btn-sm btn-plasma" :disabled="run.busy.value" @click="pointHere">Point it at me</button>
            </div>

            <div v-if="texts.length" class="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13.5px]">
              <div v-for="t in texts" :key="t.key" class="flex justify-between gap-3 min-w-0">
                <span class="text-dim shrink-0">{{ t.label }}</span>
                <a v-if="textHref(t.key, rec!.texts[t.key])" class="link truncate" :href="textHref(t.key, rec!.texts[t.key])!" target="_blank" rel="noopener noreferrer">{{ rec!.texts[t.key] }}</a>
                <span v-else class="truncate">{{ rec!.texts[t.key] }}</span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2 border-t border-line pt-4">
              <template v-if="isManager && ourResolver">
                <button class="btn btn-sm" data-testid="edit" :disabled="run.busy.value" @click="openRecords"><Icon name="pencil" :size="13" /> Edit records</button>
              </template>
              <button v-else-if="isManager && !resolver" class="btn btn-sm" :disabled="run.busy.value" @click="adoptResolver">Set up records</button>
              <button
                v-if="me && (pointsAtMe || (isManager && ourResolver)) && myPrimary !== parsed.full"
                class="btn btn-sm"
                data-testid="make-primary"
                :disabled="run.busy.value"
                @click="makePrimary"
              >
                <Icon name="star" :size="13" /> Make primary
              </button>
              <span v-else-if="myPrimary === parsed.full" class="text-[13px] flex items-center gap-1.5" style="color: var(--znn-ink)"><Icon name="check" :size="13" /> Your primary name</span>
              <span class="grow" />
              <a v-if="rec?.addr && explorer(`/address/${rec.addr}`)" class="btn btn-sm btn-quiet" :href="explorer(`/address/${rec.addr}`)!" target="_blank" rel="noopener">
                <Icon name="external" :size="13" /> Explorer
              </a>
            </div>
            <StepRail v-if="run.steps.value.length && !dialog" :steps="run.steps.value" />
          </section>

          <!-- Subnames. -->
          <section v-if="!isSub" class="panel p-5 grid gap-3">
            <div class="flex items-center gap-2">
              <h2 class="text-[15px] font-semibold">Subnames</h2>
              <InfoTip text="Names under this one, free to make, managed by whoever the manager gives them to. pay.alice.znn resolves like any other name." />
              <span class="grow" />
              <button v-if="isManager" class="btn btn-sm" data-testid="new-sub" @click="openSub"><Icon name="plus" :size="13" /> New subname</button>
            </div>
            <p v-if="!subs.length" class="text-[13px] text-dim">None yet.</p>
            <ul v-else class="grid gap-1.5">
              <li v-for="s in subs" :key="s.node" class="flex items-center gap-3 text-[13.5px]">
                <router-link v-if="s.full" :to="`/name/${s.full}`" class="link font-medium">{{ s.full }}</router-link>
                <span v-else class="mono text-dim">[{{ short(s.labelhash, 6, 4) }}].{{ parsed.full }}</span>
                <span class="text-dim">→</span>
                <Addr :address="s.addr ?? s.owner" />
                <span class="grow" />
                <button v-if="isManager && s.full" class="icon-btn" title="Delete" :disabled="run.busy.value" @click="dropSub(s)"><Icon name="trash" :size="13" /></button>
              </li>
            </ul>
          </section>

          <!-- What happened to it. -->
          <section v-if="!isSub" class="panel p-5 grid gap-3">
            <h2 class="text-[15px] font-semibold">History</h2>
            <p v-if="!history.length" class="text-[13px] text-dim">{{ index.synced ? 'Nothing recorded.' : 'Reading the chain…' }}</p>
            <ol v-else class="grid gap-2">
              <li v-for="e in history" :key="e.tx + e.kind" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
                <Chip :tone="e.kind === 'registered' ? 'l2' : e.kind === 'sold' ? 'new' : 'l1'" dot>{{ eventWord[e.kind] }}</Chip>
                <span v-if="e.kind === 'registered'">by <Addr :address="e.to" /></span>
                <span v-else-if="e.kind === 'sold'"><Addr :address="e.from" /> → <Addr :address="e.to" /></span>
                <span v-else>until {{ date(e.expires) }}</span>
                <span v-if="e.cost" class="num text-soft">{{ znn(e.cost, 2) }} ZNN</span>
                <span class="grow" />
                <span class="text-dim text-[12px]">{{ ago(e.time) }}</span>
                <a v-if="explorer(`/tx/${e.tx}`)" class="link" :href="explorer(`/tx/${e.tx}`)!" target="_blank" rel="noopener" title="Transaction"><Icon name="external" :size="13" /></a>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </template>

    <!-- Edit records. -->
    <Modal :open="dialog === 'records'" :title="`Records of ${parsed.full}`" :width="520" @close="close">
      <form class="p-4 grid gap-3" @submit.prevent="saveRecords">
        <label class="grid gap-1">
          <span class="ledger">Address</span>
          <AddressInput v-model="draft.addr" id="rec-addr" />
        </label>
        <label v-for="t in TEXT_KEYS" :key="t.key" class="grid gap-1">
          <span class="ledger">{{ t.label }}</span>
          <input v-model="draft.texts[t.key]" class="input" :placeholder="t.hint" spellcheck="false" :data-testid="`text-${t.key}`" />
        </label>
        <StepRail :steps="run.steps.value" />
        <div class="flex items-center gap-2 pt-1">
          <span class="text-[12.5px] text-dim">{{ changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'}, one transaction` : 'Nothing changed' }}</span>
          <span class="grow" />
          <button type="button" class="btn btn-quiet" :disabled="run.busy.value" @click="close">Cancel</button>
          <button class="btn btn-plasma" :disabled="!changeCount || run.busy.value" data-testid="save-records">Save</button>
        </div>
      </form>
    </Modal>

    <!-- Renew. -->
    <Modal :open="dialog === 'renew'" :title="`Renew ${parsed.full}`" :width="420" @close="close">
      <div class="p-4 grid gap-4">
        <div class="seg justify-self-start" role="group" aria-label="Years">
          <button :disabled="renewYears <= 1" @click="renewYears--"><Icon name="minus" :size="14" /></button>
          <span class="px-4 min-w-[110px] text-center font-semibold num">{{ term(renewYears * YEAR) }}</span>
          <button :disabled="renewYears >= 10" @click="renewYears++"><Icon name="plus" :size="14" /></button>
        </div>
        <dl class="grid gap-1.5 text-[14px]">
          <div class="flex justify-between"><dt class="text-dim">New expiry</dt><dd>{{ state ? date(state.expires + renewYears * YEAR) : '-' }}</dd></div>
          <div class="flex justify-between font-semibold"><dt>Price</dt><dd class="num">{{ renewPrice !== null ? znn(renewPrice, 4) : '-' }} ZNN</dd></div>
        </dl>
        <p v-if="!isHolder" class="text-[12.5px] text-dim">Anyone may renew any name. The time goes to its holder; you get nothing but their thanks.</p>
        <StepRail :steps="run.steps.value" />
        <button class="btn btn-plasma" :disabled="run.busy.value || renewPrice === null" data-testid="renew-go" @click="renew">Renew</button>
      </div>
    </Modal>

    <!-- Send. -->
    <Modal :open="dialog === 'send'" :title="`Send ${parsed.full}`" :width="440" @close="close">
      <div class="p-4 grid gap-3">
        <label class="grid gap-1"><span class="ledger">To</span><AddressInput v-model="sendTo" /></label>
        <p class="text-[12.5px] text-dim">The token and control of its records go to them. Where it points stays as it is until they change it.</p>
        <StepRail :steps="run.steps.value" />
        <button class="btn btn-plasma" :disabled="!sendTo || run.busy.value" @click="send">Send</button>
      </div>
    </Modal>

    <!-- New subname. -->
    <Modal :open="dialog === 'sub'" :title="`New subname of ${parsed.full}`" :width="460" @close="close">
      <div class="p-4 grid gap-3">
        <label class="grid gap-1">
          <span class="ledger">Name</span>
          <div class="flex items-center gap-2">
            <input v-model="subLabel" class="input" placeholder="pay" spellcheck="false" autocapitalize="off" data-testid="sub-label" @input="subLabel = subLabel.toLowerCase()" />
            <span class="text-dim shrink-0">.{{ parsed.full }}</span>
          </div>
          <span v-if="subProblem" class="text-[12px]" style="color: var(--danger)">{{ subProblem }}</span>
        </label>
        <label class="grid gap-1"><span class="ledger">Points at</span><AddressInput v-model="subTarget" /></label>
        <label v-if="subTarget && !same(subTarget, me)" class="flex items-start gap-2.5 text-[13.5px]">
          <input v-model="subHand" type="checkbox" class="check mt-0.5" />
          <span>Let that address manage it</span>
        </label>
        <StepRail :steps="run.steps.value" />
        <button class="btn btn-plasma" :disabled="!subLabel || !!subProblem || !subTarget || run.busy.value" data-testid="sub-go" @click="makeSub">Create</button>
      </div>
    </Modal>
  </div>
</template>
