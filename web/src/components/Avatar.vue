<script setup lang="ts">
// An account's face: a pixel character generated from its address (see
// core/pixelAvatar.ts), the same one on every page.
//
// The root is the avatar's own box, sized exactly, so a ring or border passed
// in as a class hugs it. It used to sit in an inline wrapper, and an inline box
// keeps room below the baseline for descenders: the profile's ring came out
// taller than the face, longer at the bottom than the top.
import {computed} from 'vue'
import {pixelAvatar} from '../core/pixelAvatar'

const props = withDefaults(defineProps<{seed: string; size?: number}>(), {size: 24})

const art = computed(() => pixelAvatar(props.seed))
</script>

<template>
  <span
    class="inline-block shrink-0 overflow-hidden align-middle"
    :style="{width: `${size}px`, height: `${size}px`, borderRadius: `${Math.max(3, Math.round(size * 0.22))}px`}"
    aria-hidden="true"
  >
    <svg :viewBox="`0 0 ${art.size} ${art.size}`" width="100%" height="100%" shape-rendering="crispEdges" class="block">
      <rect :width="art.size" :height="art.size" :fill="art.background" />
      <rect v-for="(r, i) in art.runs" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.color" />
    </svg>
  </span>
</template>
