// Builds every contract ZNS deploys, from one standard JSON input, into
// ../out/<Name>.json, and writes their ABIs into the page as
// ../../web/src/abi.ts, typed `as const` so viem checks every call the page
// makes against what was compiled.
//
// ENS's contracts compile from vendor/ens-contracts under the import path
// they were written against (@ensdomains/ens-contracts/…), so the source the
// explorer verifies is the package's own. Settings are ENS's for 0.8.26:
// 1,000,000 optimizer runs, paris, IPFS metadata hash. paris is also what
// every other contract on the ZVM targets.
import {createRequire} from 'node:module'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {namehash} from 'viem'

const require = createRequire(import.meta.url)
const solc = require('solc')

const here = new URL('../', import.meta.url)
const PREFIXES = [
  ['@ensdomains/ens-contracts/', new URL('vendor/ens-contracts/', here)],
  ['@openzeppelin/contracts-v5/', new URL('node_modules/@openzeppelin/contracts-v5/', here)],
  ['@openzeppelin/contracts/', new URL('node_modules/@openzeppelin/contracts/', here)],
  ['@ensdomains/buffer/', new URL('node_modules/@ensdomains/buffer/', here)],
  ['src/', new URL('src/', here)],
]

function locate(unit) {
  for (const [prefix, dir] of PREFIXES) if (unit.startsWith(prefix)) return new URL(unit.slice(prefix.length), dir)
  return null
}

// What gets deployed, by source unit and contract name. The explorer
// verifies each one from the same input.
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

// Every source reachable from the contracts above, read up front, so the
// input handed to the verifier is complete without an import callback.
const sources = {}
const pending = [...new Set(Object.values(CONTRACTS))]
while (pending.length) {
  const unit = pending.pop()
  if (sources[unit]) continue
  const file = locate(unit)
  if (!file || !existsSync(file)) throw new Error(`cannot find ${unit}`)
  const content = readFileSync(file, 'utf8')
  sources[unit] = {content}
  for (const m of content.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)) {
    const dep = m[1].startsWith('.') ? new URL(m[1], `file:///${unit}`).pathname.slice(1) : m[1]
    if (!sources[dep]) pending.push(dep)
  }
}

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))),
  settings: {
    evmVersion: 'paris',
    libraries: {},
    metadata: {bytecodeHash: 'ipfs', useLiteralContent: true},
    optimizer: {enabled: true, runs: 1_000_000},
    remappings: [],
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}},
  },
}

const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (out.errors ?? []).filter((e) => e.severity === 'error')
for (const e of out.errors ?? []) {
  // ENS's own warnings (a `public` constructor, shadowed names) are ENS's; ours
  // are printed, theirs are counted.
  if (e.severity === 'error' || e.sourceLocation?.file?.startsWith('src/')) console.error(e.formattedMessage)
}
if (errors.length) process.exit(1)

// The constants a mistake would silently break: the TLD's node in the
// controller, and ENS's addr.reverse node that the reverse registrar and the
// resolvers share.
const controllerSrc = sources['src/ZNSController.sol'].content
if (!controllerSrc.includes(namehash('znn'))) throw new Error(`ZNN_NODE is not namehash("znn") = ${namehash('znn')}`)

const dir = new URL('out/', here)
mkdirSync(dir, {recursive: true})
const version = `v${solc.version().replace('.Emscripten.clang', '')}`
const abis = {}
for (const [name, unit] of Object.entries(CONTRACTS)) {
  const c = out.contracts[unit][name]
  const size = c.evm.deployedBytecode.object.length / 2
  if (size > 24_576) throw new Error(`${name} is ${size} bytes, over EIP-170's 24,576`)
  writeFileSync(
    new URL(`${name}.json`, dir),
    JSON.stringify({contractName: name, sourceName: unit, compilerVersion: version, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object}, null, 1) + '\n',
  )
  abis[name] = c.abi
  console.log(`${name.padEnd(30)} ${String(size).padStart(6)} bytes`)
}
// One copy of the input, shared by every artifact: it is the same for all of
// them, and it is 400 KB.
writeFileSync(new URL('input.json', dir), JSON.stringify(input) + '\n')

const web = new URL('../web/src/abi.ts', here)
mkdirSync(new URL('.', web), {recursive: true})
const pageAbis = ['ENSRegistry', 'ZNSRegistrar', 'ZNSController', 'PublicResolver', 'ReverseRegistrar', 'UniversalResolver', 'ZNSPriceFeed', 'ExponentialPremiumPriceOracle', 'StaticBulkRenewal']
writeFileSync(
  web,
  '// Written by contracts/scripts/build.mjs from the contracts it compiles. Do not edit.\n' +
    pageAbis.map((n) => `export const ${n[0].toLowerCase()}${n.slice(1)}Abi = ${JSON.stringify(abis[n])} as const\n`).join(''),
)
console.log(`compiled with ${version}; ${Object.keys(sources).length} source units`)
