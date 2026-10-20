// Where a name goes outside this page: Karum to sell it, the node's explorer
// for its contract, and a calendar for the day it expires.

import {deploymentFor} from './deployment'
import {endpoint} from './endpoint'
import {tokenId} from './names'

/** Karum, the ZVM's NFT market: under VITE_GATEWAY, unless VITE_KARUM_URL names another. */
export const KARUM = ((import.meta.env.VITE_KARUM_URL as string | undefined) || `${(import.meta.env.VITE_GATEWAY as string).replace(/\/+$/, '')}/karum/`).replace(/\/?$/, '/')

/** The name's page on Karum. `list` opens the listing form there, for the
 *  holder, so selling is one click from here. */
export function karumItem(label: string, list = false): string | null {
  const d = deploymentFor(endpoint.chainId)
  if (!d) return null
  return `${KARUM}item/${d.contracts.ZNSRegistrar}/${tokenId(label)}${list ? '?list=1' : ''}`
}

export function karumCollection(): string | null {
  const d = deploymentFor(endpoint.chainId)
  return d ? `${KARUM}collection/${d.contracts.ZNSRegistrar}` : null
}

export const explorer = (path: string) => (endpoint.apiBase ? `${endpoint.apiBase}${path}` : null)

/**
 * An iCalendar file with two reminders for a name's expiry: a month before
 * and a week before. Nothing on chain reminds anyone, and a name lost to a
 * forgotten renewal goes to auction after its grace period.
 */
export function expiryCalendar(full: string, expires: number, page: string): Blob {
  const stamp = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10).replace(/-/g, '')
  const event = (uid: string, t: number, summary: string) =>
    [
      'BEGIN:VEVENT',
      `UID:${uid}@zns`,
      `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
      `DTSTART;VALUE=DATE:${day(t)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:Renew at ${page}`,
      `URL:${page}`,
      'END:VEVENT',
    ].join('\r\n')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZNS//expiry//EN',
    event(`${full}-30d`, expires - 30 * 86400, `${full} expires in 30 days`),
    event(`${full}-7d`, expires - 7 * 86400, `${full} expires in 7 days`),
    event(`${full}-0d`, expires, `${full} expires today`),
    'END:VCALENDAR',
  ].join('\r\n')
  return new Blob([ics], {type: 'text/calendar'})
}
