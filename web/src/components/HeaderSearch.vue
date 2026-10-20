<script setup lang="ts">
// The compact search in the header: a name goes to its page, an address to
// what it holds. The home page has the full one, with prices as you type.
import {ref} from 'vue'
import {useRouter} from 'vue-router'
import {isAddress, parse} from '../core/names'
import Icon from './Icon.vue'

const router = useRouter()
const q = ref('')

function go() {
  const s = q.value.trim()
  if (!s) return
  if (isAddress(s)) router.push(`/address/${s}`)
  else router.push(`/name/${parse(s).full}`)
  q.value = ''
}
</script>

<template>
  <form class="relative" role="search" @submit.prevent="go">
    <Icon name="search" :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
    <input v-model="q" class="input !pl-8 !py-1.5 text-[13.5px]" placeholder="Search names or addresses" spellcheck="false" autocomplete="off" aria-label="Search names or addresses" />
  </form>
</template>
