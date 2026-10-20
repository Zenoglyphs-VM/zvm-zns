// Reading ZNS: prices, a name's state, its records, and the two directions of
// resolution. Everything is an eth_call; the public client batches calls made
// in the same tick into one request, so a page that asks for ten things at
// once is one round trip.
//
// Resolution goes through the UniversalResolver with viem's own getEnsName /
// getEnsAddress, exactly as any other ENS-aware page on the ZVM would, so what
// this page shows is what they would show.

import {reactive} from 'vue'
import {getEnsAddress, getEnsName, getEnsText} from 'viem/ens'
import {concat, createPublicClient, http, keccak256, zeroAddress, type Address, type Hex} from 'viem'
import {
  eNSRegistryAbi,
  exponentialPremiumPriceOracleAbi,
  publicResolverAbi,
  reverseRegistrarAbi,
  zNSControllerAbi,
  zNSPriceFeedAbi,
  zNSRegistrarAbi,
} from '../abi'
import {publicClient, zvmChain} from '@zvm/web/evm'
import {config} from '@zvm/web/config'
import {endpoint} from './endpoint'
import {chain} from './chain'
import {deploymentFor, type Deployment} from './deployment'
import {nodeOf, tokenId} from './names'

export const YEAR = 31_536_000
export const DAY = 86_400
export const GRACE = 90 * DAY
export const PREMIUM_DAYS = 21

export function zns(): {d: Deployment; client: ReturnType<typeof publicClient>} {
  const d = deploymentFor(endpoint.chainId)
  if (!d || endpoint.chainId === null) throw new Error('ZNS is not deployed on the chain this node serves.')
  return {d, client: publicClient(endpoint.chainId)}
}

/** Chain time, not the browser's: expiry is judged by the block's clock. */
export const chainNow = () => chain.timestamp ?? Math.floor(Date.now() / 1000)

// --- prices -------------------------------------------------------------------

export interface Price {
  base: bigint
  premium: bigint
}

export async function rentPrice(label: string, seconds: number): Promise<Price> {
  const {d, client} = zns()
  const p = await client.readContract({
    address: d.contracts.ZNSController,
    abi: zNSControllerAbi,
    functionName: 'rentPrice',
    args: [label, BigInt(seconds)],
  })
  return {base: p.base, premium: p.premium}
}

/** Where the premium starts, in the oracle's unit: 5,000 ZNN on devnet,
 *  100,000 elsewhere. ENS's oracle keeps it in a private immutable, so the
 *  deployment record's terms are the page's source for it. */
export function startPremium(): bigint {
  const t = zns().d.terms
  return t ? BigInt(t.startPremium) : 100_000n * 10n ** 18n
}

/**
 * The premium `elapsed` seconds into its fall, by the oracle's own curve,
 * `decayedPremium`: halved every day, less what is left after 21 days, so it
 * reaches zero exactly then. Read from the contract so the page's forecast is
 * the contract's arithmetic, converted at the feed's rate.
 */
export async function premiumAfter(elapsed: number[]): Promise<bigint[]> {
  const {d, client} = zns()
  const answer = await feedAnswer()
  const start = startPremium()
  const end = start >> BigInt(PREMIUM_DAYS)
  return Promise.all(
    elapsed.map(async (e) => {
      if (e < 0) e = 0
      const v = await client.readContract({
        address: d.contracts.ExponentialPremiumPriceOracle,
        abi: exponentialPremiumPriceOracleAbi,
        functionName: 'decayedPremium',
        args: [start, BigInt(e)],
      })
      return v > end ? ((v - end) * 100_000_000n) / answer : 0n
    }),
  )
}

/** When a name's premium started falling: out of grace, or at launch for a
 *  short name that was never registered. */
export function premiumStart(label: string, expires: number): number {
  const d = zns().d
  if (expires === 0) return label.length <= (d.terms?.launchMaxLength ?? 6) ? d.launchTime : 0
  return expires + GRACE
}

export async function feedAnswer(): Promise<bigint> {
  const {d, client} = zns()
  const v = await client.readContract({address: d.contracts.ZNSPriceFeed, abi: zNSPriceFeedAbi, functionName: 'latestAnswer'})
  return BigInt(v)
}

// --- a name's state ----------------------------------------------------------

export type Status = 'invalid' | 'available' | 'auction' | 'registered' | 'grace'

export interface NameState {
  label: string
  full: string
  id: bigint
  node: Hex
  status: Status
  /** Unix seconds; 0 when never registered. */
  expires: number
  /** The token's holder, when the name is live. */
  registrant: Address | null
  /** Who controls the registry node: sets the resolver and makes subnames. */
  controller: Address | null
  resolver: Address | null
  /** For a year, at today's rate, premium included. */
  yearly: Price
}

export async function nameState(label: string, full = `${label}.znn`): Promise<NameState> {
  const {d, client} = zns()
  const id = tokenId(label)
  const node = nodeOf(full)
  const [valid, available, expires, controller, resolver, yearly] = await Promise.all([
    client.readContract({address: d.contracts.ZNSController, abi: zNSControllerAbi, functionName: 'valid', args: [label]}),
    client.readContract({address: d.contracts.ZNSController, abi: zNSControllerAbi, functionName: 'available', args: [label]}),
    client.readContract({address: d.contracts.ZNSRegistrar, abi: zNSRegistrarAbi, functionName: 'nameExpires', args: [id]}),
    client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'owner', args: [node]}),
    client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'resolver', args: [node]}),
    rentPrice(label, YEAR).catch(() => ({base: 0n, premium: 0n})),
  ])
  const exp = Number(expires)
  const now = chainNow()
  let status: Status
  if (!valid) status = 'invalid'
  else if (available) status = yearly.premium > 0n ? 'auction' : 'available'
  else status = exp > now ? 'registered' : 'grace'
  let registrant: Address | null = null
  if (status === 'registered') {
    registrant = await client
      .readContract({address: d.contracts.ZNSRegistrar, abi: zNSRegistrarAbi, functionName: 'ownerOf', args: [id]})
      .catch(() => null)
  } else if (status === 'grace') {
    // ownerOf refuses an expired name, but the token is still where it was,
    // and only that holder may renew it back.
    registrant = (await lastHolder(id)) ?? null
  }
  return {
    label,
    full,
    id,
    node,
    status,
    expires: exp,
    registrant,
    controller: controller === zeroAddress ? null : controller,
    resolver: resolver === zeroAddress ? null : resolver,
    yearly,
  }
}

/** The holder of a token whose ownerOf refuses to answer: the last Transfer's
 *  recipient, from the log index. */
let holderLookup: ((id: bigint) => Address | null) | null = null
export function setHolderLookup(fn: (id: bigint) => Address | null) {
  holderLookup = fn
}
async function lastHolder(id: bigint): Promise<Address | null> {
  return holderLookup?.(id) ?? null
}

// --- records -------------------------------------------------------------------

/** The text records the page offers to edit, in the order it shows them.
 *  Keys are ENSIP-5's global keys and ENSIP-18's service keys, so another
 *  ENS-aware app reads them the same way. */
export const TEXT_KEYS = [
  {key: 'avatar', label: 'Avatar', hint: 'An image URL, or eip155:<chain>/erc721:<contract>/<id> for an NFT you hold'},
  {key: 'description', label: 'Bio', hint: 'A line about you'},
  {key: 'url', label: 'Website', hint: 'https://'},
  {key: 'email', label: 'Email', hint: 'you@example.com'},
  {key: 'com.twitter', label: 'X', hint: 'handle, without the @'},
  {key: 'com.github', label: 'GitHub', hint: 'username'},
  {key: 'org.telegram', label: 'Telegram', hint: 'username'},
  {key: 'com.discord', label: 'Discord', hint: 'username'},
] as const

export interface Records {
  addr: Address | null
  texts: Record<string, string>
  /** The resolver's `name` on a forward node: set on subnames made here, so
   *  a subname's label can be read back (the registry keeps only its hash). */
  name: string
}

export async function records(node: Hex, resolver: Address | null): Promise<Records> {
  if (!resolver) return {addr: null, texts: {}, name: ''}
  const {client} = zns()
  const call = (functionName: any, args: any[]) =>
    client.readContract({address: resolver, abi: publicResolverAbi, functionName, args} as any).catch(() => null) as Promise<any>
  const [addr, name, ...texts] = await Promise.all([
    call('addr', [node]),
    call('name', [node]),
    ...TEXT_KEYS.map((t) => call('text', [node, t.key])),
  ])
  return {
    addr: addr && addr !== zeroAddress ? (addr as Address) : null,
    name: (name as string) ?? '',
    texts: Object.fromEntries(TEXT_KEYS.map((t, i) => [t.key, (texts[i] as string) ?? ''])),
  }
}

// --- resolution, both ways ----------------------------------------------------

function ensClient() {
  const {d} = zns()
  const base = zvmChain(endpoint.chainId!)
  return createPublicClient({
    chain: {...base, contracts: {ensUniversalResolver: {address: d.contracts.UniversalResolver}}},
    transport: http(config.rpcUrl(), {batch: {wait: 16}}),
  })
}

/** Primary names already read, so a list of fifty rows is not fifty lookups
 *  every time it redraws. Cleared when anything changes a reverse record. */
export const primaries = reactive(new Map<string, string | null>())
const inflight = new Map<string, Promise<string | null>>()

export async function primaryName(address: string, fresh = false): Promise<string | null> {
  const key = address.toLowerCase()
  if (!fresh && primaries.has(key)) return primaries.get(key)!
  if (!fresh && inflight.has(key)) return inflight.get(key)!
  const p = getEnsName(ensClient(), {address: address as Address})
    .catch(() => null)
    .then((name) => {
      primaries.set(key, name)
      inflight.delete(key)
      return name
    })
  inflight.set(key, p)
  return p
}

export async function resolveName(full: string): Promise<Address | null> {
  return getEnsAddress(ensClient(), {name: full}).catch(() => null)
}

export async function resolveText(full: string, key: string): Promise<string | null> {
  return getEnsText(ensClient(), {name: full, key}).catch(() => null)
}

/** What the reverse record claims, whether or not the name points back. The
 *  page needs it to explain a primary name that does not verify. */
export async function reverseClaim(address: Address): Promise<string> {
  const {d, client} = zns()
  const node = await client.readContract({address: d.contracts.ReverseRegistrar, abi: reverseRegistrarAbi, functionName: 'node', args: [address]})
  const resolver = await client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'resolver', args: [node]})
  if (resolver === zeroAddress) return ''
  return client.readContract({address: resolver, abi: publicResolverAbi, functionName: 'name', args: [node]}).catch(() => '')
}

// --- the token --------------------------------------------------------------

export interface TokenMeta {
  name: string
  image: string
  external_url?: string
  attributes?: {trait_type: string; value: unknown}[]
}

const metaCache = new Map<string, TokenMeta>()

/** The token's own metadata, decoded from its on-chain data: URI. Cached by
 *  id and expiry, the one thing on the card that changes. */
export async function tokenMeta(id: bigint, expires: number): Promise<TokenMeta | null> {
  const key = `${id}:${expires}`
  if (metaCache.has(key)) return metaCache.get(key)!
  const {d, client} = zns()
  try {
    const uri = await client.readContract({address: d.contracts.ZNSRegistrar, abi: zNSRegistrarAbi, functionName: 'tokenURI', args: [id]})
    const json = JSON.parse(atob(uri.split(',')[1]))
    metaCache.set(key, json)
    return json
  } catch {
    return null
  }
}

/** A controller or registry owner read, for the owner tools. */
export async function ownerOf(contract: 'ZNSController' | 'ZNSPriceFeed' | 'ZNSRegistrar'): Promise<Address> {
  const {d, client} = zns()
  const abi = contract === 'ZNSController' ? zNSControllerAbi : contract === 'ZNSPriceFeed' ? zNSPriceFeedAbi : zNSRegistrarAbi
  return client.readContract({address: d.contracts[contract], abi, functionName: 'owner'} as any) as Promise<Address>
}

// --- subnames ------------------------------------------------------------------

export interface Subname {
  labelhash: Hex
  node: Hex
  /** Readable when it was made here, which records it; null otherwise. */
  full: string | null
  owner: Address
  addr: Address | null
}

/**
 * A name's subnames, from the registry's NewOwner events under it. The
 * registry keeps only each label's hash; a subname made on this page also
 * carries its own full name in the resolver's `name` record, which is
 * checked against the node before it is believed.
 */
export async function subnamesOf(parent: string): Promise<Subname[]> {
  const {d, client} = zns()
  const parentNode = nodeOf(parent)
  const newOwner = eNSRegistryAbi.find((x) => x.type === 'event' && x.name === 'NewOwner')!
  const logs = await client.getLogs({
    address: d.contracts.ENSRegistry,
    event: newOwner as any,
    args: {node: parentNode} as any,
    fromBlock: BigInt(d.startBlock),
  })
  const hashes = [...new Set(logs.map((l: any) => l.args.label as Hex))]
  const rows = await Promise.all(
    hashes.map(async (lh) => {
      const node = keccak256(concat([parentNode, lh]))
      const owner = await client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'owner', args: [node]})
      if (owner === zeroAddress) return null
      const r = await records(node, await client.readContract({address: d.contracts.ENSRegistry, abi: eNSRegistryAbi, functionName: 'resolver', args: [node]}).then((x) => (x === zeroAddress ? null : x)))
      const full = r.name && nodeOf(r.name) === node ? r.name : null
      return {labelhash: lh, node, full, owner, addr: r.addr} as Subname
    }),
  )
  return rows.filter((r): r is Subname => !!r)
}
