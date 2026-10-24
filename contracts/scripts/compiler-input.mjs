// The build and isolated tests read the same current source graph and settings.
import {createRequire} from 'node:module'
import {existsSync, readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const require = createRequire(import.meta.url)
const here = new URL('../', import.meta.url)
export const CONTRACTS = {
  ENSRegistry: '@ensdomains/ens-contracts/contracts/registry/ENSRegistry.sol',
  ReverseRegistrar: '@ensdomains/ens-contracts/contracts/reverseRegistrar/ReverseRegistrar.sol',
  ZNSRegistrar: 'src/ZNSRegistrar.sol',
  ZNSPriceFeed: 'src/ZNSPriceFeed.sol',
  ExponentialPremiumPriceOracle: '@ensdomains/ens-contracts/contracts/ethregistrar/ExponentialPremiumPriceOracle.sol',
  ZNSController: 'src/ZNSController.sol',
  PublicResolver: '@ensdomains/ens-contracts/contracts/resolvers/PublicResolver.sol',
  GatewayProvider: '@ensdomains/ens-contracts/contracts/ccipRead/GatewayProvider.sol',
  UniversalResolver: '@ensdomains/ens-contracts/contracts/universalResolver/UniversalResolver.sol',
  StaticBulkRenewal: '@ensdomains/ens-contracts/contracts/ethregistrar/StaticBulkRenewal.sol',
}
export const PAGE_ABIS = ['ENSRegistry', 'ZNSRegistrar', 'ZNSController', 'PublicResolver', 'ReverseRegistrar',
  'UniversalResolver', 'ZNSPriceFeed', 'ExponentialPremiumPriceOracle', 'StaticBulkRenewal']

export function compilerInput(resolvePackage = (unit) => require.resolve(unit)) {
  function locate(unit) {
    const vendor = '@ensdomains/ens-contracts/'
    if (unit.startsWith(vendor)) return new URL('vendor/ens-contracts/' + unit.slice(vendor.length), here)
    if (unit.startsWith('src/')) return new URL(unit, here)
    if (['@openzeppelin/contracts-v5/', '@openzeppelin/contracts/', '@ensdomains/buffer/'].some((prefix) => unit.startsWith(prefix))) {
      return pathToFileURL(resolvePackage(unit))
    }
    throw new Error(`unsupported source unit ${unit}`)
  }
  const sources = {}, pending = [...new Set(Object.values(CONTRACTS))]
  while (pending.length) {
    const unit = pending.pop()
    if (sources[unit]) continue
    const file = locate(unit)
    if (!existsSync(file)) throw new Error(`cannot find ${unit}`)
    const content = readFileSync(file, 'utf8')
    sources[unit] = {content}
    for (const match of content.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)) {
      const dependency = match[1].startsWith('.') ? new URL(match[1], `file:///${unit}`).pathname.slice(1) : match[1]
      if (!sources[dependency]) pending.push(dependency)
    }
  }
  return {
    language: 'Solidity',
    sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
    settings: {
      evmVersion: 'paris', libraries: {}, metadata: {bytecodeHash: 'ipfs', useLiteralContent: true},
      optimizer: {enabled: true, runs: 1_000_000}, remappings: [],
      outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}},
    },
  }
}
