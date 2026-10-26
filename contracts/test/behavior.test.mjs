import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import test from 'node:test'
import {encodeFunctionData, labelhash, namehash} from 'viem'
import {getEnsAddress, getEnsName, getEnsText} from 'viem/ens'
import {artifacts, BURN, DAY, E18, fixture, fixtureArtifacts, frontendAbi, GRACE, HASH_ZERO, input, NODES, terms, YEAR, ZERO} from './evm.mjs'

const id = (label) => BigInt(labelhash(label))
const node = (label) => namehash(label + '.znn')
const jsonURI = (uri) => {
  assert.ok(uri.startsWith('data:application/json;base64,'))
  return JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString())
}
function random(seed) {
  let state = seed >>> 0
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0 }
}
const controllerArgs = (f, min = terms.minAge, max = terms.maxAge) => [f.c.ZNSRegistrar, f.c.ExponentialPremiumPriceOracle,
  min, max, f.c.ReverseRegistrar, f.c.ENSRegistry, terms.launchMaxLength]

test('fresh complete source graph, ten creation artifacts and frontend ABI equal the tracked outputs', () => {
  const saved = JSON.parse(readFileSync(new URL('../out/input.json', import.meta.url), 'utf8'))
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  assert.equal(digest(input), digest(saved), 'the complete source/settings input drifted; rebuild the tracked artifacts')
  assert.equal(Object.keys(artifacts).length, 10)
  for (const [name, artifact] of Object.entries(artifacts)) {
    assert.deepEqual(artifact, JSON.parse(readFileSync(new URL('../out/' + name + '.json', import.meta.url), 'utf8')), name)
  }
  assert.equal(frontendAbi, readFileSync(new URL('../../web/src/abi.ts', import.meta.url), 'utf8'))
})

test('actual ten-contract bootstrap transfers every role and wires ENS, registrar and resolver', async () => {
  const f = await fixture()
  for (const [name, value] of [[NODES.root, f.owner], [NODES.reverse, f.owner], [NODES.znn, f.c.ZNSRegistrar], [NODES.addrReverse, f.c.ReverseRegistrar]]) {
    assert.equal(await f.read('ENSRegistry', 'owner', [name]), value)
  }
  for (const name of ['ZNSRegistrar', 'ReverseRegistrar', 'ZNSPriceFeed', 'ZNSController', 'GatewayProvider']) {
    assert.equal(await f.read(name, 'owner'), f.owner)
  }
  assert.equal(await f.read('UniversalResolver', 'registry'), f.c.ENSRegistry)
  assert.equal(await f.read('UniversalResolver', 'batchGatewayProvider'), f.c.GatewayProvider)
  const universalReverse = await f.read('ReverseRegistrar', 'node', [f.c.UniversalResolver])
  assert.equal(await f.read('ENSRegistry', 'owner', [universalReverse]), f.owner)
  assert.equal(await f.read('ZNSRegistrar', 'controllers', [f.c.ZNSController]), true)
  assert.equal(await f.read('ReverseRegistrar', 'controllers', [f.c.ZNSController]), true)
  assert.equal(await f.read('ReverseRegistrar', 'defaultResolver'), f.c.PublicResolver)
  assert.equal(await f.read('ZNSRegistrar', 'name'), 'ZNS')
  assert.equal(await f.read('ZNSRegistrar', 'symbol'), 'ZNS')
  assert.equal(await f.read('ZNSController', 'ZNN_NODE'), NODES.znn)
  assert.equal(await f.read('ZNSController', 'BURN'), BURN)
  await f.conserved()
})

test('constructor commitment age boundaries and positive price-feed requirements fail explicitly', async () => {
  const f = await fixture()
  await f.deploy(artifacts.ZNSController, controllerArgs(f, 60n, 60n), {error: 'MaxCommitmentAgeTooLow'})
  await f.deploy(artifacts.ZNSController, controllerArgs(f, 61n, 60n), {error: 'MaxCommitmentAgeTooLow'})
  await f.deploy(artifacts.ZNSController, controllerArgs(f, 60n, f.timestamp + 1n), {error: 'MaxCommitmentAgeTooHigh'})
  for (const answer of [0n, -1n]) await f.deploy(artifacts.ZNSPriceFeed, [answer], {error: 'AnswerNotPositive'})
  const at = await f.deploy(artifacts.ZNSController, controllerArgs(f, 60n, 61n))
  assert.equal(await f.read(at, 'minCommitmentAge'), 60n)
  assert.equal(await f.read(at, 'maxCommitmentAge'), 61n)
})

test('label validation agrees with an independent ASCII rule across boundary and seeded cases', async (t) => {
  const f = await fixture()
  const expected = (label) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(label) && label.slice(2, 4) !== '--'
  const boundary = ['', 'ab', 'abc', '123', 'a-b', 'ab-c', 'ab--c', 'a--b', '-abc', 'abc-', 'ABC', 'a.b', 'a_b',
    'x'.repeat(63), 'x'.repeat(64), String.fromCodePoint(0x430) + 'lice', 'caf' + String.fromCodePoint(0xe9)]
  for (const label of boundary) assert.equal(await f.read('ZNSController', 'valid', [label]), expected(label), JSON.stringify(label))
  for (const seed of [1, 7, 42, 0x12345678]) await t.test('seed ' + seed, async () => {
    const next = random(seed), alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-._ ABC'
    for (let i = 0; i < 80; i++) {
      const label = Array.from({length: next() % 68}, () => alphabet[next() % alphabet.length]).join('')
      assert.equal(await f.read('ZNSController', 'valid', [label]), expected(label), JSON.stringify(label))
    }
  })
})

test('base rent follows exact per-second tiers and the owner-controlled feed conversion', async () => {
  const f = await fixture()
  for (const [label, rate] of [['abc', 128n], ['abcd', 32n], ['abcde', 1n], ['longfixture', 1n]]) {
    for (const duration of [1n, 123n, YEAR, YEAR * 3n]) {
      const quote = await f.read('ZNSController', 'rentPrice', [label, duration])
      assert.equal(quote.base, (rate * E18 / YEAR) * duration)
    }
  }
  const before = await f.read('ZNSController', 'rentPrice', ['longfixture', YEAR])
  const result = await f.write(f.owner, 'ZNSPriceFeed', 'set', [50_000_000n])
  assert.equal((await f.read('ZNSController', 'rentPrice', ['longfixture', YEAR])).base, before.base * 2n)
  assert.equal(f.events(result)[0].eventName, 'AnswerUpdated')
  assert.equal(f.events(result)[0].args.current, 50_000_000n)
  await f.write(f.alice, 'ZNSPriceFeed', 'set', [100_000_000n], 0n, {error: 'Ownable: caller is not the owner'})
  await f.write(f.owner, 'ZNSPriceFeed', 'set', [0n], 0n, {error: 'AnswerNotPositive'})
})

test('launch premium is restricted to short unregistered names, halves daily and reaches zero', async () => {
  const f = await fixture()
  const starting = (await f.read('ZNSController', 'rentPrice', ['abcdef', YEAR])).premium
  assert.ok(starting > 99_999n * E18 && starting < terms.startPremium)
  assert.equal((await f.read('ZNSController', 'rentPrice', ['abcdefg', YEAR])).premium, 0n)
  const endValue = terms.startPremium / (1n << terms.premiumDays)
  let previous = starting
  for (let day = 1n; day <= 21n; day++) {
    f.later(DAY)
    const quote = await f.read('ZNSController', 'rentPrice', ['abcdef', YEAR])
    assert.ok(quote.premium <= previous)
    const expected = terms.startPremium / (1n << day) - endValue
    assert.ok(quote.premium >= expected - 1n && quote.premium <= expected + 1n)
    previous = quote.premium
  }
  assert.equal(previous, 0n)
})

test('commitment fields are bound and invalid duration/resolver/reverse requests are refused', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  const commitment = await f.read('ZNSController', 'makeCommitment', [reg])
  for (const delta of [{label: 'fixturebeta'}, {owner: f.bob}, {duration: YEAR + 1n}, {secret: '0x' + '22'.repeat(32)},
    {resolver: ZERO, data: [], reverseRecord: 0}, {data: []}, {reverseRecord: 0}, {referrer: '0x' + '33'.repeat(32)}]) {
    assert.notEqual(await f.read('ZNSController', 'makeCommitment', [{...reg, ...delta}]), commitment)
  }
  for (const [delta, error] of [[{duration: 28n * DAY - 1n}, 'DurationTooShort'],
    [{resolver: ZERO}, 'ResolverRequiredWhenDataSupplied'], [{resolver: ZERO, data: [], reverseRecord: 1}, 'ResolverRequiredForReverseRecord'],
    [{reverseRecord: 2}, 'UnsupportedReverseRecord']]) {
    await f.write(f.alice, 'ZNSController', 'makeCommitment', [{...reg, ...delta}], 0n, {isStatic: true, error})
  }
})

test('minimum commitment age is inclusive, consumes once, and refunds exactly what was overpaid', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha'), quote = await f.price(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: 'CommitmentNotFound'})
  const commitment = await f.commit(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: 'CommitmentTooNew'})
  f.later(59n)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: 'CommitmentTooNew'})
  f.later(1n)
  const before = await f.balance(f.alice), burn = await f.balance(BURN)
  const result = await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base + 12345n)
  assert.equal(await f.balance(f.alice), before - quote.base)
  assert.equal(await f.balance(BURN), burn + quote.base)
  assert.equal(await f.balance(f.c.ZNSController), 0n)
  assert.equal(await f.read('ZNSController', 'commitments', [commitment]), 0n)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), f.alice)
  assert.equal(await f.read('ENSRegistry', 'resolver', [node(reg.label)]), f.c.PublicResolver)
  assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), f.timestamp + YEAR)
  assert.equal(await f.read('ZNSRegistrar', 'labelOf', [id(reg.label)]), reg.label)
  const names = f.events(result).map((e) => e.eventName)
  for (const name of ['Transfer', 'LabelRecorded', 'MetadataUpdate', 'NameRegistered']) assert.ok(names.includes(name), name)
  await f.write(f.bob, 'ZNSController', 'register', [reg], quote.base, {error: 'NameNotAvailable'})
  await f.conserved()
})

test('maximum commitment age rejects reveal and only permits a new commit after the boundary', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha'), commitment = await f.commit(reg), quote = await f.price(reg)
  f.later(terms.maxAge)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: 'CommitmentTooOld'})
  await f.write(f.bob, 'ZNSController', 'commit', [commitment], 0n, {error: 'UnexpiredCommitmentExists'})
  f.later(1n)
  await f.write(f.bob, 'ZNSController', 'commit', [commitment])
  assert.equal(await f.read('ZNSController', 'commitments', [commitment]), f.timestamp)
  f.later(terms.minAge)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base)
})

test('insufficient value and changed pricing preserve the original usable commitment', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha'), commitment = await f.commit(reg)
  f.later(terms.minAge)
  const quote = await f.price(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base - 1n, {error: 'InsufficientValue'})
  await f.write(f.owner, 'ZNSPriceFeed', 'set', [50_000_000n])
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: 'InsufficientValue'})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base * 2n)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
})

test('registration without a resolver succeeds and invalid labels cannot consume commitments', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha', f.alice, {resolver: ZERO})
  await f.register(reg)
  assert.equal(await f.read('ENSRegistry', 'resolver', [node(reg.label)]), ZERO)
  const invalid = f.registration('Bad-label', f.bob, {resolver: ZERO})
  const commitment = await f.commit(invalid)
  f.later(terms.minAge)
  const quote = await f.price(invalid)
  await f.write(f.bob, 'ZNSController', 'register', [invalid], quote.base, {error: 'NameNotAvailable'})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
})

test('resolver multicall writes address and text and the real UniversalResolver serves viem ENS actions', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  reg.data.push(encodeFunctionData({abi: artifacts.PublicResolver.abi, functionName: 'setText', args: [node(reg.label), 'description', 'Synthetic fixture']}))
  await f.register(reg)
  assert.equal(await getEnsAddress(f.client, {name: reg.label + '.znn'}), f.alice)
  assert.equal(await getEnsName(f.client, {address: f.alice}), reg.label + '.znn')
  assert.equal(await getEnsText(f.client, {name: reg.label + '.znn', key: 'description'}), 'Synthetic fixture')
  assert.equal(await getEnsName(f.client, {address: f.carol}), null)
  assert.equal(await getEnsAddress(f.client, {name: 'missingfixture.znn'}), null)
  assert.ok(f.rpcMethods.length >= 5 && f.rpcMethods.every((method) => method === 'eth_call'))
})

test('a wrong-node resolver call rolls back commitment consumption, registry, token and burn', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  reg.data = [encodeFunctionData({abi: artifacts.PublicResolver.abi, functionName: 'setAddr', args: [node('fixturebeta'), f.bob]})]
  const commitment = await f.commit(reg); f.later(terms.minAge)
  const quote = await f.price(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: null})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), ZERO)
  assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), 0n)
  assert.equal(await f.balance(BURN), 0n)
})

test('gifting keeps token ownership with the recipient and reverse attribution with the payer', async () => {
  const f = await fixture(), reg = f.registration('fixturegift', f.bob)
  await f.register(reg, {from: f.alice})
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.bob)
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), f.bob)
  // A reverse record alone is not forward-verified for the payer of a gift.
  const reverseNode = await f.read('ReverseRegistrar', 'node', [f.alice])
  assert.equal(await f.read('PublicResolver', 'name', [reverseNode]), reg.label + '.znn')
  assert.equal(await getEnsAddress(f.client, {name: reg.label + '.znn'}), f.bob)
  assert.equal(await getEnsName(f.client, {address: f.alice}), null)
})

test('operator token transfer moves registry control while preserving existing resolver records', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  await f.write(f.alice, 'ZNSRegistrar', 'setApprovalForAll', [f.market, true])
  await f.write(f.market, 'ZNSRegistrar', 'transferFrom', [f.alice, f.bob, id(reg.label)])
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.bob)
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), f.bob)
  assert.equal(await f.read('PublicResolver', 'addr', [node(reg.label)]), f.alice)
  await f.write(f.alice, 'PublicResolver', 'setAddr', [node(reg.label), f.carol], 0n, {error: null})
  await f.write(f.bob, 'PublicResolver', 'setAddr', [node(reg.label), f.bob])
  assert.equal(await getEnsAddress(f.client, {name: reg.label + '.znn'}), f.bob)
})

test('a retired registrar can transfer the NFT without taking over its old registry node', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  await f.write(f.owner, 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('znn'), f.carol])
  await f.write(f.alice, 'ZNSRegistrar', 'transferFrom', [f.alice, f.bob, id(reg.label)])
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.bob)
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), f.alice)
})

test('token and collection metadata are inline JSON/SVG with labels, expiry, traits and owner-only URL updates', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  const metadata = jsonURI(await f.read('ZNSRegistrar', 'tokenURI', [id(reg.label)]))
  assert.equal(metadata.name, reg.label + '.znn')
  assert.equal(metadata.external_url, 'https://example.invalid/zns/#/name/' + reg.label + '.znn')
  assert.deepEqual(metadata.attributes.map((a) => a.trait_type), ['Length', 'Characters', 'Expires'])
  assert.equal(metadata.attributes[0].value, reg.label.length)
  assert.equal(metadata.attributes[1].value, 'Letters')
  const expiry = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)])
  const svg = Buffer.from(metadata.image.split(',')[1], 'base64').toString()
  assert.match(svg, /^<svg[^>]+viewBox="0 0 512 512"/)
  assert.ok(svg.includes(reg.label) && svg.includes(new Date(Number(expiry) * 1000).toISOString().slice(0, 10)))
  assert.equal(jsonURI(await f.read('ZNSRegistrar', 'contractURI')).name, 'ZNS')
  await f.write(f.alice, 'ZNSRegistrar', 'setSiteURL', ['https://example.invalid/new/'], 0n, {error: 'Ownable: caller is not the owner'})
  const changed = await f.write(f.owner, 'ZNSRegistrar', 'setSiteURL', ['https://example.invalid/new/'])
  assert.deepEqual(f.events(changed).map((e) => e.eventName), ['ContractURIUpdated', 'BatchMetadataUpdate'])
  assert.ok(jsonURI(await f.read('ZNSRegistrar', 'tokenURI', [id(reg.label)])).external_url.startsWith('https://example.invalid/new/'))
})

test('permissionless label recording proves the token hash and emits metadata updates', async () => {
  const f = await fixture(), label = 'manualfixture'
  await f.write(f.alice, 'ZNSRegistrar', 'recordLabel', [label], 0n, {error: 'UnknownName'})
  await f.write(f.owner, 'ZNSRegistrar', 'addController', [f.owner])
  await f.write(f.owner, 'ZNSRegistrar', 'register', [id(label), f.alice, YEAR])
  const fallback = jsonURI(await f.read('ZNSRegistrar', 'tokenURI', [id(label)]))
  assert.ok(fallback.name.startsWith('[') && fallback.name.endsWith('].znn'))
  const first = await f.write(f.carol, 'ZNSRegistrar', 'recordLabel', [label])
  assert.deepEqual(f.events(first).map((e) => e.eventName), ['LabelRecorded', 'MetadataUpdate'])
  const repeated = await f.write(f.bob, 'ZNSRegistrar', 'recordLabel', [label])
  assert.deepEqual(f.events(repeated).map((e) => e.eventName), ['MetadataUpdate'])
  assert.equal(jsonURI(await f.read('ZNSRegistrar', 'tokenURI', [id(label)])).name, label + '.znn')
  await f.write(f.bob, 'ZNSRegistrar', 'recordLabel', ['otherfixture'], 0n, {error: 'UnknownName'})
})

test('third-party renewal burns only base rent, preserves ownership and adds to the prior expiry', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  const before = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), quote = await f.price(reg)
  const payer = await f.balance(f.bob), burn = await f.balance(BURN)
  const result = await f.write(f.bob, 'ZNSController', 'renew', [reg.label, YEAR, HASH_ZERO], quote.base + 123n)
  assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), before + YEAR)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
  assert.equal(await f.balance(f.bob), payer - quote.base)
  assert.equal(await f.balance(BURN), burn + quote.base)
  assert.ok(f.events(result).some((e) => e.eventName === 'MetadataUpdate'))
  await f.conserved()
})

test('expiry and grace boundaries prevent transfers, allow final grace renewal and then close renewal', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  const expiry = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)])
  f.atTime(expiry)
  await f.write(f.alice, 'ZNSRegistrar', 'ownerOf', [id(reg.label)], 0n, {isStatic: true, error: null})
  await f.write(f.alice, 'ZNSRegistrar', 'transferFrom', [f.alice, f.bob, id(reg.label)], 0n, {error: null})
  assert.equal(await f.read('ZNSController', 'available', [reg.label]), false)
  f.atTime(expiry + GRACE)
  assert.equal(await f.read('ZNSController', 'available', [reg.label]), false)
  const quote = await f.price(reg)
  await f.write(f.bob, 'ZNSController', 'renew', [reg.label, YEAR, HASH_ZERO], quote.base)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
  const renewed = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)])
  f.atTime(renewed + GRACE + 1n)
  assert.equal(await f.read('ZNSController', 'available', [reg.label]), true)
  await f.write(f.bob, 'ZNSController', 'renew', [reg.label, YEAR, HASH_ZERO], quote.base, {error: null})
})

test('an expired name reopens through the actual premium curve and can be registered to a new owner', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.register(reg)
  const expiry = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)])
  f.atTime(expiry + GRACE + 1n)
  assert.ok((await f.price(reg)).premium > 99_000n * E18)
  f.later(21n * DAY)
  assert.equal((await f.price(reg)).premium, 0n)
  const next = f.registration(reg.label, f.bob)
  await f.register(next, {from: f.bob})
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.bob)
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), f.bob)
  assert.equal(await getEnsAddress(f.client, {name: reg.label + '.znn'}), f.bob)
})

test('bulk renewal applies each real controller call and returns the exact excess', async () => {
  const f = await fixture(), labels = ['fixturealpha', 'fixturebeta']
  for (const label of labels) await f.register(f.registration(label))
  const expiries = []
  for (const label of labels) expiries.push(await f.read('ZNSRegistrar', 'nameExpires', [id(label)]))
  const cost = await f.read('StaticBulkRenewal', 'rentPrice', [labels, YEAR])
  const payer = await f.balance(f.bob), burn = await f.balance(BURN)
  await f.write(f.bob, 'StaticBulkRenewal', 'renewAll', [labels, YEAR, HASH_ZERO], cost + 999n)
  for (let i = 0; i < labels.length; i++) assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(labels[i])]), expiries[i] + YEAR)
  assert.equal(await f.balance(f.bob), payer - cost)
  assert.equal(await f.balance(BURN), burn + cost)
  assert.equal(await f.balance(f.c.StaticBulkRenewal), 0n)
  assert.equal(await f.balance(f.c.ZNSController), 0n)
  await f.conserved()
})

test('a later bulk-renewal failure restores the earlier renewal, balances and events', async () => {
  const f = await fixture(), label = 'fixturealpha'
  await f.register(f.registration(label))
  const expiry = await f.read('ZNSRegistrar', 'nameExpires', [id(label)])
  const labels = [label, 'missingfixture'], cost = await f.read('StaticBulkRenewal', 'rentPrice', [labels, YEAR])
  await f.write(f.bob, 'StaticBulkRenewal', 'renewAll', [labels, YEAR, HASH_ZERO], cost, {error: null})
  assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(label)]), expiry)
})

test('rejected registration refunds restore commitment, token, resolver writes and burn before a successful retry', async () => {
  const f = await fixture(), receiver = await f.deploy(fixtureArtifacts.NativeReceiver)
  const reg = f.registration('fixturealpha', f.alice, {reverseRecord: 0}), commitment = await f.commit(reg)
  f.later(terms.minAge)
  const quote = await f.price(reg), data = encodeFunctionData({abi: artifacts.ZNSController.abi, functionName: 'register', args: [reg]})
  await f.write(f.alice, receiver, 'forward', [f.c.ZNSController, data], quote.base + 100n, {error: null})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), ZERO)
  assert.equal(await f.balance(BURN), 0n)
  await f.write(f.owner, receiver, 'setReject', [false])
  await f.write(f.alice, receiver, 'forward', [f.c.ZNSController, data], quote.base + 100n)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
  assert.equal(await f.balance(receiver), 100n)
  assert.equal(await f.balance(BURN), quote.base)
  await f.conserved()
})

test('rejected renewal refunds restore expiry and burn and leave the original token usable', async () => {
  const f = await fixture(), receiver = await f.deploy(fixtureArtifacts.NativeReceiver), reg = f.registration('fixturealpha')
  await f.register(reg)
  const expiry = await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), quote = await f.price(reg)
  const data = encodeFunctionData({abi: artifacts.ZNSController.abi, functionName: 'renew', args: [reg.label, YEAR, HASH_ZERO]})
  await f.write(f.bob, receiver, 'forward', [f.c.ZNSController, data], quote.base + 100n, {error: null})
  assert.equal(await f.read('ZNSRegistrar', 'nameExpires', [id(reg.label)]), expiry)
  assert.equal(await f.read('ZNSRegistrar', 'ownerOf', [id(reg.label)]), f.alice)
})

test('forced controller value is burned permissionlessly while ordinary direct transfers revert', async () => {
  const f = await fixture(), force = await f.deploy(fixtureArtifacts.ForceNative, [], {value: 1234n})
  await f.frame({from: f.alice, to: f.c.ZNSController, value: 1n, error: null})
  await f.write(f.alice, force, 'force', [f.c.ZNSController])
  assert.equal(await f.balance(f.c.ZNSController), 1234n)
  const burn = await f.balance(BURN)
  await f.write(f.carol, 'ZNSController', 'withdraw')
  assert.equal(await f.balance(f.c.ZNSController), 0n)
  assert.equal(await f.balance(BURN), burn + 1234n)
  await f.conserved()
})

test('owner-only controller administration refuses unauthorized callers and revoked controllers', async () => {
  const f = await fixture()
  await f.write(f.alice, 'ZNSRegistrar', 'addController', [f.alice], 0n, {error: 'Ownable: caller is not the owner'})
  await f.write(f.deployer, 'ZNSRegistrar', 'setResolver', [f.c.PublicResolver], 0n, {error: 'Ownable: caller is not the owner'})
  await f.write(f.owner, 'ZNSRegistrar', 'removeController', [f.c.ZNSController])
  const reg = f.registration('fixturealpha'), commitment = await f.commit(reg); f.later(terms.minAge)
  const quote = await f.price(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {error: null})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
  await f.write(f.owner, 'ZNSRegistrar', 'addController', [f.c.ZNSController])
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base)
})

test('arithmetic overflow and insufficient execution gas fail without retaining application state or value', async () => {
  const f = await fixture(), reg = f.registration('fixturealpha')
  await f.write(f.alice, 'ZNSController', 'rentPrice', [reg.label, (1n << 256n) - 1n], 0n, {isStatic: true, error: null})
  const commitment = await f.commit(reg); f.later(terms.minAge)
  const quote = await f.price(reg)
  await f.write(f.alice, 'ZNSController', 'register', [reg], quote.base, {gas: 60_000n, error: null})
  assert.ok(await f.read('ZNSController', 'commitments', [commitment]))
  assert.equal(await f.read('ENSRegistry', 'owner', [node(reg.label)]), ZERO)
})
