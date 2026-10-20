<script setup lang="ts">
// Which node this page reads. A first-class control rather than a
// buried setting, because on a devnet the node is the thing that changes most
// often, and pointing the app at your own is the normal case.
import {computed, ref, watch} from 'vue'
import {endpoint, setEndpoint, check, PRESETS, isLoopback, mixedContentBlocked, normalize, hasZns} from '../core/endpoint'
import {chain} from '../core/chain'
import {chainName} from '../core/chains'
import {number, short} from '../core/format'
import Icon from './Icon.vue'
import Modal from './Modal.vue'

const open = ref(false)
const draft = ref(endpoint.rpc)
const busy = ref(false)

watch(
  () => endpoint.rpc,
  (v) => (draft.value = v),
)
watch(open, (isOpen) => {
  if (isOpen) draft.value = endpoint.rpc
})

const tone = computed(() => {
  if (busy.value || endpoint.health === 'checking') return 'var(--warn)'
  if (endpoint.health === 'ok' && hasZns.value) return 'var(--znn-ink)'
  if (endpoint.health === 'ok') return 'var(--warn)'
  if (endpoint.health === 'error') return 'var(--danger)'
  return 'var(--dim)'
})

const label = computed(() => {
  if (endpoint.health === 'error') return 'No node'
  if (endpoint.chainId === null) return 'Connecting'
  return chainName(endpoint.chainId)
})

const willBlock = computed(() => mixedContentBlocked(normalize(draft.value)))
const dirty = computed(() => normalize(draft.value) !== endpoint.rpc)

async function use(url: string) {
  busy.value = true
  try {
    draft.value = url
    // A node that answered is the end of the errand, so the dialog gets out of
    // the way. One that did not stays open, with the reason under the field.
    if (await setEndpoint(url)) open.value = false
  } finally {
    busy.value = false
  }
}

async function retry() {
  busy.value = true
  try {
    await check()
  } finally {
    busy.value = false
  }
}

defineExpose({open: () => (open.value = true)})
</script>

<template>
  <div>
    <button class="btn btn-sm" :title="endpoint.rpc" data-testid="node-picker" @click="open = true">
      <span class="dot" :class="endpoint.health === 'checking' ? 'live-dot' : ''" :style="{background: tone}" />
      <span class="text-[12.5px]">{{ label }}</span>
      <Icon name="down" :size="13" class="text-dim" />
    </button>

    <Modal :open="open" title="Node" :width="460" @close="open = false">
      <div class="p-4 grid gap-4">
        <form class="grid gap-2" @submit.prevent="use(draft)">
          <label class="ledger" for="rpc-url">JSON-RPC endpoint</label>
          <div class="flex gap-2">
            <input id="rpc-url" v-model="draft" class="input" spellcheck="false" autocomplete="off" placeholder="https://host/rpc" />
            <button class="btn btn-plasma" type="submit" :disabled="busy || !dirty">Use</button>
          </div>
          <p class="text-[12px] text-dim">
            Paste a ZVM node's RPC. Names are read straight from the contracts, so any node of a chain ZNS is
            deployed on will do.
          </p>
        </form>

        <p v-if="willBlock" class="text-[12.5px] rounded p-2.5" style="background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn)">
          Your browser will block this. An HTTPS page cannot reach plain HTTP, except on loopback, so
          <code class="mono">http://localhost</code> works and a LAN address does not.
        </p>

        <div class="grid gap-1.5">
          <span class="ledger">Saved nodes</span>
          <button
            v-for="p in PRESETS"
            :key="p.url"
            class="text-left px-3 py-2 rounded border transition-colors hover:bg-surface"
            :style="{
              borderColor: p.url === endpoint.rpc ? 'color-mix(in srgb, var(--znn) 45%, transparent)' : 'var(--line)',
              background: p.url === endpoint.rpc ? 'color-mix(in srgb, var(--znn) 8%, transparent)' : '',
            }"
            @click="use(p.url)"
          >
            <span class="flex items-center gap-2">
              <span class="text-[13.5px]">{{ p.label }}</span>
              <Icon v-if="p.url === endpoint.rpc" name="check" :size="13" style="color: var(--znn-ink)" />
            </span>
            <span class="block mono text-[11.5px] text-dim">{{ p.url }}</span>
          </button>
        </div>

        <dl class="grid gap-1.5 text-[13px] border-t border-line pt-3">
          <div class="flex justify-between gap-3">
            <dt class="text-dim">Status</dt>
            <dd class="flex items-center gap-1.5">
              <span class="dot" :style="{background: tone}" />
              <span v-if="endpoint.health === 'ok' && hasZns">Reachable, ZNS deployed</span>
              <span v-else-if="endpoint.health === 'ok'" style="color: var(--warn)">Reachable, no ZNS here</span>
              <span v-else-if="endpoint.health === 'checking' || busy">Checking</span>
              <span v-else-if="endpoint.health === 'error'" style="color: var(--danger)">Not reachable</span>
              <span v-else>Not checked</span>
            </dd>
          </div>
          <div v-if="endpoint.chainId !== null" class="flex justify-between gap-3">
            <dt class="text-dim">Chain</dt>
            <dd class="mono">{{ endpoint.chainId }}</dd>
          </div>
          <div v-if="endpoint.latency !== null" class="flex justify-between gap-3">
            <dt class="text-dim">Round trip</dt>
            <dd class="mono">{{ endpoint.latency }} ms</dd>
          </div>
          <div v-if="chain.head !== null" class="flex justify-between gap-3">
            <dt class="text-dim">Block</dt>
            <dd class="mono">{{ number(chain.head) }}</dd>
          </div>
          <div v-if="chain.head !== null" class="flex justify-between gap-3">
            <dt class="text-dim">Momentum gap</dt>
            <dd class="mono">{{ chain.interval.toFixed(1) }} s</dd>
          </div>
        </dl>

        <p v-if="endpoint.health === 'ok' && !hasZns" class="text-[12.5px]" style="color: var(--warn)">
          This endpoint answers, but ZNS is not deployed on chain {{ endpoint.chainId }}. It lives on the ZVM testnet,
          chain 7340469.
        </p>

        <p v-if="endpoint.error" class="text-[13px]" style="color: var(--danger)">
          {{ endpoint.error }}
          <span v-if="endpoint.hint" class="block text-dim mt-1">{{ endpoint.hint }}</span>
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-sm" :disabled="busy" @click="retry"><Icon name="refresh" :size="13" /> Check again</button>
          <a v-if="endpoint.apiBase" class="btn btn-sm btn-quiet" :href="endpoint.apiBase" target="_blank" rel="noreferrer noopener">
            <Icon name="external" :size="13" /> Open this node
          </a>
        </div>

        <p v-if="isLoopback(endpoint.rpc)" class="text-[12px] text-dim border-t border-line pt-3">
          Your browser talks to {{ short(endpoint.rpc, 30, 8) }} directly. Nothing is proxied, and whoever serves this page never sees
          the traffic.
        </p>
      </div>
    </Modal>
  </div>
</template>
