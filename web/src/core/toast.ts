// Short notices in a corner: a purchase executed, a listing signed, a wallet
// refusal. The step rail on the page carries the detail; a toast only says the
// outcome, so a person who scrolled away still hears it.

import {reactive} from 'vue'

export type Tone = 'good' | 'bad' | 'info'

export interface Toast {
  id: number
  text: string
  tone: Tone
  link?: {to: string; label: string}
}

export const toasts = reactive<{items: Toast[]}>({items: []})

let next = 1

export function toast(text: string, tone: Tone = 'info', link?: Toast['link'], ms = 5200) {
  const id = next++
  toasts.items = [...toasts.items.slice(-3), {id, text, tone, link}]
  window.setTimeout(() => dismiss(id), ms)
}

export function dismiss(id: number) {
  toasts.items = toasts.items.filter((t) => t.id !== id)
}
