<script setup lang="ts">
// MetaMask, Rabby, Phantom, and anything else announcing itself through
// EIP-6963. Connected, the button reads as the wallet's primary name when it
// has one, which is the point of having one, and opens a menu: its names,
// what this browser has sent, and the way out.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {wallet, walletPicker, connectWallet, disconnectWallet, wrongChain, switchToChain} from '../core/wallet'
import {knownWallets, requestWallets, onWallets, publicClient, type Discovered} from '@zvm/web/evm'
import {endpoint, explorerUrl} from '../core/endpoint'
import {chainName} from '../core/chains'
import {chain} from '../core/chain'
import {activity, clearActivity, STEP_WORD} from '../core/tx'
import {ago, short, units} from '../core/format'
import {primaries, primaryName} from '../core/zns'
import {hasZns} from '../core/endpoint'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import Avatar from './Avatar.vue'
import Chip from '@zvm/web/components/Chip.vue'

const router = useRouter()
const wallets = ref<Discovered[]>([])
const picking = ref(false)
const account = ref(false)
const busy = ref(false)
const copied = ref(false)
const balance = ref<bigint | null>(null)

let off: (() => void) | undefined
onMounted(() => {
  wallets.value = requestWallets()
  off = onWallets(() => (wallets.value = knownWallets()))
})
onUnmounted(() => off?.())

const canConnect = computed(() => endpoint.health === 'ok' && endpoint.chainId !== null)
const mine = computed(() => activity.items.filter((a) => a.chainId === endpoint.chainId))

async function readBalance() {
  if (!wallet.address || endpoint.chainId === null) {
    balance.value = null
    return
  }
  try {
    balance.value = await publicClient(endpoint.chainId).getBalance({address: wallet.address})
  } catch {
    balance.value = null
  }
}
watch(() => [wallet.address, endpoint.chainId, chain.head], readBalance)

const primary = computed(() => (wallet.address ? (primaries.get(wallet.address.toLowerCase()) ?? null) : null))
watch(
  () => [wallet.address, hasZns.value] as const,
  ([address, deployed]) => {
    if (address && deployed) primaryName(address)
  },
  {immediate: true},
)

async function pick(w: Discovered) {
  busy.value = true
  try {
    await connectWallet(w)
    picking.value = false
  } catch {
    /* wallet.error carries the message, and the header shows it */
  } finally {
    busy.value = false
  }
}

// A form elsewhere on the page asked for the wallet list.
watch(
  () => walletPicker.open,
  (want) => {
    if (!want) return
    walletPicker.open = false
    if (!wallet.address) open()
  },
)

function open() {
  if (wallet.address) {
    account.value = true
    return
  }
  wallets.value = requestWallets()
  picking.value = true
}

async function copyAddress() {
  if (!wallet.address) return
  try {
    await navigator.clipboard.writeText(wallet.address)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    /* a browser that refuses the clipboard leaves the address on screen to select */
  }
}

function go(path: string) {
  account.value = false
  router.push(path)
}

function leave() {
  disconnectWallet()
  account.value = false
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <button
      v-if="wrongChain"
      class="btn btn-sm"
      style="color: var(--warn); border-color: color-mix(in srgb, var(--warn) 55%, transparent)"
      @click="switchToChain"
    >
      <Icon name="alert" :size="13" />
      <span class="hidden sm:inline">Switch to {{ chainName(endpoint.chainId) }}</span>
      <span class="sm:hidden">Switch</span>
    </button>

    <button
      class="btn btn-sm"
      :class="wallet.address ? '' : 'btn-connect'"
      :disabled="busy || (!canConnect && !wallet.address)"
      data-testid="connect"
      @click="open"
    >
      <Avatar v-if="wallet.address" :seed="wallet.address" :size="16" />
      <span v-else class="dot" style="background: var(--line-strong)" />
      <span v-if="primary" class="text-[13px] font-medium max-w-[160px] truncate" data-testid="wallet-name">{{ primary }}</span>
      <span v-else class="mono text-[12px]">{{ wallet.address ? short(wallet.address) : 'Connect wallet' }}</span>
    </button>

    <Modal :open="picking" title="Connect a wallet" :width="380" @close="picking = false">
      <div class="p-3 grid gap-1">
        <button
          v-for="w in wallets"
          :key="w.id"
          class="w-full text-left px-3 py-2.5 rounded flex items-center gap-3 hover:bg-surface transition-colors"
          :disabled="busy"
          @click="pick(w)"
        >
          <img v-if="w.icon" :src="w.icon" alt="" class="w-6 h-6 rounded" />
          <Icon v-else name="wallet" :size="18" class="text-dim" />
          <span class="text-[14px]">{{ w.name }}</span>
        </button>
        <p v-if="!wallets.length" class="px-3 py-4 text-[13px] text-dim">
          No EVM wallet answered in this browser. Install Syrius, MetaMask, Rabby or Phantom, then reload this page.
        </p>
        <p class="px-3 pt-2 pb-1 text-[12px] text-dim border-t border-line mt-2">
          Registering, renewing and editing a name are ordinary EVM transactions, which a relayer posts to Zenon. Nothing is signed
          off chain.
        </p>
      </div>
    </Modal>

    <Modal :open="account" title="Account" :width="440" @close="account = false">
      <div class="p-4 grid gap-4">
        <div class="flex items-center gap-3">
          <Avatar v-if="wallet.address" :seed="wallet.address" :size="40" />
          <div class="min-w-0 grow">
            <div v-if="primary" class="text-[15px] font-semibold truncate">{{ primary }}</div>
            <div class="mono text-[13.5px] truncate" :class="primary ? 'text-dim !text-[12px]' : ''" :title="wallet.address ?? ''">{{ short(wallet.address, 10, 8) }}</div>
            <div class="text-[12px] text-dim">{{ wallet.name }} on {{ chainName(wallet.chainId) }}</div>
          </div>
          <div v-if="balance !== null" class="text-right">
            <div class="num font-semibold text-[15px]">{{ units(balance, 18, 4) }}</div>
            <div class="ledger">ZNN</div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <button class="btn btn-sm" @click="go('/names')"><Icon name="grid" :size="13" /> My names</button>
          <button class="btn btn-sm" @click="go(`/address/${wallet.address}`)"><Icon name="user" :size="13" /> Profile</button>
          <button class="btn btn-sm" @click="copyAddress">
            <Icon :name="copied ? 'check' : 'copy'" :size="13" /> {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <div class="flex flex-wrap gap-2">
          <a v-if="wallet.address && explorerUrl(`/address/${wallet.address}`)" class="btn btn-sm btn-quiet" :href="explorerUrl(`/address/${wallet.address}`)!" target="_blank" rel="noreferrer noopener">
            <Icon name="external" :size="13" /> View on the node
          </a>
          <span class="grow" />
          <button class="btn btn-sm btn-quiet" @click="leave">Disconnect</button>
        </div>

        <div class="border-t border-line pt-3 grid gap-2">
          <div class="flex items-center justify-between">
            <span class="ledger">Sent from this browser</span>
            <button v-if="mine.length" class="btn btn-sm btn-quiet" @click="clearActivity">Clear</button>
          </div>
          <p v-if="!mine.length" class="text-[13px] text-dim">Nothing yet. What you send from here is listed with a link to the node that carried it.</p>
          <ol v-else class="grid gap-1.5 max-h-[240px] overflow-auto">
            <li v-for="a in mine" :key="a.hash" class="flex items-center justify-between gap-3 text-[13px]">
              <span class="min-w-0 truncate">{{ a.label }}</span>
              <span class="flex items-center gap-2 shrink-0">
                <Chip :tone="a.state === 'done' ? 'l2' : a.state === 'failed' ? 'bad' : 'l1'" dot>{{ STEP_WORD[a.state] }}</Chip>
                <span class="text-dim text-[12px]">{{ ago(Math.floor(a.at / 1000)) }}</span>
                <a v-if="explorerUrl(`/tx/${a.hash}`)" class="link" :href="explorerUrl(`/tx/${a.hash}`)!" target="_blank" rel="noreferrer noopener" :title="a.hash">
                  <Icon name="external" :size="13" />
                </a>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </Modal>
  </div>
</template>
