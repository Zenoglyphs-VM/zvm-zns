<script setup lang="ts">
// A comet running round its parent's rim.
//
// Drawn on a canvas each frame, because what it asks for cannot be stroked in
// SVG: a tail whose colour runs continuously along its own length (a
// gradient follows a straight axis, never a path). The tail is many short
// segments behind the head, each coloured by where it falls: the head the
// brightest pink, blending through NoM blue into ZVM green and fading to
// nothing as it thins.
//
// The head moves by distance along the rim, at a speed set by which way the
// rim runs there: quick along the top and bottom, slow down the short sides,
// easing between the two through each corner.
import {onBeforeUnmount, onMounted, ref} from 'vue'

const props = withDefaults(defineProps<{radius?: number; tail?: number; fast?: number; slow?: number}>(), {
  radius: 14,
  // Tail length along the rim, and speeds along it, in CSS pixels.
  tail: 440,
  fast: 250,
  slow: 55,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const PAD = 16 // room for the glow outside the rim

let frame = 0
let observer: ResizeObserver | null = null
let w = 0
let h = 0
let s = 0 // the head's distance along the rim
let last = 0

// Colours along the tail, t = 0 at the head. RGB, and the alpha each reaches.
const STOPS: [number, number[], number][] = [
  [0, [255, 70, 170], 1],
  [0.08, [249, 22, 144], 1],
  [0.35, [93, 164, 255], 0.9],
  [0.65, [0, 213, 87], 0.6],
  [1, [0, 213, 87], 0],
]

function colourAt(t: number): string {
  let i = 0
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++
  const [t0, c0, a0] = STOPS[i]
  const [t1, c1, a1] = STOPS[i + 1]
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * k)
  return `rgba(${mix(c0[0], c1[0])},${mix(c0[1], c1[1])},${mix(c0[2], c1[2])},${(a0 + (a1 - a0) * k).toFixed(3)})`
}

/** The rim as a loop starting at the top-left, clockwise: a point and the
 *  direction it runs, for any distance along it. */
function rim(d: number) {
  const r = Math.min(props.radius, h / 2, w / 2)
  const top = w - 2 * r
  const side = h - 2 * r
  const arc = (Math.PI / 2) * r
  const total = 2 * top + 2 * side + 4 * arc
  d = ((d % total) + total) % total
  const corner = (cx: number, cy: number, from: number, x: number) => {
    const a = from + (x / arc) * (Math.PI / 2)
    return {x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), dx: -Math.sin(a), dy: Math.cos(a)}
  }
  if (d < top) return {x: r + d, y: 0, dx: 1, dy: 0, total}
  d -= top
  if (d < arc) return {...corner(w - r, r, -Math.PI / 2, d), total}
  d -= arc
  if (d < side) return {x: w, y: r + d, dx: 0, dy: 1, total}
  d -= side
  if (d < arc) return {...corner(w - r, h - r, 0, d), total}
  d -= arc
  if (d < top) return {x: w - r - d, y: h, dx: -1, dy: 0, total}
  d -= top
  if (d < arc) return {...corner(r, h - r, Math.PI / 2, d), total}
  d -= arc
  if (d < side) return {x: 0, y: h - r - d, dx: 0, dy: -1, total}
  d -= side
  return {...corner(r, r, Math.PI, d), total}
}

function size() {
  const el = canvas.value
  const box = el?.parentElement
  if (!el || !box) return
  // The border box, so the comet runs on the border itself; the canvas is
  // placed from the padding box, one border width further in (see the style).
  w = box.offsetWidth
  h = box.offsetHeight
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round((w + 2 * PAD) * dpr)
  el.height = Math.round((h + 2 * PAD) * dpr)
  el.style.width = `${w + 2 * PAD}px`
  el.style.height = `${h + 2 * PAD}px`
  el.getContext('2d')?.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr)
}

function draw(now: number) {
  frame = requestAnimationFrame(draw)
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !w || !h) return
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
  last = now
  const here = rim(s)
  // Horizontal runs at `fast`, vertical at `slow`, and a corner in between by
  // how horizontal it is at that point.
  s = (s + (props.slow + (props.fast - props.slow) * Math.abs(here.dx)) * dt) % here.total

  ctx.clearRect(-PAD, -PAD, w + 2 * PAD, h + 2 * PAD)
  // Butt caps: round ones overlap between segments, and where they overlap
  // the alpha doubles, which beaded the tail.
  ctx.lineCap = 'butt'
  const steps = 132
  const seg = props.tail / steps
  let prev = rim(s)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const p = rim(s - i * seg)
    ctx.strokeStyle = colourAt(t)
    ctx.lineWidth = 3 - 2 * t
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    prev = p
  }
  // The head: a hot pink core in a pink glow, the brightest thing on it.
  const head = rim(s)
  const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 12)
  glow.addColorStop(0, 'rgba(255,90,180,0.75)')
  glow.addColorStop(0.4, 'rgba(249,22,144,0.35)')
  glow.addColorStop(1, 'rgba(249,22,144,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(head.x, head.y, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgb(255,120,195)'
  ctx.beginPath()
  ctx.arc(head.x, head.y, 2.1, 0, Math.PI * 2)
  ctx.fill()
}

onMounted(() => {
  size()
  observer = new ResizeObserver(size)
  if (canvas.value?.parentElement) observer.observe(canvas.value.parentElement)
  frame = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="comet" aria-hidden="true" />
</template>

<style scoped>
.comet {
  position: absolute;
  /* PAD, plus the parent's 1 px border: absolute children are placed from
     inside the border. */
  left: -17px;
  top: -17px;
  pointer-events: none;
}
</style>
