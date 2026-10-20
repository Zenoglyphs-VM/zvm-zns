<script setup lang="ts">
import {toasts, dismiss} from '../core/toast'
import Icon from './Icon.vue'

const icon = {good: 'ok', bad: 'fail', info: 'info'} as const
const color = {good: 'var(--znn-ink)', bad: 'var(--danger)', info: 'var(--nom-ink)'} as const
</script>

<template>
  <div class="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto sm:w-[360px] grid gap-2 pointer-events-none" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts.items"
        :key="t.id"
        class="pop pointer-events-auto flex items-start gap-3 px-3.5 py-3 text-[13.5px]"
        :data-tone="t.tone"
        data-toast
        :style="{borderColor: `color-mix(in srgb, ${color[t.tone]} 35%, var(--line-strong))`}"
      >
        <Icon :name="icon[t.tone]" :size="16" :style="{color: color[t.tone]}" class="mt-0.5" />
        <div class="grow min-w-0">
          <p class="break-words">{{ t.text }}</p>
          <router-link v-if="t.link" :to="t.link.to" class="link text-[12.5px]" @click="dismiss(t.id)">{{ t.link.label }}</router-link>
        </div>
        <button class="text-dim hover:text-fg" title="Dismiss" @click="dismiss(t.id)"><Icon name="x" :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
