// Every number a person reads comes from the shared formatter, so this page
// and the explorer round, group and truncate identically.

import * as base from '@zvm/web/format'

export {ago, compact, number, percent, short, units, timestamp} from '@zvm/web/format'

export const ZERO = '0x0000000000000000000000000000000000000000'

export const isZero = (a: string | null | undefined) => !a || /^0x0{40}$/i.test(a)

export const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * ZNN from wei, rounded to `frac` places, fewer when whole. Rounded, not cut:
 * a year of 5-character rent is 31,709,791,983 wei a second, which comes to
 * 0.99999999997 ZNN and would otherwise read as 0.99.
 */
export const znn = (wei: bigint | null | undefined, frac = 4) =>
  wei == null ? '-' : base.units(wei + 5n * 10n ** BigInt(17 - frac), 18, frac, '-')

/** A calendar date in the reader's own locale: 29 Sep 2027. */
export function date(ts: number | null | undefined): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})
}

/** Seconds to a short span: 3d 4h, 5h 12m, 42s. */
export function span(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s >= 365 * 86400) {
    const y = s / (365 * 86400)
    return `${y >= 10 ? Math.round(y) : y.toFixed(1).replace(/\.0$/, '')}y`
  }
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

/** "1 year", "3 years", "28 days". */
export function term(seconds: number): string {
  const years = seconds / (365 * 86400)
  if (Number.isInteger(years)) return years === 1 ? '1 year' : `${years} years`
  const days = Math.round(seconds / 86400)
  return days === 1 ? '1 day' : `${days} days`
}
