// What a person types, turned into a name, by the controller's own rule.
//
// The contract refuses anything but 3 to 63 characters of a-z, 0-9 and "-"
// (ZNSController.valid), so the page applies the same rule before it asks,
// and says which part failed rather than "invalid". Upper case is folded,
// because nobody means "Alice" to be a different name from "alice", and every
// name this rule accepts is already in the normal form ENS tools expect.

import {labelhash, namehash, type Hex} from 'viem'

export const TLD = 'znn'

export interface Parsed {
  /** What was typed, trimmed and lower-cased. */
  input: string
  /** The second-level label, "alice" in "pay.alice.znn". */
  label: string
  /** Labels below it, outermost first: ["pay"] in "pay.alice.znn". */
  sub: string[]
  /** "pay.alice.znn" */
  full: string
  /** Why it cannot be a .znn name, in words; null when it can. */
  problem: string | null
}

export function labelProblem(label: string): string | null {
  if (!label) return 'Type a name.'
  if (/[A-Z]/.test(label)) return 'Names are lower case.'
  if (/[^a-z0-9-]/.test(label)) return 'Only a-z, 0-9 and "-" are allowed.'
  if (label.length < 3) return 'Names are at least 3 characters.'
  if (label.length > 63) return 'Names are at most 63 characters.'
  if (label.startsWith('-') || label.endsWith('-')) return 'A name cannot start or end with "-".'
  if (label[2] === '-' && label[3] === '-') return '"--" cannot be the third and fourth characters.'
  return null
}

export function parse(raw: string): Parsed {
  const input = raw.trim().toLowerCase().replace(/\.+$/, '')
  const parts = input.replace(new RegExp(`\\.${TLD}$`), '').split('.').filter(Boolean)
  const label = parts.pop() ?? ''
  const sub = parts
  const full = [...sub, label].filter(Boolean).join('.') + `.${TLD}`
  let problem = labelProblem(label)
  if (!problem) for (const s of sub) if (!/^[a-z0-9-]{1,63}$/.test(s)) problem = 'Subnames use a-z, 0-9 and "-".'
  return {input, label, sub, full, problem}
}

export const tokenId = (label: string): bigint => BigInt(labelhash(label))
export const nodeOf = (full: string): Hex => namehash(full)

/** Characters, not bytes; the same count the contract prices by for these labels. */
export const lengthOf = (label: string) => [...label].length

/** Zenon's pink for three characters, NoM blue for four, ZVM green for five
 *  and up: the tier colours on every name's card. */
export function tintOf(label: string): string {
  const n = lengthOf(label)
  if (n <= 3) return 'var(--new-ink)'
  if (n === 4) return 'var(--nom-ink)'
  return 'var(--znn-ink)'
}

export function tierOf(label: string): string {
  const n = lengthOf(label)
  return n <= 3 ? '3 characters' : n === 4 ? '4 characters' : '5 or more'
}

/** An address as typed: 0x plus 40 hex digits, any case. */
export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
