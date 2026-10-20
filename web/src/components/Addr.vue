<script setup lang="ts">
// An address, reading as its primary name when it has one that verifies, and
// linking to everything it holds. The connected wallet reads as "you", which
// is the one thing a person scanning a list looks for.
import {computed, watch} from 'vue'
import {wallet} from '../core/wallet'
import {isZero, same, short} from '../core/format'
import {primaries, primaryName} from '../core/zns'
import {hasZns} from '../core/endpoint'
import Avatar from './Avatar.vue'

const props = withDefaults(defineProps<{address?: string | null; avatar?: boolean; head?: number; tail?: number; you?: boolean}>(), {
  address: '',
  avatar: false,
  head: 6,
  tail: 4,
  you: true,
})

const isYou = computed(() => props.you && same(props.address, wallet.address))
const none = computed(() => isZero(props.address))
const name = computed(() => (props.address ? (primaries.get(props.address.toLowerCase()) ?? null) : null))

watch(
  () => [props.address, hasZns.value] as const,
  ([a, deployed]) => {
    if (a && deployed && !isZero(a)) primaryName(a)
  },
  {immediate: true},
)
</script>

<template>
  <span v-if="none" class="text-dim text-[13px]">nobody</span>
  <router-link v-else-if="address" :to="`/address/${address}`" class="link inline-flex items-center gap-1.5 min-w-0" :title="address">
    <Avatar v-if="avatar" :seed="address" :size="18" />
    <span v-if="name" class="text-[13.5px] truncate">{{ name }}<span v-if="isYou" class="text-dim"> (you)</span></span>
    <span v-else class="mono text-[12.5px] truncate">{{ isYou ? 'you' : short(address, head, tail) }}</span>
  </router-link>
  <span v-else class="text-dim">-</span>
</template>
