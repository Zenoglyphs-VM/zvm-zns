// Fresh complete source graph, actual ENS contracts, synthetic Paris frames.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createBlock} from '@ethereumjs/block'
import {createCustomCommon, Hardfork, Mainnet} from '@ethereumjs/common'
import {createAccount, createAddressFromString, bytesToHex, hexToBytes} from '@ethereumjs/util'
import {createVM} from '@ethereumjs/vm'
import {createPublicClient, custom, decodeErrorResult, decodeEventLog, decodeFunctionResult,
  defineChain, encodeDeployData, encodeFunctionData, getAddress, labelhash, namehash, zeroAddress, zeroHash} from 'viem'
import solc from 'solc'
import {readFileSync} from 'node:fs'
import {CONTRACTS, PAGE_ABIS, compilerInput} from '../scripts/compiler-input.mjs'

export const YEAR = 31_536_000n, DAY = 86_400n, GRACE = 90n * DAY, E18 = 10n ** 18n
export const BURN = '0x000000000000000000000000000000000000dEaD'
export const ZERO = zeroAddress, HASH_ZERO = zeroHash
export const NODES = {root: zeroHash, znn: namehash('znn'), reverse: namehash('reverse'), addrReverse: namehash('addr.reverse')}
export const terms = {
  feedAnswer: 100_000_000n, rentPrices: [128n, 128n, 128n, 32n, 1n].map((n) => n * E18 / YEAR),
  startPremium: 100_000n * E18, premiumDays: 21n, launchMaxLength: 6n, minAge: 60n, maxAge: DAY,
}
const require = createRequire(import.meta.url)
assert.match(solc.version(), /^0\.8\.26\+commit\.8a97fa7a\./, 'the locked Solidity compiler is required')
export const input = compilerInput((unit) => require.resolve(unit))
const compiled = JSON.parse(solc.compile(JSON.stringify(input)))
assert.deepEqual((compiled.errors ?? []).filter((e) => e.severity === 'error'), [], 'current production sources must compile')
export const artifacts = Object.fromEntries(Object.entries(CONTRACTS).map(([name, unit]) => {
  const c = compiled.contracts[unit][name]
  assert.ok(c.evm.deployedBytecode.object.length / 2 <= 24_576, name + ' exceeds EIP-170')
  return [name, {contractName: name, sourceName: unit, compilerVersion: 'v0.8.26+commit.8a97fa7a',
    abi: c.abi, bytecode: '0x' + c.evm.bytecode.object}]
}))
export const frontendAbi = '// Written by contracts/scripts/build.mjs from the contracts it compiles. Do not edit.\n' +
  PAGE_ABIS.map((name) => `export const ${name[0].toLowerCase()}${name.slice(1)}Abi = ${JSON.stringify(artifacts[name].abi)} as const\n`).join('')
const fixtureInput = {language: 'Solidity', sources: {'Fixtures.sol': {content: readFileSync(new URL('./Fixtures.sol', import.meta.url), 'utf8')}},
  settings: {evmVersion: 'paris', optimizer: {enabled: true, runs: 200}, outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}}}}
const fixtureOutput = JSON.parse(solc.compile(JSON.stringify(fixtureInput)))
assert.deepEqual((fixtureOutput.errors ?? []).filter((e) => e.severity === 'error'), [])
export const fixtureArtifacts = Object.fromEntries(Object.entries(fixtureOutput.contracts['Fixtures.sol']).map(([name, c]) =>
  [name, {abi: c.abi, bytecode: '0x' + c.evm.bytecode.object}]))

export async function fixture() {
  const common = createCustomCommon({chainId: 7340469}, Mainnet, {hardfork: Hardfork.Paris})
  const vm = await createVM({common})
  const actors = Array.from({length: 7}, (_, n) => '0x' + (0x10000n + BigInt(n)).toString(16).padStart(40, '0'))
  const [deployer, owner, alice, bob, carol, market, recipient] = actors
  const address = (at) => createAddressFromString(at)
  const initial = 10n ** 30n
  for (const actor of actors) await vm.stateManager.putAccount(address(actor), createAccount({balance: initial}))
  const abis = new Map(), c = {}
  let timestamp = 1_900_000_000n, blockNumber = 100n
  const root = async () => bytesToHex(await vm.stateManager.getStateRoot())
  const balance = async (at) => (await vm.stateManager.getAccount(address(at)))?.balance ?? 0n
  function later(seconds) { assert.ok(BigInt(seconds) >= 0n); timestamp += BigInt(seconds); blockNumber++ }
  function atTime(value) { assert.ok(value >= timestamp, 'fixture time cannot move backwards'); later(value - timestamp) }
  async function frame({from = owner, to, data = '0x', value = 0n, gas = 50_000_000n, isStatic = false, error, allowFailure = false}) {
    vm.stateManager.originalStorageCache.clear(); vm.evm.journal.cleanJournal()
    const before = to ? await root() : undefined
    const block = createBlock({header: {timestamp, number: blockNumber, gasLimit: 60_000_000n}}, {common})
    // Message frames transfer value and roll back on failure. They have no
    // signatures, inclusion, intrinsic gas, transaction fee charging or ZVM.
    const result = await vm.evm.runCall({caller: address(from), ...(to ? {to: address(to)} : {}), data: hexToBytes(data),
      value, gasLimit: gas, isStatic, skipNonceIncrement: Boolean(to), block})
    const returned = bytesToHex(result.execResult.returnValue), failed = Boolean(result.execResult.exceptionError)
    if (error !== undefined) {
      assert.ok(failed, 'expected EVM failure')
      if (typeof error === 'string') {
        const decoded = decodeErrorResult({abi: [...Object.values(artifacts).flatMap((a) => a.abi), ...Object.values(fixtureArtifacts).flatMap((a) => a.abi)], data: returned})
        if (decoded.errorName === 'Error') assert.equal(decoded.args[0], error)
        else assert.equal(decoded.errorName, error)
      }
    } else if (!allowFailure) assert.equal(result.execResult.exceptionError, undefined, `EVM frame failed: ${returned}`)
    if (failed) {
      if (to) assert.equal(await root(), before, 'failed frames restore the entire state root and all balances')
      assert.equal(result.execResult.logs?.length ?? 0, 0, 'failed frames retain no events')
    }
    return {...result, returned, failed}
  }
  async function deploy(artifact, args = [], options = {}) {
    const result = await frame({from: deployer, data: encodeDeployData({abi: artifact.abi, bytecode: artifact.bytecode, args}), ...options})
    if (options.error !== undefined) return result
    const at = getAddress(result.createdAddress.toString())
    assert.ok((await vm.stateManager.getCode(address(at))).length > 0)
    abis.set(at.toLowerCase(), artifact.abi); return at
  }
  const named = (name) => c[name] ?? name
  async function write(from, target, functionName, args = [], value = 0n, options = {}) {
    const to = named(target), abi = abis.get(to.toLowerCase())
    assert.ok(abi, 'an explicit freshly compiled ABI is required')
    return frame({from, to, data: encodeFunctionData({abi, functionName, args}), value, ...options})
  }
  async function read(target, functionName, args = []) {
    const to = named(target), abi = abis.get(to.toLowerCase())
    const result = await frame({to, data: encodeFunctionData({abi, functionName, args}), isStatic: true})
    return decodeFunctionResult({abi, functionName, data: result.returned})
  }
  function events(result) {
    return (result.execResult.logs ?? []).map(([at, topics, data]) => {
      const location = bytesToHex(at)
      return {address: location, ...decodeEventLog({abi: abis.get(location.toLowerCase()), topics: topics.map(bytesToHex), data: bytesToHex(data)})}
    })
  }
  async function deployNamed(name, args = []) { c[name] = await deploy(artifacts[name], args); return c[name] }
  await deployNamed('ENSRegistry')
  await write(deployer, 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('reverse'), deployer])
  await deployNamed('ReverseRegistrar', [c.ENSRegistry])
  await write(deployer, 'ENSRegistry', 'setSubnodeOwner', [NODES.reverse, labelhash('addr'), c.ReverseRegistrar])
  await deployNamed('ZNSRegistrar', [c.ENSRegistry, NODES.znn, 'https://example.invalid/zns/'])
  await write(deployer, 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('znn'), c.ZNSRegistrar])
  await deployNamed('ZNSPriceFeed', [terms.feedAnswer])
  await deployNamed('ExponentialPremiumPriceOracle', [c.ZNSPriceFeed, terms.rentPrices, terms.startPremium, terms.premiumDays])
  await deployNamed('ZNSController', [c.ZNSRegistrar, c.ExponentialPremiumPriceOracle, terms.minAge, terms.maxAge, c.ReverseRegistrar, c.ENSRegistry, terms.launchMaxLength])
  await write(deployer, 'ZNSRegistrar', 'addController', [c.ZNSController])
  await write(deployer, 'ReverseRegistrar', 'setController', [c.ZNSController, true])
  await deployNamed('PublicResolver', [c.ENSRegistry, ZERO, c.ZNSController, c.ReverseRegistrar])
  await write(deployer, 'ReverseRegistrar', 'setDefaultResolver', [c.PublicResolver])
  await deployNamed('GatewayProvider', [owner, ['x-batch-gateway:true']])
  await deployNamed('UniversalResolver', [owner, c.ENSRegistry, c.GatewayProvider])
  await deployNamed('StaticBulkRenewal', [c.ZNSController])
  await write(deployer, 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('reverse'), owner])
  await write(deployer, 'ENSRegistry', 'setOwner', [NODES.root, owner])
  for (const name of ['ZNSRegistrar', 'ReverseRegistrar', 'ZNSPriceFeed', 'ZNSController']) await write(deployer, name, 'transferOwnership', [owner])
  function registration(label, who = alice, options = {}) {
    const resolver = options.resolver ?? c.PublicResolver, node = namehash(label + '.znn')
    const data = resolver === ZERO ? [] : [encodeFunctionData({abi: artifacts.PublicResolver.abi, functionName: 'setAddr', args: [node, who]})]
    return {label, owner: who, duration: YEAR, secret: '0x' + '11'.repeat(32), resolver, data,
      reverseRecord: resolver === ZERO ? 0 : 1, referrer: HASH_ZERO, ...options}
  }
  async function commit(reg, from = alice) {
    const commitment = await read('ZNSController', 'makeCommitment', [reg])
    await write(from, 'ZNSController', 'commit', [commitment]); return commitment
  }
  async function price(reg) { return read('ZNSController', 'rentPrice', [reg.label, reg.duration]) }
  async function register(reg, {from = alice, extra = 0n} = {}) {
    await commit(reg, from); later(terms.minAge)
    const quote = await price(reg)
    return write(from, 'ZNSController', 'register', [reg], quote.base + quote.premium + extra)
  }
  async function conserved() {
    const addresses = new Set([...actors, BURN, ...abis.keys()].map((a) => a.toLowerCase()))
    let total = 0n
    for (const at of addresses) total += await balance(at)
    assert.equal(total, BigInt(actors.length) * initial, 'the complete known synthetic native-value inventory is conserved')
  }
  const rpcMethods = []
  const provider = {async request({method, params}) {
    rpcMethods.push(method)
    if (method === 'eth_chainId') return '0x' + BigInt(common.chainId()).toString(16)
    assert.equal(method, 'eth_call', 'the in-process ENS adapter only permits static calls')
    const [call] = params
    const result = await frame({from: call.from ?? owner, to: call.to, data: call.data ?? '0x', isStatic: true, allowFailure: true})
    if (result.failed) throw Object.assign(new Error('execution reverted'), {code: 3, data: result.returned})
    return result.returned
  }}
  const chain = defineChain({id: 7340469, name: 'Isolated fixture', nativeCurrency: {name: 'Fixture', symbol: 'FIX', decimals: 18},
    rpcUrls: {default: {http: []}}, contracts: {ensUniversalResolver: {address: c.UniversalResolver}}})
  const client = createPublicClient({chain, transport: custom(provider, {retryCount: 0}), ccipRead: false})
  return {vm, actors, deployer, owner, alice, bob, carol, market, recipient, c, root, balance, frame, deploy,
    write, read, events, registration, commit, price, register, later, atTime, conserved, client, rpcMethods,
    get timestamp() { return timestamp }}
}
