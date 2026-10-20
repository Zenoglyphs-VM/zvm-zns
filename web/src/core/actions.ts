// Everything a person can do to a name, as the transactions it takes. Each
// builder returns calls for runCalls, which sends them one at a time and
// waits for each to execute before the next is estimated.

import {encodeFunctionData, labelhash, zeroAddress, zeroHash, type Address, type Hex} from 'viem'
import {
  eNSRegistryAbi,
  publicResolverAbi,
  reverseRegistrarAbi,
  staticBulkRenewalAbi,
  zNSControllerAbi,
  zNSPriceFeedAbi,
  zNSRegistrarAbi,
} from '../abi'
import type {Call} from './tx'
import {nodeOf, tokenId} from './names'
import {rentPrice, zns} from './zns'

const c = () => zns().d.contracts

/** Rent plus a sliver for a price moved in between; the controller refunds
 *  the rest. */
const withMargin = (v: bigint) => v + v / 200n

export async function renewCall(label: string, seconds: number): Promise<Call> {
  const p = await rentPrice(label, seconds)
  return {
    to: c().ZNSController,
    data: encodeFunctionData({abi: zNSControllerAbi, functionName: 'renew', args: [label, BigInt(seconds), zeroHash]}),
    value: withMargin(p.base),
    label: `Renew ${label}.znn`,
  }
}

/** Several names in one transaction, through ENS's StaticBulkRenewal, which
 *  sends back whatever is over. */
export async function renewAllCall(labels: string[], seconds: number): Promise<Call> {
  const {d, client} = zns()
  const total = await client.readContract({
    address: d.contracts.StaticBulkRenewal,
    abi: staticBulkRenewalAbi,
    functionName: 'rentPrice',
    args: [labels, BigInt(seconds)],
  })
  return {
    to: d.contracts.StaticBulkRenewal,
    data: encodeFunctionData({abi: staticBulkRenewalAbi, functionName: 'renewAll', args: [labels, BigInt(seconds), zeroHash]}),
    value: withMargin(total),
    label: `Renew ${labels.length} names`,
  }
}

export function transferCall(label: string, from: Address, to: Address): Call {
  return {
    to: c().ZNSRegistrar,
    data: encodeFunctionData({abi: zNSRegistrarAbi, functionName: 'safeTransferFrom', args: [from, to, tokenId(label)]}),
    value: 0n,
    label: `Send ${label}.znn`,
  }
}

/** Takes the registry node back for the token's holder, when someone else
 *  was made its manager. */
export function reclaimCall(label: string, to: Address): Call {
  return {
    to: c().ZNSRegistrar,
    data: encodeFunctionData({abi: zNSRegistrarAbi, functionName: 'reclaim', args: [tokenId(label), to]}),
    value: 0n,
    label: `Take back control of ${label}.znn`,
  }
}

export interface RecordChanges {
  addr?: Address | null
  texts?: Record<string, string>
}

/** Every changed record in one transaction, through the resolver's multicall. */
export function recordsCall(full: string, resolver: Address, changes: RecordChanges): Call | null {
  const node = nodeOf(full)
  const data: Hex[] = []
  if (changes.addr !== undefined) {
    data.push(encodeFunctionData({abi: publicResolverAbi, functionName: 'setAddr', args: [node, changes.addr ?? zeroAddress]}))
  }
  for (const [key, value] of Object.entries(changes.texts ?? {})) {
    data.push(encodeFunctionData({abi: publicResolverAbi, functionName: 'setText', args: [node, key, value]}))
  }
  if (!data.length) return null
  return {
    to: resolver,
    data: encodeFunctionData({abi: publicResolverAbi, functionName: 'multicall', args: [data]}),
    value: 0n,
    label: data.length === 1 ? `Update ${full}` : `Update ${data.length} records on ${full}`,
  }
}

/** Points a name the page's resolver does not serve at the public resolver. */
export function useResolverCall(full: string): Call {
  return {
    to: c().ENSRegistry,
    data: encodeFunctionData({abi: eNSRegistryAbi, functionName: 'setResolver', args: [nodeOf(full), c().PublicResolver]}),
    value: 0n,
    label: `Use the public resolver for ${full}`,
  }
}

/** Names the connected wallet: its reverse record. An empty name clears it. */
export function primaryCall(full: string): Call {
  return {
    to: c().ReverseRegistrar,
    data: encodeFunctionData({abi: reverseRegistrarAbi, functionName: 'setName', args: [full]}),
    value: 0n,
    label: full ? `Make ${full} your primary name` : 'Clear your primary name',
  }
}

/**
 * A subname, made the way the page can read it back: owned by the maker for
 * a moment, so it can set the address and record its own label (the
 * registry keeps only a hash), then handed to `holder` if that is someone
 * else.
 */
export function subnameCalls(parent: string, sub: string, target: Address, me: Address, handOver: boolean): Call[] {
  const full = `${sub}.${parent}`
  const node = nodeOf(full)
  const calls: Call[] = [
    {
      to: c().ENSRegistry,
      data: encodeFunctionData({
        abi: eNSRegistryAbi,
        functionName: 'setSubnodeRecord',
        args: [nodeOf(parent), labelhash(sub), me, c().PublicResolver, 0n],
      }),
      value: 0n,
      label: `Create ${full}`,
    },
    {
      to: c().PublicResolver,
      data: encodeFunctionData({
        abi: publicResolverAbi,
        functionName: 'multicall',
        args: [
          [
            encodeFunctionData({abi: publicResolverAbi, functionName: 'setAddr', args: [node, target]}),
            encodeFunctionData({abi: publicResolverAbi, functionName: 'setName', args: [node, full]}),
          ],
        ],
      }),
      value: 0n,
      label: `Point ${full} at ${target.slice(0, 6)}…${target.slice(-4)}`,
    },
  ]
  if (handOver && target.toLowerCase() !== me.toLowerCase()) {
    calls.push({
      to: c().ENSRegistry,
      data: encodeFunctionData({abi: eNSRegistryAbi, functionName: 'setOwner', args: [node, target]}),
      value: 0n,
      label: `Give ${full} to its address`,
    })
  }
  return calls
}

/** Removes a subname: no owner, no resolver, so it resolves to nothing. */
export function deleteSubnameCall(parent: string, sub: string): Call {
  return {
    to: c().ENSRegistry,
    data: encodeFunctionData({
      abi: eNSRegistryAbi,
      functionName: 'setSubnodeRecord',
      args: [nodeOf(parent), labelhash(sub), zeroAddress, zeroAddress, 0n],
    }),
    value: 0n,
    label: `Delete ${sub}.${parent}`,
  }
}

// --- the owner's -----------------------------------------------------------

/** Rescales every price: the feed's answer is what one "oracle unit" is
 *  worth, so 1e8 is 1:1 and 5e7 doubles every price. */
export function feedCall(answer: bigint): Call {
  return {
    to: c().ZNSPriceFeed,
    data: encodeFunctionData({abi: zNSPriceFeedAbi, functionName: 'set', args: [answer]}),
    value: 0n,
    label: 'Set the price feed',
  }
}
