// The names of the chains this app knows, for the node picker and a wallet's
// add-chain prompt. Where ZNS is deployed on each comes from
// deployments/<chain>.json, compiled in (core/deployment.ts).

export const CHAIN_NAMES: Record<number, string> = {
  7340469: 'ZVM devnet',
}

export function chainName(chainId: number | null): string {
  if (chainId === null) return 'Unknown chain'
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`
}
