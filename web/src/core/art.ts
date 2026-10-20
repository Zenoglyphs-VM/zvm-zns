// A name's card, drawn exactly as ZNSRegistrar._art draws it on chain.
//
// The token's own tokenURI is the source of truth, and the name page shows
// that. Lists draw this copy instead: a grid of forty names would otherwise be
// forty tokenURI calls of 4 KB each for pictures the page can draw itself,
// and a name that is not registered yet has no token to ask. Keep the two in
// step; `npm run verify` compares them byte for byte for a live name.

const tint = (len: number) => (len === 0 ? '#7b9094' : len <= 3 ? '#f91690' : len === 4 ? '#5da4ff' : '#00d557')

function date(t: number): string {
  // The contract's civil_from_days, which for any time after 1970 agrees with
  // the ISO date in UTC.
  return new Date(t * 1000).toISOString().slice(0, 10)
}

export function cardSvg(label: string, expires: number): string {
  const len = label.length
  const t = tint(len)
  let size = Math.floor(720 / ((len === 0 ? 64 : len) + 4))
  if (size > 92) size = 92
  if (size < 14) size = 14
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx=".15" cy=".1" r="1.15"><stop offset="0" stop-color="${t}" stop-opacity=".5"/><stop offset=".5" stop-color="${t}" stop-opacity=".07"/><stop offset="1" stop-color="#06090a" stop-opacity="0"/></radialGradient><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs><rect width="512" height="512" fill="#06090a"/><rect width="512" height="512" fill="url(#p)"/><rect width="512" height="512" fill="url(#g)"/>` +
    `<path d="M40 44h26L40 72h26" fill="none" stroke="${t}" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/>` +
    `<g font-family="Space Grotesk,ui-sans-serif,system-ui,Segoe UI,sans-serif"><text x="78" y="66" font-size="20" font-weight="600" letter-spacing="2" fill="#e6efec">ZNS</text><text x="40" y="292" font-size="${size}" font-weight="700" letter-spacing="-1" fill="#e6efec">${label || '?'}<tspan fill="${t}">.znn</tspan></text></g>` +
    `<text x="40" y="470" font-family="ui-monospace,Consolas,monospace" font-size="15" letter-spacing="1.5" fill="#7b9094">EXPIRES ${date(expires)}</text></svg>`
  )
}

export const cardUrl = (label: string, expires: number) => `data:image/svg+xml;base64,${btoa(cardSvg(label, expires))}`
