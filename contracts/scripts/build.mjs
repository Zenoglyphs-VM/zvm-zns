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
import {mkdirSync, writeFileSync} from 'node:fs'
import {namehash} from 'viem'
import {CONTRACTS, PAGE_ABIS, compilerInput} from './compiler-input.mjs'
export {CONTRACTS} from './compiler-input.mjs'

const require = createRequire(import.meta.url)
const solc = require('solc')

const input = compilerInput()
const sources = input.sources
if (!solc.version().startsWith('0.8.26+commit.8a97fa7a.')) throw new Error('solc 0.8.26 is required')

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

const dir = new URL('../out/', import.meta.url)
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

const web = new URL('../../web/src/abi.ts', import.meta.url)
mkdirSync(new URL('.', web), {recursive: true})
writeFileSync(
  web,
  '// Written by contracts/scripts/build.mjs from the contracts it compiles. Do not edit.\n' +
    PAGE_ABIS.map((n) => `export const ${n[0].toLowerCase()}${n.slice(1)}Abi = ${JSON.stringify(abis[n])} as const\n`).join(''),
)
console.log(`compiled with ${version}; ${Object.keys(sources).length} source units`)
