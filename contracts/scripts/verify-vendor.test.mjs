import assert from 'node:assert/strict'
import test, {after, afterEach} from 'node:test'
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {join, dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {LIMITS, PACKAGE, VERSION, VendorError, regularSource, solidityImports, validateLock, verifyVendor} from './verify-vendor.mjs'

// Synthetic tar publications are declared fixtures. The separate CI check
// compares the actual pinned npm archive; these fixtures do not impersonate it.
const parent = process.env.ZNS_VENDOR_TEST_TMPDIR ?? process.env.RUNNER_TEMP ?? tmpdir()
const owned = await mkdtemp(join(parent, 'zns-vendor-check-'))
const created = new Set()
// Only paths generated in this process enter this set. Failed or historical
// fixture trees from another process are never selected for cleanup.
afterEach(async () => {for (const path of created) {await rm(path, {recursive: true, force: true}); created.delete(path)}})
after(async () => {await rm(owned, {recursive: true, force: true})})
const original = JSON.parse(await readFile(new URL('../vendor/ens-contracts.lock.json', import.meta.url), 'utf8'))
const dependencyLockBytes = await readFile(new URL('../package-lock.json', import.meta.url))
const deltaInputs = new Map(await Promise.all(Object.keys(original.znsDelta).map(async name =>
  [name, await readFile(new URL('../' + name, import.meta.url))])))
const inputs = new Map(await Promise.all(Object.keys(original.selection.files).map(async name =>
  [name, await readFile(new URL('../vendor/ens-contracts/' + name, import.meta.url))])))
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const json = value => JSON.stringify(value, null, 2) + '\n'
const clone = value => structuredClone(value)
let sequence = 0

function octal(header, offset, length, number) {
  header.write(number.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii')
}
function tar(members, tail = Buffer.alloc(1024)) {
  const chunks = []
  for (const member of members) {
    const header = Buffer.alloc(512), name = member.name, split = name.lastIndexOf('/')
    if (Buffer.byteLength(name) <= 100) header.write(name, 0, 100)
    else {assert.ok(Buffer.byteLength(name.slice(0, split)) <= 155); header.write(name.slice(split + 1), 0, 100); header.write(name.slice(0, split), 345, 155)}
    octal(header, 100, 8, 0o644); octal(header, 108, 8, 0); octal(header, 116, 8, 0)
    octal(header, 124, 12, member.bytes.length); octal(header, 136, 12, 0)
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 6); header.write('00', 263, 2)
    const sum = header.reduce((n, byte) => n + byte, 0)
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    chunks.push(header, member.bytes, Buffer.alloc((512 - member.bytes.length % 512) % 512))
  }
  return Buffer.concat([...chunks, tail])
}
function publication(files = inputs) {
  return [{name: 'package/package.json', bytes: Buffer.from(JSON.stringify({name: PACKAGE, version: VERSION, license: 'MIT'}))},
    ...[...files].map(([name, bytes]) => ({name: 'package/' + name, bytes}))]
}
async function fixture({files = new Map(inputs), mutateMembers, mutateTar, tail, mutateLock} = {}) {
  const work = join(owned, String(++sequence)), vendor = join(work, 'vendor'), lockPath = join(work, 'lock.json'), archive = join(work, 'fixture.tgz'), dependencyLockPath = join(work, 'dependency-lock.json'), deltaRoot = join(work, 'delta')
  created.add(work)
  for (const [name, bytes] of files) {await mkdir(dirname(join(vendor, name)), {recursive: true}); await writeFile(join(vendor, name), bytes, {flag: 'wx'})}
  let members = publication(files)
  if (mutateMembers) members = mutateMembers(members)
  let unpacked = tar(members, tail)
  if (mutateTar) unpacked = mutateTar(unpacked)
  const compressed = gzipSync(unpacked), lock = clone(original)
  lock.package.integrity = 'sha512-' + hash(compressed, 'sha512', 'base64')
  lock.archive = {sha256: hash(compressed), bytes: compressed.length, tarBytes: unpacked.length,
    payloadBytes: members.reduce((n, m) => n + m.bytes.length, 0), fileCount: members.length}
  for (const [name, bytes] of files) lock.selection.files[name] = {sha256: hash(bytes), bytes: bytes.length}
  if (mutateLock) mutateLock(lock)
  await writeFile(lockPath, json(lock), {flag: 'wx'}); await writeFile(archive, compressed, {flag: 'wx'})
  await writeFile(dependencyLockPath, dependencyLockBytes, {flag: 'wx'})
  for (const [name, bytes] of deltaInputs) {await mkdir(dirname(join(deltaRoot, name)), {recursive: true}); await writeFile(join(deltaRoot, name), bytes, {flag: 'wx'})}
  return {vendor, lockPath, archive, dependencyLockPath, deltaRoot, lock}
}
const rejected = (f, code, extra = {}) => assert.rejects(verifyVendor({...f, ...extra}), error => error instanceof VendorError && error.code === code)

test('the committed local source manifest and complete relative-import closure agree', async () => {
  const result = await verifyVendor()
  assert.equal(result.selectedFiles, 68); assert.equal(result.sourceFiles, 67); assert.equal(result.selectedBytes, 196164)
  assert.equal(result.archiveCompared, false); assert.equal(result.vendoredCodeExecuted, false)
  assert.equal(result.dependencyImportsBound, 3)
  assert.equal(result.znsDeltaFilesBound, 3)
  assert.equal(result.distributionLicenseReviewCompleted, false)
})

test('a declared synthetic archive matches the source bytes, license, package identity and import closure', async () => {
  const f = await fixture(), result = await verifyVendor(f)
  assert.equal(result.passed, true); assert.equal(result.archiveCompared, true)
  assert.equal(result.packageFilesCompared, 69); assert.equal(result.selectedFiles, 68)
  assert.equal(result.licenseSha256, original.selection.files['LICENSE.txt'].sha256)
})

test('an independently written USTAR prefix and an unselected scoped-package path are consumed correctly', async () => {
  const f = await fixture({mutateMembers: members => [...members,
    {name: 'package/artifacts/@fixture/' + 'long-directory/'.repeat(8) + 'item.json', bytes: Buffer.from('{}')}]})
  assert.equal((await verifyVendor(f)).packageFilesCompared, 70)
})

test('256 malformed lock variants fail before source or archive authority can be granted', () => {
  const changes = [
    (l, i) => {l.package.name = '@fixture/other-' + i}, (l, i) => {l.package.version = i + '.0.0'},
    (l, i) => {l.package.tarball += '?changed=' + i}, (l, i) => {l.package.integrity = 'sha256-wrong-' + i},
    (l, i) => {l.package.gitHead = i.toString(16).padStart(2, '0') + 'g'.repeat(38)}, (l, i) => {l.package.license = 'other-' + i},
    (l, i) => {l.archive.bytes = -1 - i}, (l, i) => {l.archive.tarBytes = LIMITS.expanded + 1 + i},
    (l, i) => {l.archive.payloadBytes = -1 - i}, (l, i) => {l.archive.fileCount = LIMITS.members + 1 + i},
    (l, i) => {l.archive['extra' + i] = true}, (l, i) => {l.archive.sha256 = i.toString(16).padStart(63, '0')},
    (l, i) => {l.selection.roots[l.selection.roots.length - 1] = 'contracts/Unknown' + i + '.sol'},
    (l, i) => {delete l.selection.files['LICENSE.txt']; l.selection.files['MISSING-LICENSE-' + i + '.txt'] = {sha256: '0'.repeat(64), bytes: 1}},
    (l, i) => {l.selection.externalImports[0] += '?variant=' + i; l.selection.externalImports.push(l.selection.externalImports[0])},
    (l, i) => {l.selection.files['LICENSE.txt'].bytes = -1 - i},
  ]
  const unique = new Set()
  for (let i = 0; i < 256; i++) {
    const lock = clone(original); changes[i % changes.length](lock, i); unique.add(JSON.stringify(lock))
    assert.throws(() => validateLock(lock), error => error instanceof VendorError && error.code === 'INVALID_LOCK')
  }
  assert.equal(unique.size, 256)
})

test('duplicate JSON fields are refused by canonical lock reading', async () => {
  const f = await fixture(), text = await readFile(f.lockPath, 'utf8')
  await writeFile(f.lockPath, text.replace('"schema": 1,', '"schema": 1,\n  "schema": 1,'))
  await rejected(f, 'NON_CANONICAL_LOCK')
})

test('changed source bytes remain held even when the compressed archive itself is intact', async () => {
  const f = await fixture(); await writeFile(join(f.vendor, 'LICENSE.txt'), 'changed license')
  await rejected(f, 'SOURCE_BYTES_MISMATCH')
})

test('missing and unreviewed source files cannot shrink or extend the selected inventory', async () => {
  const f = await fixture(); await rm(join(f.vendor, 'LICENSE.txt'))
  await rejected(f, 'SOURCE_INVENTORY_MISMATCH')
  const g = await fixture(); await writeFile(join(g.vendor, 'unexpected.sol'), 'pragma solidity ^0.8.0;')
  await rejected(g, 'UNEXPECTED_SOURCE')
})

test('declared file-kind metadata rejects links and multiply linked file identities before reading', () => {
  assert.equal(regularSource({isFile: () => true, nlink: 1}), true)
  assert.equal(regularSource({isFile: () => false, nlink: 1}), false)
  assert.equal(regularSource({isFile: () => true, nlink: 2}), false)
})

test('comments and unrelated string literals cannot invent Solidity imports', () => {
  assert.deepEqual(solidityImports(String.raw`// import "ignored.sol";
/* import "ignored2.sol"; */
string constant TEXT = "import \"ignored3.sol\";";
import {A} from "./Real.sol";`), ['./Real.sol'])
  assert.throws(() => solidityImports('import "./escaped\\x2esol";'), error => error.code === 'SOURCE_IMPORT')
  assert.throws(() => solidityImports('/* unfinished'), error => error.code === 'SOURCE_LEXICAL')
})

test('both the complete dependency lock and each effective imported alias binding are checked', async () => {
  const f = await fixture(); await writeFile(f.dependencyLockPath, Buffer.concat([dependencyLockBytes, Buffer.from('\n')]))
  await rejected(f, 'DEPENDENCY_LOCK_CHANGED')
  const g = await fixture(), changed = JSON.parse(dependencyLockBytes)
  changed.packages['node_modules/' + g.lock.dependencyLock.imports[0].prefix].version = '0.0.0'
  const bytes = Buffer.from(json(changed)); g.lock.dependencyLock.sha256 = hash(bytes)
  await writeFile(g.dependencyLockPath, bytes); await writeFile(g.lockPath, json(g.lock))
  await rejected(g, 'DEPENDENCY_LOCK_BINDING')
})

test('a changed local ZNS fork needs a new source review even when ENS and dependencies are unchanged', async () => {
  const f = await fixture(); await writeFile(join(f.deltaRoot, 'src/ZNSPriceFeed.sol'), 'changed local source')
  await rejected(f, 'ZNS_DELTA_REVIEW_REQUIRED')
})

test('a newly declared external dependency and a relative escape require a different review', async () => {
  const file = original.selection.roots[0], bytes = inputs.get(file)
  const external = new Map(inputs); external.set(file, Buffer.concat([bytes, Buffer.from('\nimport "@fixture/new/Extra.sol";')]))
  await rejected(await fixture({files: external}), 'IMPORT_CLOSURE_MISMATCH')
  const escape = new Map(inputs); escape.set(file, Buffer.concat([bytes, Buffer.from('\nimport "../../../outside.sol";')]))
  await rejected(await fixture({files: escape}), 'IMPORT_ESCAPE')
})

test('a changed compressed digest is refused before any archive member is trusted', async () => {
  const f = await fixture(), bytes = await readFile(f.archive); bytes[9] ^= 1; await writeFile(f.archive, bytes)
  await rejected(f, 'ARCHIVE_DIGEST_MISMATCH')
})

test('a bad header checksum is refused even for a correctly pinned declared test archive', async () => {
  await rejected(await fixture({mutateTar: bytes => {bytes[0] ^= 1; return bytes}}), 'TAR_CHECKSUM')
})

test('unsupported link formats, traversal and duplicate members cannot become selected input', async () => {
  await rejected(await fixture({mutateTar: bytes => {bytes[156] = 50; return bytes}}), 'TAR_FORMAT')
  await rejected(await fixture({mutateMembers: members => [...members, {name: 'package/../escape', bytes: Buffer.from('x')}]}), 'TAR_PATH')
  await rejected(await fixture({mutateMembers: members => [...members, members[1]]}), 'DUPLICATE_TAR_MEMBER')
})

test('archive bytes cannot replace a selected source or omit one while local hashes remain valid', async () => {
  await rejected(await fixture({mutateMembers: members => members.map((m, i) => i === 1 ? {...m, bytes: Buffer.from(m.bytes).fill(32)} : m)}), 'ARCHIVE_SOURCE_MISMATCH')
  await rejected(await fixture({mutateMembers: members => members.filter((_, i) => i !== 1)}), 'ARCHIVE_INVENTORY_MISMATCH')
})

test('the root package identity is checked separately from selected Solidity and license bytes', async () => {
  await rejected(await fixture({mutateMembers: members => members.map((m, i) => i === 0 ? {...m, bytes: Buffer.from('{"name":"@fixture/other","version":"1.7.0","license":"MIT"}')} : m)}), 'PACKAGE_IDENTITY')
})

test('truncated endings, nonzero padding and data after tar end markers are refused', async () => {
  await rejected(await fixture({tail: Buffer.alloc(512)}), 'TRUNCATED_TAR')
  await rejected(await fixture({mutateTar: bytes => {const n = publication()[0].bytes.length; bytes[512 + n] = 1; return bytes}}), 'TAR_PADDING')
  await rejected(await fixture({tail: Buffer.concat([Buffer.alloc(1024), Buffer.from('unexpected')])}), 'TRAILING_TAR_DATA')
})

test('the expanded stream limit is enforced without extracting the archive', async () => {
  await rejected(await fixture(), 'EXPANDED_LIMIT', {limits: {expanded: 1024}})
})

test('a malformed gzip with its own declared fixture digest still cannot grant a successful proof', async () => {
  const f = await fixture(), bytes = await readFile(f.archive); bytes[bytes.length - 5] ^= 1
  f.lock.archive.sha256 = hash(bytes); f.lock.package.integrity = 'sha512-' + hash(bytes, 'sha512', 'base64')
  await writeFile(f.lockPath, json(f.lock)); await writeFile(f.archive, bytes)
  await assert.rejects(verifyVendor(f))
})

test('the CLI emits a bounded reason without echoing an untrusted path argument', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./verify-vendor.mjs', import.meta.url)), '--unknown', 'fixture-sensitive-path'], {encoding: 'utf8'})
  assert.equal(child.status, 1); assert.equal(child.stdout, '')
  assert.deepEqual(JSON.parse(child.stderr), {passed: false, error: 'ARGUMENTS'})
  assert.equal(child.stderr.includes('fixture-sensitive-path'), false)
})
