<script setup lang="ts">
// What a submitted action is doing, one line per step.
//
// The states are the chain's own, not a generic spinner: a transaction is
// signed, then ordered by a momentum, then executed by the ZVM. Blue while it
// is ordered and green once it has executed, which is the colour rule the rest
// of the app uses. A listing or an offer ends in a signature step, which is
// never ordered or executed because it is never a transaction.
import {computed} from 'vue'
import {explorerUrl} from '../core/endpoint'
import {STEP_WORD, type Step} from '../core/tx'
import {short} from '../core/format'
import Icon from './Icon.vue'
import Chip from '@zvm/web/components/Chip.vue'

const props = defineProps<{steps: Step[]}>()

const tone = {queued: 'plain', signing: 'warn', ordered: 'l1', waiting: 'l1', done: 'l2', failed: 'bad'} as const

const word = (s: Step) => (s.signature && s.state === 'done' ? 'Signed' : s.signature && s.state === 'signing' ? 'Sign in your wallet' : STEP_WORD[s.state])

const anyOrdered = computed(() => props.steps.some((s) => s.state === 'ordered' || (s.state === 'signing' && !s.signature)))
</script>

<template>
  <TransitionGroup v-if="steps.length" tag="ol" name="list" class="grid gap-2.5 text-[13px]">
    <li v-for="(s, i) in steps" :key="i" class="grid gap-1" :data-state="s.state">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 flex items-center gap-2">
          <Icon v-if="s.state === 'signing' || s.state === 'ordered'" name="refresh" :size="13" class="spin text-dim" />
          <Icon v-else-if="s.state === 'waiting'" name="clock" :size="13" class="breathe" style="color: var(--nom-ink)" />
          <Icon v-else-if="s.state === 'done'" name="check" :size="13" style="color: var(--znn-ink)" />
          <Icon v-else-if="s.state === 'failed'" name="x" :size="13" style="color: var(--danger)" />
          <Icon v-else name="clock" :size="13" class="text-dim" />
          <span class="truncate">{{ s.label }}</span>
        </span>
        <Chip :tone="tone[s.state]" :dot="s.state === 'ordered' || s.state === 'done'">{{ word(s) }}</Chip>
      </div>
      <div v-if="s.hash" class="text-[12px] text-dim pl-[21px]">
        <a v-if="explorerUrl(`/tx/${s.hash}`)" class="link mono" :href="explorerUrl(`/tx/${s.hash}`)!" target="_blank" rel="noreferrer noopener">
          {{ short(s.hash, 10, 6) }}
        </a>
        <span v-else class="mono">{{ short(s.hash, 10, 6) }}</span>
      </div>
      <p v-if="s.detail" class="text-[12.5px] pl-[21px] break-words" :style="s.state === 'failed' ? 'color: var(--danger)' : ''">
        {{ s.detail }}
      </p>
    </li>
    <li v-if="anyOrdered" key="note" class="text-[12px] text-dim">
      Zenon orders this into a momentum first, then the ZVM executes it. That is normally two momentums, about thirty seconds.
    </li>
  </TransitionGroup>
</template>
