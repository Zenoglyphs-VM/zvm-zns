// Puts ZNS on the ZVM: tops the deployer's gas up from the devnet wallet,
// deploys and wires every contract, hands every owner role to the owner, and
// verifies each contract's source on the explorer. Each step checks the chain
// first, so a stopped deploy is finished by running it again.
//
//   node scripts/deploy.mjs [-rpc url, default $ZVM_RPC] [-api url, default $ZVM_NODE]
//                           [-owner 0x…] [-site url, default $ZVM_GATEWAY/zns/]
//                           [-keys secrets/zns.json] [-record deployments/zvm.json]
//                           [-funder 900] [-gas 30]
//
// Paths are relative to the repository root. The owner receives the rent (the
// controller's `withdraw`), sets the price (the feed), and holds the
// registry's root. It defaults to the devnet admin, the first EVM account of
// go-zenon's devnet mnemonic, whose key is public: pass -owner for any
// deployment that is meant to be owned.
import {readFileSync} from 'node:fs'
import {getAddress, parseEther} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {art, clients, deploySystem, devKey, fees, flag, loadJSON, root, saveJSON, signer} from './lib.mjs'

const rpc = flag('rpc', process.env.ZVM_RPC)
if (!rpc) throw new Error('pass -rpc, or set ZVM_RPC')
const api = flag('api', process.env.ZVM_NODE)
const owner = getAddress(flag('owner', '0xD73f244650c92b2263719BfFd921De6FE991900D'))
const siteURL = flag('site', process.env.ZVM_GATEWAY ? `${process.env.ZVM_GATEWAY.replace(/\/+$/, '')}/zns/` : undefined)
if (!siteURL) throw new Error('pass -site, the ZNS page names link to, or set ZVM_GATEWAY')
const keys = loadJSON(new URL(flag('keys', 'secrets/zns.json'), root))
const recordUrl = new URL(flag('record', 'deployments/zvm.json'), root)
const gasBudget = parseEther(flag('gas', '30'))
if (!keys?.deployer) throw new Error('no key: run `npm run keys` first')

const {chain, reader} = await clients(rpc)
const deployer = signer(chain, rpc, keys.deployer)
const rec = loadJSON(recordUrl) ?? {chainId: chain.id, txs: {}}
if (rec.chainId !== chain.id) throw new Error(`record is for chain ${rec.chainId}`)
const save = () => saveJSON(recordUrl, rec)

// The deployer pays for about thirty transactions, most of them contract
// creations.
const held = await reader.getBalance({address: deployer.account.address})
if (held < gasBudget) {
  const funder = signer(chain, rpc, devKey(Number(flag('funder', '900'))))
  const hash = await funder.sendTransaction({to: deployer.account.address, value: gasBudget - held, ...(await fees(reader))})
  console.log(`fund deployer: ${hash}`)
  const r = await reader.waitForTransactionReceipt({hash, pollingInterval: 2_000, timeout: 600_000})
  if (r.status !== 'success') throw new Error('funding reverted')
  rec.txs[`fund-deployer-${r.blockNumber}`] = hash
  save()
}

const c = await deploySystem({reader, wallet: deployer, rec, save, owner, siteURL})
rec.site = siteURL
rec.deployedAt ??= new Date().toISOString()
save()

if (api) {
  rec.verified ??= {}
  const input = JSON.parse(readFileSync(new URL('contracts/out/input.json', root), 'utf8'))
  for (const [name, address] of Object.entries(c)) {
    if (rec.verified[name]) continue
    rec.verified[name] = await verify(api.replace(/\/$/, ''), name, address, input)
    console.log(`verified ${name}: ${rec.verified[name]}`)
    save()
  }
}

for (const [name, address] of Object.entries(c)) console.log(`${name.padEnd(30)} ${address}`)
console.log(`owner ${owner}\ndeployer ${privateKeyToAccount(keys.deployer).address} (holds nothing now)`)

// verify submits the standard JSON input to the node's verifier and waits
// for its verdict.
async function verify(base, name, address, input) {
  const a = art(name)
  const res = await fetch(`${base}/api/verify`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({address, compiler: a.compilerVersion, contract: `${a.sourceName}:${a.contractName}`, input}),
  })
  let job = await res.json().catch(() => ({}))
  if (!job.id) {
    if (/already verified/i.test(`${job.error ?? ''}${job.message ?? ''}`)) return 'already verified'
    throw new Error(`verify ${name}: ${res.status} ${job.error ?? ''}${job.message ?? ''}`)
  }
  const end = Date.now() + 900_000
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() > end) throw new Error(`verify job ${job.id} still ${job.status} after 15 minutes`)
    await new Promise((r) => setTimeout(r, 3000))
    job = await (await fetch(`${base}/api/verify/${job.id}`)).json()
  }
  if (job.status !== 'verified') throw new Error(`verify ${name}: ${job.status}: ${job.message}`)
  return job.match || 'verified'
}
