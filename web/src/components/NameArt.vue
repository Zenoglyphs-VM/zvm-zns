<script setup lang="ts">
// A name's card in a square frame. `src` is the token's own image when the
// page has read it; otherwise the same card is drawn here (core/art.ts).
import {computed, ref, watch} from 'vue'
import {cardUrl} from '../core/art'

const props = withDefaults(defineProps<{label: string; expires?: number; src?: string | null; dim?: boolean}>(), {
  expires: 0,
  src: null,
  dim: false,
})

const url = computed(() => props.src || cardUrl(props.label, props.expires))
const loaded = ref(false)
watch(url, () => (loaded.value = false))
</script>

<template>
  <div class="relative w-full aspect-square overflow-hidden bg-sunk">
    <img
      :src="url"
      :alt="`${label}.znn`"
      class="absolute inset-0 w-full h-full object-cover transition-[opacity,filter] duration-500"
      :style="{opacity: loaded ? (dim ? 0.55 : 1) : 0, filter: dim ? 'grayscale(0.7)' : 'none'}"
      @load="loaded = true"
    />
  </div>
</template>
