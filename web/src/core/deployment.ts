// Where ZNS lives on each chain: deployments/<chain>.json, written by
// contracts/scripts/deploy.mjs and compiled into the page. A chain with no
// record has no ZNS, and the page says so instead of reading nothing.

import type {Address} from 'viem'

export interface Deployment {
  chainId: number
  contracts: {
    ENSRegistry: Address
    ReverseRegistrar: Address
    ZNSRegistrar: Address
    ZNSPriceFeed: Address
    ExponentialPremiumPriceOracle: Address
    ZNSController: Address
    PublicResolver: Address
    GatewayProvider: Address
    UniversalResolver: Address
    StaticBulkRenewal: Address
  }
  /** The first block that holds any of it: where log scans start. */
  startBlock: number
  /** When names opened, for the launch premium. Unix seconds. */
  launchTime: number
  owner: Address
  site?: string
  /** The release terms this deployment was made with (contracts/scripts/lib.mjs). */
  terms?: {network: string; startPremium: string; premiumDays: number; launchMaxLength: number}
}

// Only the top-level records: an archived deployment of the same chain lives
// in a subfolder and must not shadow the live one.
const records = import.meta.glob('../../../deployments/*.json', {eager: true, import: 'default'}) as Record<string, Deployment>

const byChain = new Map<number, Deployment>()
for (const rec of Object.values(records)) if (rec?.contracts?.ZNSController) byChain.set(rec.chainId, rec)

export function deploymentFor(chainId: number | null | undefined): Deployment | null {
  return chainId == null ? null : (byChain.get(chainId) ?? null)
}

export const knownChains = () => [...byChain.keys()]
