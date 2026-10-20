<script setup lang="ts">
// Where to send something: an address, or a name that resolves to one. The
// resolved address is shown before anything is signed, because a name can
// point anywhere its holder likes.
import {ref, watch} from 'vue'
import type {Address} from 'viem'
import {getAddress} from 'viem'
import {isAddress, parse} from '../core/names'
import {resolveName} from '../core/zns'
import {short} from '../core/format'
import Icon from './Icon.vue'

const props = defineProps<{modelValue: Address | null; placeholder?: string; id?: string}>()
const emit = defineEmits<{(e: 'update:modelValue', v: Address | null): void}>()

const text = ref(props.modelValue ?? '')
const note = ref('')
const bad = ref(false)
let seq = 0

watch(text, async (raw) => {
  const s = raw.trim()
  const mine = ++seq
  note.value = ''
  bad.value = false
  if (!s) return emit('update:modelValue', null)
  if (isAddress(s)) return emit('update:modelValue', getAddress(s))
  emit('update:modelValue', null)
  const p = parse(s)
  if (p.problem) {
    if (s.length > 2) {
      note.value = 'Not an address or a .znn name'
      bad.value = true
    }
    return
  }
  note.value = `Looking up ${p.full}`
  const addr = await resolveName(p.full)
  if (mine !== seq) return
  if (addr) {
    note.value = `${p.full} → ${short(addr, 8, 6)}`
    emit('update:modelValue', addr)
  } else {
    note.value = `${p.full} does not point anywhere`
    bad.value = true
  }
})
</script>

<template>
  <div class="grid gap-1">
    <input :id="id" v-model="text" class="input mono" :placeholder="placeholder ?? '0x… or name.znn'" spellcheck="false" autocomplete="off" />
    <span v-if="note" class="text-[12px] flex items-center gap-1.5" :style="{color: bad ? 'var(--danger)' : 'var(--dim)'}">
      <Icon v-if="!bad && modelValue" name="check" :size="12" style="color: var(--znn-ink)" />
      {{ note }}
    </span>
  </div>
</template>
