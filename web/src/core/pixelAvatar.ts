// A pixel alien for an EVM address, drawn from the address's own bytes.
//
// Nobody uploads a profile picture on this chain, and a blank circle tells two
// accounts apart no better than their hex does. A face does: people remember
// "the pink three-eyed one" long after they have forgotten 0x7f3a. So every
// address gets a 16 by 16 alien, the same one on every page, and it costs
// nothing to store because it is recomputed from the address.
//
// The alien is drawn on the left half and mirrored, which is what makes random
// pixels read as a creature: the eye finds symmetry and supplies the rest.
// Each feature (head shape, antennae, eyes, mouth, spots, suit, palette, the
// stars behind it) takes its own byte, so two addresses that share a prefix
// still come out as different species.

export interface PixelAvatar {
  size: number
  background: string
  /** Horizontal runs, merged so an avatar is a few dozen rects, not 256. */
  runs: {x: number; y: number; w: number; color: string}[]
}

// Only the Zenon palette (style.css), plus Bitcoin orange, so a crowd of
// avatars looks like it belongs to this site and not to a sticker pack.
// Skin, and a darker shade of it for spots, antennae and shading.
const SKINS: [string, string][] = [
  ['#21e575', '#00a844'], // ZNN green
  ['#7bf06c', '#3fbf3a'], // plasma, the light end
  ['#00b98a', '#007a5c'], // plasma, the deep end
  ['#5da4ff', '#0061eb'], // NoM blue
  ['#ff5bad', '#f91690'], // new-arrival pink
  ['#f7931a', '#c26f0a'], // Bitcoin orange
  ['#f5b13d', '#c4861f'], // warning amber
  ['#b0c1c2', '#7b9094'], // the soft greys
]
const SUITS = ['#0061eb', '#f91690', '#f7931a', '#00d557', '#1a262a', '#e6efec']
const EYE = '#04080a'
const SHINE = '#ffffff'
const IRIS = ['#21e575', '#ff5bad', '#5da4ff', '#f7931a']
const MOUTH = '#1a0714'
const FANG = '#e6efec'
// Near-black, tinted toward one of the brand colours, like the site's own bg.
const SPACE = ['#06090a', '#0b1113', '#071329', '#06170d', '#1a0714', '#1c1005']

const cache = new Map<string, PixelAvatar>()

function bytesOf(address: string): number[] {
  const hex = (address || '').toLowerCase().replace(/^0x/, '').padEnd(40, '0').slice(0, 40)
  const out: number[] = []
  for (let i = 0; i < 40; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16) || 0)
  return out
}

export function pixelAvatar(address: string): PixelAvatar {
  const key = (address || '').toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit

  const b = bytesOf(key)
  let i = 2
  const pick = (n: number) => b[i++ % b.length] % n

  const space = SPACE[((b[0] << 8) | b[1]) % SPACE.length]
  const [skin, shade] = SKINS[pick(SKINS.length)]
  const suit = SUITS[pick(SUITS.length)]
  const iris = IRIS[pick(IRIS.length)]

  // The left half, columns 0..7; mirrored onto 8..15 at the end.
  const grid: (string | null)[][] = Array.from({length: 16}, () => Array<string | null>(8).fill(null))
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x <= 7 && y >= 0 && y <= 15) grid[y][x] = c
  }

  // Head. Four species of skull: a dome, a wide saucer, a tall egg, a bulb
  // with a narrow chin. `widths` is the half-width per row from the top.
  const shapes: {top: number; widths: number[]}[] = [
    {top: 4, widths: [2, 4, 5, 5, 5, 5, 5, 4, 3]}, // dome
    {top: 5, widths: [3, 5, 6, 6, 6, 6, 5, 4]}, // saucer
    {top: 3, widths: [2, 3, 4, 4, 4, 4, 4, 4, 3, 3]}, // egg
    {top: 3, widths: [3, 5, 6, 6, 6, 5, 4, 3, 2, 2]}, // bulb
  ]
  const shape = shapes[pick(shapes.length)]
  const top = shape.top
  const bottom = top + shape.widths.length - 1
  shape.widths.forEach((w, row) => {
    for (let x = 8 - w; x <= 7; x++) set(x, top + row, skin)
  })
  const widthAt = (y: number) => shape.widths[Math.min(Math.max(y - top, 0), shape.widths.length - 1)]

  // Antennae, horns, or nothing.
  switch (pick(4)) {
    case 0: // two antennae with glowing tips
      set(5, top - 1, shade)
      set(4, top - 2, shade)
      set(4, top - 3, iris)
      break
    case 1: // one antenna in the middle
      set(7, top - 1, shade)
      set(7, top - 2, shade)
      set(7, top - 3, iris)
      break
    case 2: // horns
      set(8 - widthAt(top) - 1, top, shade)
      set(8 - widthAt(top) - 1, top - 1, shade)
      break
    default:
      break
  }

  // Eyes: a cyclops, two big ones, three, or a row of small ones.
  const ey = top + Math.floor(shape.widths.length / 2) - 1
  switch (pick(4)) {
    case 0: // cyclops, the pair of centre columns
      for (let y = ey - 1; y <= ey + 1; y++) set(6, y, EYE), set(7, y, iris)
      set(7, ey - 1, SHINE)
      break
    case 1: // two big almond eyes
      set(4, ey, EYE)
      set(5, ey, EYE)
      set(5, ey + 1, EYE)
      set(6, ey + 1, EYE)
      set(5, ey, SHINE)
      break
    case 2: // three eyes: one in the middle, a pair below
      set(7, ey - 1, iris)
      set(5, ey + 1, EYE)
      set(5, ey, iris)
      break
    default: // a row of small eyes
      for (let x = 8 - widthAt(ey) + 1; x <= 7; x += 2) set(x, ey, EYE)
      break
  }

  // Mouth.
  const my = Math.min(bottom - 1, ey + 3)
  switch (pick(4)) {
    case 0: // fangs
      set(6, my, MOUTH)
      set(7, my, MOUTH)
      set(6, my + 1, FANG)
      break
    case 1: // a small o
      set(7, my, MOUTH)
      break
    case 2: // a wide grin
      for (let x = 5; x <= 7; x++) set(x, my, MOUTH)
      set(4, my - 1, MOUTH)
      break
    default: // no mouth at all
      break
  }

  // Spots.
  if (pick(2)) {
    set(8 - widthAt(top + 1) + 1, top + 1, shade)
    set(8 - widthAt(bottom - 1), bottom - 1, shade)
  }

  // Tentacles or a suit below the head.
  if (pick(3) === 0) {
    for (let y = bottom + 1; y <= 15; y++) {
      set(4, y, (y - bottom) % 3 === 0 ? shade : skin)
      set(7, y, (y - bottom) % 2 === 0 ? shade : skin)
    }
  } else {
    for (let y = bottom + 1; y <= 12; y++) set(7, y, shade), set(6, y, shade)
    for (let y = Math.max(13, bottom + 1); y <= 15; y++) for (let x = y === 13 ? 3 : 2; x <= 7; x++) set(x, y, suit)
  }

  // Mirror, then merge each row into runs of one colour.
  const runs: PixelAvatar['runs'] = []
  for (let y = 0; y < 16; y++) {
    const row = [...grid[y], ...[...grid[y]].reverse()]
    let x = 0
    while (x < 16) {
      const c = row[x]
      if (!c) {
        x++
        continue
      }
      let w = 1
      while (x + w < 16 && row[x + w] === c) w++
      runs.push({x, y, w, color: c})
      x += w
    }
  }

  // A few stars in the empty space, placed by the last bytes and never on
  // the alien. They are drawn first so the alien always sits in front.
  const taken = new Set(runs.flatMap((r) => Array.from({length: r.w}, (_, k) => `${r.x + k},${r.y}`)))
  const stars: PixelAvatar['runs'] = []
  for (let s = 0; s < 4; s++) {
    const x = b[(16 + s) % 20] % 16
    const y = b[(12 + s) % 20] % 16
    if (!taken.has(`${x},${y}`)) stars.push({x, y, w: 1, color: 'rgba(230,239,236,0.5)'})
  }

  const avatar = {size: 16, background: space, runs: [...stars, ...runs]}
  cache.set(key, avatar)
  return avatar
}
