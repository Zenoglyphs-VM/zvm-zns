// Writes the key that deploys ZNS, and refuses to replace it.
//
//   node scripts/keys.mjs [-out secrets/zns.json], relative to the repository root
//
// The deployer holds the registry's root and every owner role while the
// system is wired, then hands them all to the owner (deploy.mjs -owner), so
// afterwards it owns nothing. It is still generated rather than taken from
// zvm's public devnet keys: between the first deploy and the hand-over,
// whoever holds it holds .znn.
import {mkdirSync, writeFileSync} from 'node:fs'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {flag, root} from './lib.mjs'

const out = new URL(flag('out', 'secrets/zns.json'), root)
mkdirSync(new URL('.', out), {recursive: true})
const keys = {deployer: generatePrivateKey()}
try {
  writeFileSync(out, JSON.stringify(keys, null, 2) + '\n', {flag: 'wx', mode: 0o600})
} catch (e) {
  if (e.code === 'EEXIST') {
    console.error(`${out.pathname} exists; not replacing the deployer's key`)
    process.exit(1)
  }
  throw e
}
console.log(`wrote ${out.pathname}\n  deployer ${privateKeyToAccount(keys.deployer).address}`)
