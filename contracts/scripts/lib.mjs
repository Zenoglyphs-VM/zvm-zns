// What the deploy, test and check scripts share: the chain, the artifacts,
// the deployment record, and the deployment itself, written once so the local
// test deploys exactly what a live chain gets.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  labelhash,
  namehash,
  parseEther,
  toBytes,
  zeroAddress,
  zeroHash,
} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'

export const root = new URL('../../', import.meta.url)
export const art = (name) => JSON.parse(readFileSync(new URL(`contracts/out/${name}.json`, root), 'utf8'))

export function flag(name, fallback) {
  const i = process.argv.indexOf(`-${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

// The chain is the node's, asked once, so a script signs for whichever ZVM it
// is pointed at rather than always for one chain.
export async function clients(rpc) {
  const id = await createPublicClient({transport: http(rpc)}).getChainId()
  const chain = defineChain({
    id,
    name: `ZVM ${id}`,
    nativeCurrency: {name: 'Zenon', symbol: 'ZNN', decimals: 18},
    rpcUrls: {default: {http: [rpc]}},
  })
  return {chain, reader: createPublicClient({chain, transport: http(rpc)})}
}

export function signer(chain, rpc, key) {
  return createWalletClient({account: privateKeyToAccount(key), chain, transport: http(rpc)})
}

// zvm's deterministic devnet key, keccak256("zvm-dev-evm-<i>"), the same
// derivation as zvm's devnet.EVMKey. Index 900 is the devnet deployer. It is
// public, so it only ever pays; it never holds a role.
export const devKey = (i) => keccak256(toBytes(`zvm-dev-evm-${i}`))

// The relayer refuses a tip under 50 gwei; zvm's own senders offer 100.
export const TIP = 100_000_000_000n

export async function fees(reader) {
  const block = await reader.getBlock()
  return {maxFeePerGas: (block.baseFeePerGas ?? 0n) * 2n + TIP, maxPriorityFeePerGas: TIP}
}

export function loadJSON(url) {
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : null
}

export function saveJSON(url, value) {
  mkdirSync(new URL('.', url), {recursive: true})
  const tmp = new URL(url.href + '.tmp')
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  // Windows refuses the rename while anything has the record open, a page
  // build reading it for one: a deploy died on that once, mid-verify. Retry
  // for a few seconds before giving up.
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, url)
      return
    } catch (e) {
      if (e.code !== 'EPERM' || i >= 20) throw e
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
}

// --- the terms ---------------------------------------------------------------

const YEAR = 31_536_000n
const perYear = (znn) => parseEther(znn) / YEAR

/**
 * What a name costs and how it is released: ENS's shape at devnet scale.
 *
 * Rent is per second, in the oracle's unit, which is the ZNN wei while the
 * feed answers 1e8. The tiers keep ENS's ratios, 128 : 32 : 1 for three,
 * four and five-plus characters ($640 : $160 : $5 on ENS). One and two
 * characters cannot be registered (the controller's `valid`), so their slots
 * repeat the three-character price.
 *
 * The premium is ENS's too: it starts high and halves every day for 21
 * days. It applies to a name leaving its grace period, and at launch to every
 * name of up to six characters, the length ENS held back for its own
 * short-name auction in 2019. Longer names open at the base rent.
 *
 * Where it starts depends on the network (the user's call, 2026-09-29):
 * 5,000 ZNN on devnet, where people register to try things, and 100,000 on
 * testnet and mainnet, ENS's order of magnitude. Chain 7340469, a ZVM devnet
 * on NoM's devnet chain 69, is devnet.
 */
export const NETWORKS = {
  7340469: {network: 'devnet', startPremium: '5000'},
}
const DEFAULT_START_PREMIUM = '100000'

export function termsFor(chainId) {
  const net = NETWORKS[chainId] ?? {network: 'testnet or mainnet', startPremium: DEFAULT_START_PREMIUM}
  return {
    network: net.network,
    feedAnswer: 100_000_000n,
    rentPrices: [perYear('128'), perYear('128'), perYear('128'), perYear('32'), perYear('1')],
    startPremium: parseEther(net.startPremium),
    premiumDays: 21n,
    launchMaxLength: 6n,
    minCommitmentAge: 60n,
    maxCommitmentAge: 86_400n,
    gateways: ['x-batch-gateway:true'],
  }
}

export const NODES = {
  root: zeroHash,
  znn: namehash('znn'),
  reverse: namehash('reverse'),
  addrReverse: namehash('addr.reverse'),
}

/**
 * Deploys and wires the whole system, or finishes a deployment that stopped.
 * Every step reads the chain before it acts and writes the record after, so
 * running it again only does what is left.
 *
 * The order is ENS's own: the registry, then the reverse registrar under
 * addr.reverse (the public resolver's constructor claims a reverse record,
 * so it must exist first), then the .znn registrar, the price, the
 * controller, the resolver, the universal resolver, and last the hand-over
 * of every owner role to `owner`.
 */
export async function deploySystem({reader, wallet, rec, save, owner, siteURL, terms, log = console.log}) {
  const TERMS = terms ?? termsFor(await reader.getChainId())
  const me = wallet.account.address
  const c = (rec.contracts ??= {})
  // What the page shows as the terms, read from here rather than repeated in
  // it: ENS's oracle keeps its starting premium in a private immutable.
  rec.terms ??= {
    network: TERMS.network,
    startPremium: TERMS.startPremium.toString(),
    premiumDays: Number(TERMS.premiumDays),
    launchMaxLength: Number(TERMS.launchMaxLength),
  }

  async function send(label, tx) {
    const hash = await wallet.sendTransaction({...tx, ...(await fees(reader))})
    log(`${label}: ${hash}`)
    const r = await reader.waitForTransactionReceipt({hash, pollingInterval: 1_000, timeout: 600_000})
    if (r.status !== 'success') throw new Error(`${label} reverted`)
    rec.txs ??= {}
    rec.txs[label] = hash
    save()
    return r
  }

  async function deploy(name, args = [], artifactName = name) {
    if (c[name] && (await reader.getCode({address: c[name]}))?.length > 2) return c[name]
    const a = art(artifactName)
    const r = await send(`deploy ${name}`, {data: encodeDeployData({abi: a.abi, bytecode: a.bytecode, args})})
    c[name] = r.contractAddress
    rec.startBlock ??= Number(r.blockNumber)
    save()
    return c[name]
  }

  const read = (name, functionName, args = []) => reader.readContract({address: c[name], abi: art(name).abi, functionName, args})
  const call = (label, name, functionName, args = []) =>
    send(label, {to: c[name], data: encodeFunctionData({abi: art(name).abi, functionName, args})})

  await deploy('ENSRegistry')
  const ownerOf = (node) => read('ENSRegistry', 'owner', [node])

  // reverse, and addr.reverse under it for the reverse registrar.
  if ((await ownerOf(NODES.reverse)) === zeroAddress) {
    await call('own reverse', 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('reverse'), me])
  }
  await deploy('ReverseRegistrar', [c.ENSRegistry])
  if ((await ownerOf(NODES.addrReverse)).toLowerCase() !== c.ReverseRegistrar.toLowerCase()) {
    await call('addr.reverse to the reverse registrar', 'ENSRegistry', 'setSubnodeOwner', [NODES.reverse, labelhash('addr'), c.ReverseRegistrar])
  }

  // .znn and its registrar.
  await deploy('ZNSRegistrar', [c.ENSRegistry, NODES.znn, siteURL])
  if ((await ownerOf(NODES.znn)).toLowerCase() !== c.ZNSRegistrar.toLowerCase()) {
    await call('znn to the registrar', 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('znn'), c.ZNSRegistrar])
  }

  // The price: option 1, ENS's oracle reading a feed that answers 1e8.
  await deploy('ZNSPriceFeed', [TERMS.feedAnswer])
  await deploy('ExponentialPremiumPriceOracle', [c.ZNSPriceFeed, TERMS.rentPrices, TERMS.startPremium, TERMS.premiumDays])

  await deploy('ZNSController', [
    c.ZNSRegistrar,
    c.ExponentialPremiumPriceOracle,
    TERMS.minCommitmentAge,
    TERMS.maxCommitmentAge,
    c.ReverseRegistrar,
    c.ENSRegistry,
    TERMS.launchMaxLength,
  ])
  if (!rec.launchTime) {
    rec.launchTime = Number(await read('ZNSController', 'launchTime'))
    save()
  }
  if (!(await read('ZNSRegistrar', 'controllers', [c.ZNSController]))) {
    await call('controller may register', 'ZNSRegistrar', 'addController', [c.ZNSController])
  }
  if (!(await read('ReverseRegistrar', 'controllers', [c.ZNSController]))) {
    await call('controller may set reverse records', 'ReverseRegistrar', 'setController', [c.ZNSController, true])
  }

  await deploy('PublicResolver', [c.ENSRegistry, zeroAddress, c.ZNSController, c.ReverseRegistrar])
  if ((await read('ReverseRegistrar', 'defaultResolver')).toLowerCase() !== c.PublicResolver.toLowerCase()) {
    await call('reverse records resolve through the public resolver', 'ReverseRegistrar', 'setDefaultResolver', [c.PublicResolver])
  }

  await deploy('GatewayProvider', [owner, TERMS.gateways])
  await deploy('UniversalResolver', [owner, c.ENSRegistry, c.GatewayProvider])
  await deploy('StaticBulkRenewal', [c.ZNSController])

  // Every owner role to `owner`. The deploying key keeps nothing.
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  // reverse first: setting a node under the root needs the root, which goes
  // last.
  if (!same(await ownerOf(NODES.reverse), owner)) await call('reverse to the owner', 'ENSRegistry', 'setSubnodeOwner', [NODES.root, labelhash('reverse'), owner])
  if (!same(await ownerOf(NODES.root), owner)) await call('root to the owner', 'ENSRegistry', 'setOwner', [NODES.root, owner])
  for (const name of ['ZNSRegistrar', 'ReverseRegistrar', 'ZNSPriceFeed', 'ZNSController']) {
    if (!same(await read(name, 'owner'), owner)) await call(`${name} to the owner`, name, 'transferOwnership', [owner])
  }
  rec.owner = owner
  save()
  return c
}
