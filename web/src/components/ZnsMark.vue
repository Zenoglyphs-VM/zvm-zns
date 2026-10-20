<script setup lang="ts">
// ZNS's mark: a name tag, one corner chamfered at 45 degrees as Glyphswap's G
// is, holding the explorer's Rune Z (zvm-core/web ZenoglyphMark.vue) at 0.72
// scale. Chosen 2026-09-29 (Z10 on the round-2 sheet).
//
// The gradient is in user space, pinned to the grid: the tag has vertical
// sides, and a gradient sized to a vertical stroke's zero-width bounding box
// paints nothing (the trap Karum's K hit).
withDefaults(defineProps<{size?: number}>(), {size: 24})
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="shrink-0">
    <defs>
      <linearGradient id="zns-tag-plasma" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="22">
        <stop offset="0%" stop-color="hsl(120 86% 63%)" />
        <stop offset="100%" stop-color="hsl(145 100% 38%)" />
      </linearGradient>
    </defs>
    <path d="M6,2.5H21.5V18L18,21.5H2.5V6Z" stroke="url(#zns-tag-plasma)" stroke-width="1.6" stroke-linejoin="miter" />
    <g transform="translate(12 12) scale(0.72) translate(-12 -12)" stroke="url(#zns-tag-plasma)" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter">
      <path d="M5.3,5.3H18.7L5.3,18.7H18.7" />
      <path d="M9.6,9.6L14.4,14.4" />
    </g>
  </svg>
</template>
