<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {endpoint, check, hasZns} from './core/endpoint'
import {chain, startChainPolling} from './core/chain'
import {startIndex} from './core/index'
import {restoreWallet, wallet} from './core/wallet'
import {number} from './core/format'
import MomentumPulse from './components/MomentumPulse.vue'
import LatticeBackground from '@zvm/web/components/LatticeBackground.vue'
import ZnsMark from './components/ZnsMark.vue'
import ConnectButton from './components/ConnectButton.vue'
import NodePicker from './components/NodePicker.vue'
import Toasts from './components/Toasts.vue'
import Icon from './components/Icon.vue'
import HeaderSearch from './components/HeaderSearch.vue'
import {deploymentFor} from './core/deployment'
import {same} from './core/format'

const route = useRoute()
const menuOpen = ref(false)
watch(() => route.fullPath, () => (menuOpen.value = false))

const nav = computed(() => [
  {to: '/', label: 'Search'},
  {to: '/explore', label: 'Explore'},
  ...(wallet.address ? [{to: '/names', label: 'My names'}] : []),
  // The owner's tools, shown to the owner only.
  ...(same(wallet.address, deploymentFor(endpoint.chainId)?.owner) ? [{to: '/admin', label: 'Owner'}] : []),
])

const theme = ref(document.documentElement.getAttribute('data-theme') ?? 'dark')
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  try {
    localStorage.setItem('zns.theme', theme.value)
  } catch {
    /* storage can be blocked; the theme still applies for this tab */
  }
}

const offline = computed(() => endpoint.health === 'error')
const noZns = computed(() => endpoint.health === 'ok' && !hasZns.value)

onMounted(async () => {
  await check()
  // Once a minute: the head, and the logs since the last read. Every page,
  // stat and balance refreshes from this one beat; a transaction the page
  // sends watches its own receipt meanwhile.
  startChainPolling(60_000)
  startIndex()
  await restoreWallet()
})
</script>

<template>
  <!-- overflow-x clip: the home page's orbiting lights reach past the
       viewport's edge on a phone and would otherwise scroll it sideways. -->
  <div class="min-h-screen flex flex-col overflow-x-clip">
    <LatticeBackground />

    <header class="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
      <div class="mx-auto max-w-[1200px] px-4 py-2.5 flex items-center gap-3">
        <router-link to="/" class="flex items-center gap-2.5 shrink-0 group" title="ZNS">
          <span class="transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-105"><ZnsMark :size="26" /></span>
          <span class="font-semibold tracking-[0.04em] text-[16.5px] hidden sm:block">ZNS</span>
        </router-link>

        <nav class="hidden md:flex items-center gap-1 ml-2">
          <router-link v-for="item in nav" :key="item.to" :to="item.to" class="tab" active-class="tab-on" :exact-active-class="item.to === '/' ? 'tab-on' : ''">{{ item.label }}</router-link>
        </nav>

        <div v-if="route.name !== 'home'" class="grow min-w-0 max-w-[360px] mx-auto hidden lg:block"><HeaderSearch /></div>
        <span class="grow" />

        <div class="flex items-center gap-1">
          <router-link to="/about" class="btn btn-sm btn-quiet px-2" title="How ZNS works">
            <Icon name="info" :size="15" />
            <span class="sr-only">How ZNS works</span>
          </router-link>
          <button class="btn btn-sm btn-quiet px-2" :title="`Switch to the ${theme === 'dark' ? 'light' : 'dark'} theme`" @click="toggleTheme">
            <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
            <span class="sr-only">Switch theme</span>
          </button>
        </div>

        <div class="hidden sm:block"><NodePicker /></div>
        <ConnectButton />

        <button class="btn btn-sm btn-quiet px-2 md:hidden" title="Menu" @click="menuOpen = !menuOpen">
          <Icon :name="menuOpen ? 'x' : 'menu'" :size="16" />
          <span class="sr-only">Menu</span>
        </button>
      </div>

      <!-- The chain's beat: one momentum orders one block, and this fills
           across the gap between them. -->
      <MomentumPulse />

      <Transition name="fade">
        <div v-if="menuOpen" class="md:hidden border-t border-line px-4 py-3 grid gap-3 bg-surface">
          <HeaderSearch />
          <div class="grid gap-1">
            <router-link
              v-for="item in [...nav, {to: '/about', label: 'About'}]"
              :key="item.to"
              :to="item.to"
              class="px-3 py-2 rounded text-[14px] text-dim hover:bg-raised transition-colors"
              active-class="!text-fg bg-raised"
            >
              {{ item.label }}
            </router-link>
          </div>
          <div class="sm:hidden"><NodePicker /></div>
        </div>
      </Transition>
    </header>

    <div
      v-if="offline || noZns"
      class="border-b"
      :style="{
        borderColor: `color-mix(in srgb, ${offline ? 'var(--danger)' : 'var(--warn)'} 35%, transparent)`,
        background: `color-mix(in srgb, ${offline ? 'var(--danger)' : 'var(--warn)'} 9%, transparent)`,
      }"
    >
      <div class="mx-auto max-w-[1200px] px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Icon name="alert" :size="15" :style="{color: offline ? 'var(--danger)' : 'var(--warn)'}" />
        <template v-if="offline">
          <span>{{ endpoint.error }}</span>
          <span v-if="endpoint.hint" class="text-dim">{{ endpoint.hint }}</span>
        </template>
        <template v-else>
          <span>ZNS is not deployed on chain {{ endpoint.chainId }}.</span>
          <span class="text-dim">Choose a ZVM testnet node (chain 7340469) from the node menu.</span>
        </template>
        <button class="btn btn-sm ml-auto" @click="check()"><Icon name="refresh" :size="13" /> Try again</button>
      </div>
    </div>

    <main class="mx-auto w-full max-w-[1200px] px-4 py-6 flex-1">
      <p v-if="wallet.error" class="card px-4 py-2.5 mb-4 text-[13px]" style="color: var(--danger)">{{ wallet.error }}</p>
      <router-view v-slot="{Component, route: r}">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="r.path" />
        </Transition>
      </router-view>
    </main>

    <footer class="border-t border-line mt-10 bg-bg/80 backdrop-blur-md">
      <div class="mx-auto max-w-[1200px] px-4 py-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-dim">
        <span class="flex items-center gap-2 text-soft"><ZnsMark :size="16" /> ZNS</span>
        <span class="mono break-all">{{ endpoint.rpc }}</span>
        <span v-if="endpoint.chainId !== null" class="mono">chain {{ endpoint.chainId }}</span>
        <span v-if="chain.head !== null" class="mono sm:ml-auto flex items-center gap-1.5">
          <span class="dot live-dot" style="background: var(--znn-ink)" /> block {{ number(chain.head) }}
        </span>
      </div>
    </footer>

    <Toasts />
  </div>
</template>
