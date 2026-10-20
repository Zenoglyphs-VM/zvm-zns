// Copies the ENS sources ZNS is built from into ../vendor/ens-contracts,
// from the published npm package at the pinned version, and nothing else.
//
//   node scripts/vendor.mjs
//
// Vendored rather than installed: @ensdomains/ens-contracts depends on a
// GitHub-hosted package (clones-with-immutable-args) that npm refuses to fetch
// for a non-root package, and ZNS needs none of the code that uses it. The
// copy is the package's own files at their own paths, so `diff` against the
// tarball shows nothing, and the explorer verifies every contract from the
// same bytes. Only the files reachable from ROOTS by import are kept.
import {execFileSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, posix} from 'node:path'

export const VERSION = '1.7.0'

// What ZNS deploys unchanged, what it inherits from, and the controller its
// own is a fork of (kept so the fork's diff can be read against it).
const ROOTS = [
  'registry/ENSRegistry.sol',
  'ethregistrar/BaseRegistrarImplementation.sol',
  'ethregistrar/ETHRegistrarController.sol',
  'ethregistrar/ExponentialPremiumPriceOracle.sol',
  'ethregistrar/StaticBulkRenewal.sol',
  'resolvers/PublicResolver.sol',
  'reverseRegistrar/ReverseRegistrar.sol',
  'universalResolver/UniversalResolver.sol',
  'ccipRead/GatewayProvider.sol',
]

const out = new URL('../vendor/ens-contracts/', import.meta.url)
const work = mkdtempSync(join(tmpdir(), 'zns-ens-'))
try {
  execFileSync('npm', ['pack', `@ensdomains/ens-contracts@${VERSION}`, '--silent'], {cwd: work, shell: true})
  execFileSync('tar', ['xzf', `ensdomains-ens-contracts-${VERSION}.tgz`], {cwd: work})
  const pkg = join(work, 'package')
  const src = join(pkg, 'contracts')

  const keep = new Set()
  const external = new Set()
  const walk = (file) => {
    if (keep.has(file)) return
    keep.add(file)
    const text = readFileSync(join(src, file), 'utf8')
    for (const m of text.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g)) {
      if (m[1].startsWith('.')) walk(posix.normalize(posix.join(posix.dirname(file), m[1])))
      else external.add(m[1].split('/').slice(0, m[1].startsWith('@') ? 2 : 1).join('/'))
    }
  }
  ROOTS.forEach(walk)

  if (existsSync(out)) rmSync(out, {recursive: true})
  for (const file of keep) {
    const to = new URL(`contracts/${file}`, out)
    mkdirSync(dirname(to.pathname.replace(/^\/([A-Za-z]:)/, '$1')), {recursive: true})
    cpSync(join(src, file), to)
  }
  cpSync(join(pkg, 'LICENSE.txt'), new URL('LICENSE.txt', out))
  console.log(`vendored ${keep.size} files of @ensdomains/ens-contracts@${VERSION}`)
  console.log(`they import: ${[...external].sort().join(', ')}`)
} finally {
  rmSync(work, {recursive: true, force: true})
}
