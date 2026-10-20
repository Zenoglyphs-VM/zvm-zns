<script setup lang="ts">
// One name in a grid: its card, what it is called, and where it stands.
import {computed} from 'vue'
import {date, span} from '../core/format'
import {chainNow, GRACE} from '../core/zns'
import NameArt from './NameArt.vue'
import Chip from '@zvm/web/components/Chip.vue'

const props = withDefaults(defineProps<{label: string; expires: number; index?: number; primary?: boolean; selectable?: boolean; selected?: boolean}>(), {
  index: 0,
  primary: false,
  selectable: false,
  selected: false,
})
defineEmits<{(e: 'toggle'): void}>()

const left = computed(() => props.expires - chainNow())
const state = computed(() => (left.value > 0 ? (left.value < 30 * 86400 ? 'soon' : 'active') : left.value + GRACE > 0 ? 'grace' : 'released'))
</script>

<template>
  <div class="name-card rise-in group" :class="{picked: selected}" :style="{animationDelay: `${Math.min(index, 12) * 40}ms`}">
    <router-link :to="`/name/${label}.znn`" class="block">
      <div class="art"><NameArt :label="label" :expires="expires" :dim="state === 'grace' || state === 'released'" /></div>
    </router-link>
    <div class="px-3 py-2.5 grid gap-1">
      <div class="flex items-center gap-2 min-w-0">
        <router-link :to="`/name/${label}.znn`" class="font-semibold text-[14.5px] truncate hover:underline underline-offset-2">{{ label }}<span class="text-dim">.znn</span></router-link>
        <span v-if="primary" class="shrink-0" title="Primary name"><Chip tone="l2" dot>Primary</Chip></span>
        <span class="grow" />
        <input
          v-if="selectable"
          type="checkbox"
          class="check"
          :checked="selected"
          :aria-label="`Select ${label}.znn`"
          @change="$emit('toggle')"
        />
      </div>
      <div class="text-[12px] flex items-center gap-1.5">
        <template v-if="state === 'active'">
          <span class="text-dim">Expires {{ date(expires) }}</span>
        </template>
        <template v-else-if="state === 'soon'">
          <span style="color: var(--warn)">Expires in {{ span(left) }}</span>
        </template>
        <template v-else-if="state === 'grace'">
          <span style="color: var(--danger)">Expired; {{ span(left + GRACE) }} left to renew</span>
        </template>
        <template v-else>
          <span class="text-dim">Released</span>
        </template>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.name-card {
  background: var(--surface-glass);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--edge);
  transition:
    transform 220ms var(--ease),
    border-color 220ms var(--ease),
    box-shadow 220ms var(--ease);
}
.name-card:hover {
  transform: translateY(-3px);
  border-color: var(--line-strong);
  box-shadow: var(--edge), var(--shadow-pop);
}
.name-card .art :deep(img) {
  transition: transform 600ms var(--ease);
}
.name-card:hover .art :deep(img) {
  transform: scale(1.04);
}
.name-card.picked {
  border-color: color-mix(in srgb, var(--znn) 60%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--znn) 40%, transparent), var(--edge);
}
</style>
