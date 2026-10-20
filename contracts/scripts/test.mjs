// Every rule ZNS promises, against a real EVM: a fresh deployment on a local
// anvil, with time moved forward to reach expiry, grace and the premium's
// fall. Nothing here touches a live chain.
//
//   docker run -d --name zns-anvil -p 127.0.0.1:48749:8545 ghcr.io/foundry-rs/foundry:latest \
//     "anvil --host 0.0.0.0 --chain-id 7340469 --hardfork prague --gas-limit 60000000"
//   node scripts/test.mjs [rpc, default $ANVIL_RPC]
//
// Name resolution is checked through viem's own getEnsName / getEnsAddress /
// getEnsText against the deployed UniversalResolver, the way any ENS-aware
// page on the ZVM would do it.
import assert from 'node:assert/strict'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  labelhash,
  namehash,
  parseEther,
  zeroAddress,
} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {getEnsAddress, getEnsName, getEnsText} from 'viem/ens'
import {art, deploySystem, termsFor} from './lib.mjs'

const rpc = process.argv[2] ?? process.env.ANVIL_RPC
if (!rpc) throw new Error("pass the fork's JSON-RPC, or set ANVIL_RPC")
const base = defineChain({id: 7340469, name: 'anvil', nativeCurrency: {name: 'Zenon', symbol: 'ZNN', decimals: 18}, rpcUrls: {default: {http: [rpc]}}})
const reader = createPublicClient({chain: base, transport: http(rpc)})
const test = createTestClient({chain: base, mode: 'anvil', transport: http(rpc)})

const keys = Object.fromEntries(['deployer', 'owner', 'alice', 'bob', 'carol', 'market'].map((n) => [n, privateKeyToAccount(generatePrivateKey())]))
for (const a of Object.values(keys)) await test.setBalance({address: a.address, value: parseEther('1000000')})
const as = (who) => createWalletClient({account: keys[who], chain: base, transport: http(rpc)})
const {alice, bob, carol, owner, market} = keys

const rec = {chainId: base.id}
// The test runs on mainnet's terms, whatever chain id the anvil reports.
const c = await deploySystem({reader, wallet: as('deployer'), rec, save() {}, owner: owner.address, siteURL: 'https://devnet.example.org/zns/', terms: termsFor(1), log() {}})
console.log('deployed', Object.keys(c).length, 'contracts')

const chain = {...base, contracts: {ensUniversalResolver: {address: c.UniversalResolver}}}
const ens = createPublicClient({chain, transport: http(rpc)})

const abi = (n) => art(n).abi
const read = (name, functionName, args = []) => reader.readContract({address: c[name], abi: abi(name), functionName, args})
async function send(who, name, functionName, args = [], value = 0n) {
  const hash = await as(who).writeContract({address: c[name], abi: abi(name), functionName, args, value, gas: 15_000_000n})
  const r = await reader.waitForTransactionReceipt({hash})
  if (r.status !== 'success') throw new Error(`${functionName} reverted`)
  return r
}
async function reverts(fn, pattern) {
  try {
    await fn()
  } catch (e) {
    if (pattern) assert.match(`${e.shortMessage ?? ''} ${e.message ?? ''} ${e.cause?.data?.errorName ?? ''}`, pattern)
    return
  }
  assert.fail(`expected a revert${pattern ? ` matching ${pattern}` : ''}`)
}
// A revert found by simulating, which names the custom error.
const simulate = (who, name, functionName, args = [], value = 0n) =>
  reader.simulateContract({account: keys[who], address: c[name], abi: abi(name), functionName, args, value})
const later = async (seconds) => {
  await test.increaseTime({seconds})
  await test.mine({blocks: 1})
}
const now = async () => Number((await reader.getBlock()).timestamp)
const YEAR = 31_536_000n
let passed = 0
const ok = (what) => {
  passed++
  console.log(`  ok  ${what}`)
}

// --- wiring ------------------------------------------------------------------

const lower = (a) => a.toLowerCase()
assert.equal(lower(await read('ENSRegistry', 'owner', [namehash('')])), lower(owner.address))
assert.equal(lower(await read('ENSRegistry', 'owner', [namehash('znn')])), lower(c.ZNSRegistrar))
assert.equal(lower(await read('ENSRegistry', 'owner', [namehash('addr.reverse')])), lower(c.ReverseRegistrar))
assert.equal(lower(await read('ENSRegistry', 'owner', [namehash('reverse')])), lower(owner.address))
for (const n of ['ZNSRegistrar', 'ReverseRegistrar', 'ZNSPriceFeed', 'ZNSController']) assert.equal(lower(await read(n, 'owner')), lower(owner.address))
assert.equal(await read('ZNSRegistrar', 'name'), 'ZNS')
ok('every owner role is the owner, and the deploying key holds none')

// --- what may be registered -------------------------------------------------

for (const good of ['abc', '123', 'a-b', 'zenon-network', 'x'.repeat(63), 'ab-c']) assert.equal(await read('ZNSController', 'valid', [good]), true, good)
for (const bad of ['ab', 'Alice', '-abc', 'abc-', 'ab--c', 'al ice', 'алиса', 'a.b', 'x'.repeat(64), 'ab_c', '👍👍👍'])
  assert.equal(await read('ZNSController', 'valid', [bad]), false, bad)
ok('labels are 3-63 of a-z 0-9 -, no edge hyphens, no "--" in places 3-4')

// --- prices --------------------------------------------------------------

const price = async (label, secs = YEAR) => read('ZNSController', 'rentPrice', [label, secs])
const znn = (v) => Number(formatEther(v))
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`)
near(znn((await price('alicewonder')).base), 1)
near(znn((await price('abcd1234')).base), 1)
near(znn((await price('abcd')).base), 32)
near(znn((await price('abc')).base), 128)
assert.equal((await price('abcdefg')).premium, 0n)
near(znn((await price('abcdef')).premium), 100000 - 100000 / 2 ** 21, 1e-3)
near(znn((await price('abc')).premium), 100000 - 100000 / 2 ** 21, 1e-3)
ok('rent is 128 / 32 / 1 ZNN a year; names of 6 or fewer carry the launch premium, 7+ do not')

// --- commit, wait, reveal -----------------------------------------------------

const resolverData = (label, who, texts = {}) => {
  const node = namehash(`${label}.znn`)
  return [
    encodeFunctionData({abi: abi('PublicResolver'), functionName: 'setAddr', args: [node, who]}),
    ...Object.entries(texts).map(([k, v]) => encodeFunctionData({abi: abi('PublicResolver'), functionName: 'setText', args: [node, k, v]})),
  ]
}
const registration = (label, who, {duration = YEAR, reverse = 1, texts = {}, resolver = true} = {}) => ({
  label,
  owner: who.address,
  duration,
  secret: `0x${Buffer.from(label.padEnd(32, '.')).toString('hex').slice(0, 64)}`,
  resolver: resolver ? c.PublicResolver : zeroAddress,
  data: resolver ? resolverData(label, who.address, texts) : [],
  reverseRecord: resolver ? reverse : 0,
  referrer: `0x${'0'.repeat(64)}`,
})
async function register(who, reg, {wait = 61, extra = 0n} = {}) {
  const commitment = await read('ZNSController', 'makeCommitment', [reg])
  await send(who, 'ZNSController', 'commit', [commitment])
  if (wait) await later(wait)
  const p = await price(reg.label, reg.duration)
  return send(who, 'ZNSController', 'register', [reg], p.base + p.premium + extra)
}

const aliceReg = registration('alicewonder', alice, {texts: {url: 'https://zenon.network', 'com.twitter': 'alice'}})
await reverts(() => simulate('alice', 'ZNSController', 'register', [aliceReg], parseEther('2')), /CommitmentNotFound/)
await send('alice', 'ZNSController', 'commit', [await read('ZNSController', 'makeCommitment', [aliceReg])])
await reverts(() => simulate('alice', 'ZNSController', 'register', [aliceReg], parseEther('2')), /CommitmentTooNew/)
await reverts(
  () => simulate('alice', 'ZNSController', 'makeCommitment', [{...aliceReg, reverseRecord: 2}]),
  /UnsupportedReverseRecord/,
)
await later(61)
const aliceBefore = await reader.getBalance({address: alice.address})
const r1 = await send('alice', 'ZNSController', 'register', [aliceReg], parseEther('5'))
const spent = aliceBefore - (await reader.getBalance({address: alice.address})) - r1.gasUsed * r1.effectiveGasPrice
near(znn(spent), 1, 1e-6)
ok('register needs a commitment at least 60 s old, and refunds what was overpaid')

const id = BigInt(labelhash('alicewonder'))
const node = namehash('alicewonder.znn')
assert.equal(lower(await read('ZNSRegistrar', 'ownerOf', [id])), lower(alice.address))
assert.equal(lower(await read('ENSRegistry', 'owner', [node])), lower(alice.address))
assert.equal(lower(await read('ENSRegistry', 'resolver', [node])), lower(c.PublicResolver))
assert.equal(await read('ZNSRegistrar', 'labelOf', [id]), 'alicewonder')
const metaUpdates = r1.logs.filter((l) => lower(l.address) === lower(c.ZNSRegistrar)).map((l) => {
  try {
    return decodeEventLog({abi: abi('ZNSRegistrar'), ...l}).eventName
  } catch {
    return null
  }
})
assert.ok(metaUpdates.includes('Transfer') && metaUpdates.includes('LabelRecorded') && metaUpdates.includes('MetadataUpdate'), metaUpdates.join())
ok('the token, the registry node and the resolver are the registrant\'s, and the label is recorded')

// --- the token names itself ----------------------------------------------

const uri = await read('ZNSRegistrar', 'tokenURI', [id])
const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString())
assert.equal(meta.name, 'alicewonder.znn')
assert.equal(meta.external_url, 'https://devnet.example.org/zns/#/name/alicewonder.znn')
const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString()
assert.match(svg, /^<svg[^>]+viewBox="0 0 512 512"/)
assert.match(svg, />alicewonder<tspan fill="#00d557">\.znn<\/tspan>/)
const expires = await read('ZNSRegistrar', 'nameExpires', [id])
assert.match(svg, new RegExp(`EXPIRES ${new Date(Number(expires) * 1000).toISOString().slice(0, 10)}`))
assert.deepEqual(meta.attributes.map((a) => a.trait_type), ['Length', 'Characters', 'Expires'])
assert.equal(meta.attributes[0].value, 11)
assert.equal(meta.attributes[1].value, 'Letters')
const collection = JSON.parse(Buffer.from((await read('ZNSRegistrar', 'contractURI')).split(',')[1], 'base64').toString())
assert.equal(collection.name, 'ZNS')
ok('tokenURI is on-chain JSON with the name, an SVG card, the expiry date and traits; contractURI too')

// --- resolution through the universal resolver, as viem does it -------------

assert.equal(lower(await getEnsAddress(ens, {name: 'alicewonder.znn'})), lower(alice.address))
assert.equal(await getEnsName(ens, {address: alice.address}), 'alicewonder.znn')
assert.equal(await getEnsText(ens, {name: 'alicewonder.znn', key: 'com.twitter'}), 'alice')
assert.equal(await getEnsName(ens, {address: carol.address}), null)
assert.equal(await getEnsAddress(ens, {name: 'nobody-here.znn'}), null)
ok('viem\'s getEnsAddress, getEnsName and getEnsText answer through the UniversalResolver')

// --- front-running ---------------------------------------------------------

const snipe = registration('alicewonder', bob)
await send('bob', 'ZNSController', 'commit', [await read('ZNSController', 'makeCommitment', [snipe])])
await later(61)
await reverts(() => simulate('bob', 'ZNSController', 'register', [snipe], parseEther('5')), /NameNotAvailable/)
ok('a registered name cannot be registered again')

// --- selling: an operator (the exchange) moves the token ------------------

await send('alice', 'ZNSRegistrar', 'setApprovalForAll', [market.address, true])
await send('market', 'ZNSRegistrar', 'transferFrom', [alice.address, bob.address, id])
assert.equal(lower(await read('ZNSRegistrar', 'ownerOf', [id])), lower(bob.address))
assert.equal(lower(await read('ENSRegistry', 'owner', [node])), lower(bob.address))
await reverts(() => send('alice', 'PublicResolver', 'setText', [node, 'url', 'mine still']))
// The records are still the seller's until the buyer changes them, so the
// seller's primary name stops verifying the moment the buyer points it home.
await send('bob', 'PublicResolver', 'setAddr', [node, bob.address])
assert.equal(await getEnsName(ens, {address: alice.address}), null)
assert.equal(await getEnsName(ens, {address: bob.address}), null)
ok('a sale moves the registry node with the token, so the buyer controls it without a reclaim')

// --- the primary name, and switching it ------------------------------------

await send('bob', 'ReverseRegistrar', 'setName', ['alicewonder.znn'])
assert.equal(await getEnsName(ens, {address: bob.address}), 'alicewonder.znn')
await register('bob', registration('bobsecond', bob, {reverse: 0}))
assert.equal(await getEnsName(ens, {address: bob.address}), 'alicewonder.znn')
await send('bob', 'ReverseRegistrar', 'setName', ['bobsecond.znn'])
assert.equal(await getEnsName(ens, {address: bob.address}), 'bobsecond.znn')
// A primary name the address does not resolve to is not a primary name.
await send('carol', 'ReverseRegistrar', 'setName', ['bobsecond.znn'])
assert.equal(await getEnsName(ens, {address: carol.address}), null)
ok('the primary name switches with one setName, and a claim to someone else\'s name does not verify')

// --- subnames --------------------------------------------------------------

await send('bob', 'ENSRegistry', 'setSubnodeRecord', [node, labelhash('pay'), carol.address, c.PublicResolver, 0n])
await send('carol', 'PublicResolver', 'setAddr', [namehash('pay.alicewonder.znn'), carol.address])
assert.equal(lower(await getEnsAddress(ens, {name: 'pay.alicewonder.znn'})), lower(carol.address))
await send('carol', 'ReverseRegistrar', 'setName', ['pay.alicewonder.znn'])
assert.equal(await getEnsName(ens, {address: carol.address}), 'pay.alicewonder.znn')
ok('a holder makes subnames, and a subname can be a primary name')

// --- renewing, by anyone, in bulk ----------------------------------------

const before = await read('ZNSRegistrar', 'nameExpires', [id])
const r2 = await send('carol', 'ZNSController', 'renew', ['alicewonder', YEAR, `0x${'0'.repeat(64)}`], parseEther('1.1'))
assert.equal(await read('ZNSRegistrar', 'nameExpires', [id]), before + YEAR)
assert.ok(r2.logs.some((l) => lower(l.address) === lower(c.ZNSRegistrar)))
const bulk = await reader.readContract({address: c.StaticBulkRenewal, abi: abi('StaticBulkRenewal'), functionName: 'rentPrice', args: [['alicewonder', 'bobsecond'], YEAR]})
near(znn(bulk), 2)
{
  const hash = await as('carol').writeContract({address: c.StaticBulkRenewal, abi: abi('StaticBulkRenewal'), functionName: 'renewAll', args: [['alicewonder', 'bobsecond'], YEAR, `0x${'0'.repeat(64)}`], value: bulk})
  assert.equal((await reader.waitForTransactionReceipt({hash})).status, 'success')
}
assert.equal(await read('ZNSRegistrar', 'nameExpires', [id]), before + 2n * YEAR)
ok('anyone may renew any name, one at a time or in bulk, and renewal refreshes the metadata')

// --- expiry, grace, and the premium on the way back ---------------------------

const bobExpires = await read('ZNSRegistrar', 'nameExpires', [BigInt(labelhash('bobsecond'))])
await later(Number(bobExpires) - (await now()) + 10)
await reverts(() => read('ZNSRegistrar', 'ownerOf', [BigInt(labelhash('bobsecond'))]))
assert.equal(await read('ZNSController', 'available', ['bobsecond']), false)
await reverts(() => simulate('carol', 'ZNSRegistrar', 'transferFrom', [bob.address, carol.address, BigInt(labelhash('bobsecond'))]))
ok('an expired name has no owner and cannot be sold, and is held for its grace period')

await later(90 * 86400)
assert.equal(await read('ZNSController', 'available', ['bobsecond']), true)
const p0 = znn((await price('bobsecond')).premium)
near(p0, 100000 - 100000 / 2 ** 21, 1e-2)
await later(86400)
near(znn((await price('bobsecond')).premium), 50000 - 100000 / 2 ** 21, 1e-2)
await later(20 * 86400)
assert.equal((await price('bobsecond')).premium, 0n)
ok('after 90 days of grace the name returns at a premium that halves daily and is gone after 21 days')

// By now the launch premium has run out too.
assert.equal((await price('abc')).premium, 0n)
const shortReg = registration('abc', carol)
await register('carol', shortReg)
assert.equal(lower(await read('ZNSRegistrar', 'ownerOf', [BigInt(labelhash('abc'))])), lower(carol.address))
const shortSvg = Buffer.from(JSON.parse(Buffer.from((await read('ZNSRegistrar', 'tokenURI', [BigInt(labelhash('abc'))])).split(',')[1], 'base64').toString()).image.split(',')[1], 'base64').toString()
assert.match(shortSvg, /<tspan fill="#f91690">/)
ok('three-letter names register at 128 ZNN a year once the launch premium is spent, in pink')

// --- the owner's levers -------------------------------------------------------

await reverts(() => simulate('carol', 'ZNSPriceFeed', 'set', [50_000_000n]))
await send('owner', 'ZNSPriceFeed', 'set', [50_000_000n])
near(znn((await price('alicewonder')).base), 2)
await reverts(() => simulate('owner', 'ZNSPriceFeed', 'set', [0n]), /AnswerNotPositive/)
ok('only the owner moves the price, and halving the feed doubles every tier')

// Rent is burned as it is paid: the controller never holds any, and the
// burn address gains exactly what a renewal costs.
const BURN = '0x000000000000000000000000000000000000dEaD'
assert.equal(await reader.getBalance({address: c.ZNSController}), 0n)
const burnBefore = await reader.getBalance({address: BURN})
await send('carol', 'ZNSController', 'renew', ['abc', YEAR, `0x${'0'.repeat(64)}`], parseEther('300'))
near(znn((await reader.getBalance({address: BURN})) - burnBefore), 256, 1e-6)
assert.equal(await reader.getBalance({address: c.ZNSController}), 0n)
ok(`rent is burned to 0x…dEaD as it is paid (${formatEther(burnBefore)} ZNN before this renewal), and the controller holds none`)

console.log(`\n${passed} checks passed`)
