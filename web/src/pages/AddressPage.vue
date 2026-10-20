<script setup lang="ts">
// An address: what it calls itself, and what it holds.
import {computed, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {getAddress, type Address} from 'viem'
import {isAddress} from '../core/names'
import {primaries, primaryName, records, reverseClaim, zns} from '../core/zns'
import {nodeOf} from '../core/names'
import {hasZns} from '../core/endpoint'
import {wallet} from '../core/wallet'
import {explorer} from '../core/links'
import {same} from '../core/format'
import Inventory from '../components/Inventory.vue'
import NameAvatar from '../components/NameAvatar.vue'
import Icon from '../components/Icon.vue'
import InfoTip from '../components/InfoTip.vue'

const route = useRoute()
const address = computed<Address | null>(() => (isAddress(String(route.params.address)) ? getAddress(String(route.params.address)) : null))
const primary = computed(() => (address.value ? (primaries.get(address.value.toLowerCase()) ?? null) : null))
const avatar = ref('')
const claim = ref('')

watch(
  () => [address.value, hasZns.value] as const,
  async ([a, ok]) => {
    avatar.value = ''
    claim.value = ''
    if (!a || !ok) return
    const name = await primaryName(a)
    if (name) avatar.value = (await records(nodeOf(name), zns().d.contracts.PublicResolver)).texts.avatar ?? ''
    // A reverse record that names something not pointing back: say why the
    // address shows no name.
    else claim.value = await reverseClaim(a).catch(() => '')
  },
  {immediate: true},
)
const isYou = computed(() => same(address.value, wallet.address))
</script>

<template>
  <div v-if="!address" class="shelf text-center py-10">That is not an address.</div>
  <div v-else class="grid gap-6 grid-cols-[minmax(0,1fr)]">
    <header class="flex flex-wrap items-center gap-4 rise-in">
      <NameAvatar :record="avatar" :owner="address" :seed="address" :size="64" />
      <div class="min-w-0 grid gap-1">
        <h1 v-if="primary" class="text-[28px] font-semibold tracking-[-0.02em] leading-tight" data-testid="profile-name">{{ primary }}</h1>
        <div class="mono text-[13px] text-dim break-all flex items-center gap-2">
          {{ address }}
          <a v-if="explorer(`/address/${address}`)" class="link" :href="explorer(`/address/${address}`)!" target="_blank" rel="noopener" title="Explorer"><Icon name="external" :size="13" /></a>
        </div>
        <p v-if="!primary && claim" class="text-[12.5px] flex items-center gap-1.5" style="color: var(--warn)">
          Claims {{ claim }}, which does not point back here
          <InfoTip text="A primary name counts only when the name also resolves to this address. Otherwise anyone could claim anyone's name." />
        </p>
      </div>
    </header>
    <section class="shelf"><Inventory :address="address" :editable="isYou" /></section>
  </div>
</template>
