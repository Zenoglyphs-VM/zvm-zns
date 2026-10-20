<script setup lang="ts">
// A heading's explanation, one hover or tap away instead of a grey line under
// every title. The line is what a first visit needs once; printed under each
// heading it was the most repeated text on the site and pushed the content down.
//
// Teleported and fixed rather than absolutely placed: a shelf has a
// backdrop-filter, which makes it the containing block for anything inside it,
// and the fresh-listings shelf clips its overflow, so a tooltip drawn in place
// would be cut off or measured against the wrong box. From the body it is
// placed against the viewport and clamped to it, so it never scrolls a phone
// sideways.
//
// Hover opens it for a mouse, focus for a keyboard, and a tap toggles it on a
// touch screen. A tap also focuses the button on Android and fires a synthetic
// mouseenter, so both are filtered by where the event came from, or a tap would
// open it twice and the second would close it.
import {nextTick, onBeforeUnmount, ref, useId} from 'vue'
import Icon from './Icon.vue'

defineProps<{text?: string}>()

const id = useId()
const btn = ref<HTMLElement | null>(null)
const tip = ref<HTMLElement | null>(null)
const open = ref(false)
const pos = ref({left: 0, top: 0, above: false})
let lastPointer = ''

const EDGE = 12
const GAP = 8

async function show() {
  if (open.value) return
  open.value = true
  await nextTick()
  place()
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', hide, {capture: true, passive: true})
  window.addEventListener('resize', hide)
}

function hide() {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('resize', hide)
}

function place() {
  const b = btn.value?.getBoundingClientRect()
  const t = tip.value
  if (!b || !t) return
  const w = t.offsetWidth
  const h = t.offsetHeight
  const left = Math.min(Math.max(EDGE, b.left + b.width / 2 - w / 2), window.innerWidth - EDGE - w)
  // Below by default; above only when below would run off the screen.
  const above = b.bottom + GAP + h > window.innerHeight - EDGE && b.top - GAP - h > EDGE
  pos.value = {left, top: above ? b.top - GAP - h : b.bottom + GAP, above}
}

function onOutside(e: PointerEvent) {
  if (!btn.value?.contains(e.target as Node)) hide()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}

function onEnter(e: PointerEvent) {
  if (e.pointerType === 'mouse') void show()
}
function onLeave(e: PointerEvent) {
  if (e.pointerType === 'mouse') hide()
}
function onFocus(e: FocusEvent) {
  if ((e.target as HTMLElement).matches(':focus-visible')) void show()
}
function onClick() {
  if (lastPointer === 'touch' || lastPointer === 'pen') open.value ? hide() : void show()
  lastPointer = ''
}

onBeforeUnmount(hide)
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="infotip"
    :class="{on: open}"
    aria-label="What is this"
    :aria-describedby="id"
    @pointerenter="onEnter"
    @pointerleave="onLeave"
    @pointerdown="lastPointer = $event.pointerType"
    @focus="onFocus"
    @blur="hide"
    @click.stop="onClick"
  >
    <Icon name="info" :size="15" />
  </button>
  <Teleport to="body">
    <Transition name="infotip">
      <span
        v-show="open"
        :id="id"
        ref="tip"
        role="tooltip"
        class="infotip__body pop"
        :class="{above: pos.above}"
        :style="{left: `${pos.left}px`, top: `${pos.top}px`}"
      ><slot>{{ text }}</slot></span>
    </Transition>
  </Teleport>
</template>

<style scoped>
.infotip {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--dim);
  vertical-align: middle;
  cursor: help;
  transition:
    color 150ms var(--ease),
    background 150ms var(--ease);
}
.infotip:hover,
.infotip.on {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}
.infotip:focus-visible {
  outline: 2px solid var(--nom-ink);
  outline-offset: 1px;
}

.infotip__body {
  position: fixed;
  z-index: 80;
  width: max-content;
  max-width: min(300px, calc(100vw - 24px));
  padding: 8px 11px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: normal;
  text-transform: none;
  color: var(--soft);
  pointer-events: none;
}

.infotip-enter-active,
.infotip-leave-active {
  transition:
    opacity 140ms var(--ease),
    transform 140ms var(--ease);
}
.infotip-enter-from,
.infotip-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
.infotip-enter-from.above,
.infotip-leave-to.above {
  transform: translateY(3px);
}
</style>
