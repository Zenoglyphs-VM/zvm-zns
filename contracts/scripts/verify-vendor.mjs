// Read-only verification of the reviewed ENS publication and selected sources.
// No package code, download command, archive extraction or vendor rewrite runs.
import {constants, createReadStream} from 'node:fs'
import {lstat, open, readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createGunzip} from 'node:zlib'
import {join, posix} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

export const PACKAGE = '@ensdomains/ens-contracts'
export const VERSION = '1.7.0'
export const TARBALL = 'https://registry.npmjs.org/@ensdomains/ens-contracts/-/ens-contracts-1.7.0.tgz'
export const ROOTS = Object.freeze([
  'contracts/ccipRead/GatewayProvider.sol',
  'contracts/ethregistrar/BaseRegistrarImplementation.sol',
  'contracts/ethregistrar/ETHRegistrarController.sol',
  'contracts/ethregistrar/ExponentialPremiumPriceOracle.sol',
  'contracts/ethregistrar/StaticBulkRenewal.sol',
  'contracts/registry/ENSRegistry.sol',
  'contracts/resolvers/PublicResolver.sol',
  'contracts/reverseRegistrar/ReverseRegistrar.sol',
  'contracts/universalResolver/UniversalResolver.sol',
])
export const LIMITS = Object.freeze({compressed: 32 << 20, expanded: 160 << 20, selected: 4 << 20, source: 256 << 10, members: 2000, files: 256})
const DELTA = ['src/ZNSController.sol', 'src/ZNSPriceFeed.sol', 'src/ZNSRegistrar.sol']
export class VendorError extends Error {
  constructor(code, path) {super(code); this.code = code; if (path && canonical(path)) this.path = path}
}
const refuse = (code, path) => {throw new VendorError(code, path)}
const canonical = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith('/') && value.split('/').every(p => p && p !== '.' && p !== '..')
const canonicalTar = (value) => value.length > 0 && value.length <= 512 && !value.startsWith('/') &&
  !/[\x00-\x1f\x7f\\]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..')
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
const integer = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sortedUnique = (items) => Array.isArray(items) && items.every(x => typeof x === 'string') && equal(items, [...new Set(items)].sort())
const utf8 = (bytes) => {try {return new TextDecoder('utf-8', {fatal: true}).decode(bytes)} catch {return refuse('INVALID_UTF8')}}
const identity = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'nlink'].every(k => a[k] === b[k])
export const regularSource = (info) => info?.isFile() === true && info.nlink === 1

async function smallFile(path, cap) {
  const before = await lstat(path)
  if (!regularSource(before) || before.size > cap) refuse('SOURCE_KIND_OR_SIZE')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    if (!identity(before, await file.stat())) refuse('SOURCE_CHANGED')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) refuse('SOURCE_CHANGED')
      offset += bytesRead
    }
    if ((await file.read(Buffer.alloc(1), 0, 1, offset)).bytesRead || !identity(before, await file.stat())) refuse('SOURCE_CHANGED')
    return bytes
  } finally {await file.close()}
}

export function validateLock(lock) {
  if (!keys(lock, ['schema', 'package', 'archive', 'selection', 'dependencyLock', 'znsDelta']) || lock.schema !== 1 ||
      !keys(lock.package, ['name', 'version', 'tarball', 'integrity', 'gitHead', 'license']) ||
      lock.package.name !== PACKAGE || lock.package.version !== VERSION || lock.package.tarball !== TARBALL || lock.package.license !== 'MIT' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(lock.package.integrity) ||
      (lock.package.gitHead !== null && !/^[a-f0-9]{40}$/.test(lock.package.gitHead)) ||
      !keys(lock.archive, ['sha256', 'bytes', 'tarBytes', 'payloadBytes', 'fileCount']) || !/^[a-f0-9]{64}$/.test(lock.archive.sha256) ||
      !integer(lock.archive.bytes, LIMITS.compressed) || !integer(lock.archive.tarBytes, LIMITS.expanded) ||
      !integer(lock.archive.payloadBytes, LIMITS.expanded) || !integer(lock.archive.fileCount, LIMITS.members) ||
      !keys(lock.selection, ['roots', 'externalImports', 'files']) || !equal(lock.selection.roots, ROOTS) ||
      !sortedUnique(lock.selection.externalImports) || lock.selection.externalImports.some(p => !canonicalTar(p) || !/^@[^/]+\/[^/]+\/.+\.sol$/.test(p))) refuse('INVALID_LOCK')
  const files = lock.selection.files
  if (!files || typeof files !== 'object' || Array.isArray(files) || !sortedUnique(Object.keys(files)) ||
      !Object.keys(files).length || Object.keys(files).length > LIMITS.files || !files['LICENSE.txt']) refuse('INVALID_LOCK')
  let bytes = 0
  for (const [name, entry] of Object.entries(files)) {
    if (!canonical(name) || (name !== 'LICENSE.txt' && !/^contracts\/.+\.sol$/.test(name)) ||
        !keys(entry, ['sha256', 'bytes']) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !integer(entry.bytes, LIMITS.source)) refuse('INVALID_LOCK')
    bytes += entry.bytes
  }
  const dependency = lock.dependencyLock
  if (bytes > LIMITS.selected || ROOTS.some(name => !files[name]) || !keys(dependency, ['sha256', 'imports']) ||
      !/^[a-f0-9]{64}$/.test(dependency.sha256) || !Array.isArray(dependency.imports) || dependency.imports.length > 16) refuse('INVALID_LOCK')
  const prefixes = [...new Set(lock.selection.externalImports.map(path => path.split('/').slice(0, 2).join('/')))].sort()
  if (!equal(dependency.imports.map(entry => entry?.prefix), prefixes)) refuse('INVALID_LOCK')
  for (const entry of dependency.imports) {
    if (!keys(entry, ['prefix', 'name', 'version', 'resolved', 'integrity']) || !/^@[^/]+\/[^/]+$/.test(entry.name) ||
        !/^\d+\.\d+\.\d+$/.test(entry.version) || entry.resolved !== `https://registry.npmjs.org/${entry.name}/-/${entry.name.split('/')[1]}-${entry.version}.tgz` ||
        !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) refuse('INVALID_LOCK')
  }
  if (!keys(lock.znsDelta, DELTA) || !equal(Object.keys(lock.znsDelta), DELTA)) refuse('INVALID_LOCK')
  for (const entry of Object.values(lock.znsDelta)) {
    if (!keys(entry, ['sha256', 'bytes']) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !integer(entry.bytes, LIMITS.source)) refuse('INVALID_LOCK')
  }
  return lock
}

async function verifyDependencyLock(path, lock) {
  const bytes = await smallFile(path, 1 << 20)
  if (digest(bytes) !== lock.dependencyLock.sha256) refuse('DEPENDENCY_LOCK_CHANGED')
  let value
  try {value = JSON.parse(utf8(bytes))} catch {refuse('DEPENDENCY_LOCK_FORMAT')}
  if (value.lockfileVersion !== 3 || !value.packages) refuse('DEPENDENCY_LOCK_FORMAT')
  for (const entry of lock.dependencyLock.imports) {
    const installed = value.packages['node_modules/' + entry.prefix]
    if (!installed || (installed.name ?? entry.prefix) !== entry.name || installed.version !== entry.version ||
        installed.resolved !== entry.resolved || installed.integrity !== entry.integrity) refuse('DEPENDENCY_LOCK_BINDING')
  }
  return lock.dependencyLock.imports.length
}

// Comments and unrelated string literals cannot add imports to the closure.
export function solidityImports(source) {
  let i = 0
  const imports = []
  const space = () => {
    while (i < source.length) {
      if (/\s/.test(source[i])) {i++; continue}
      if (source.startsWith('//', i)) {const at = source.indexOf('\n', i + 2); i = at < 0 ? source.length : at + 1; continue}
      if (source.startsWith('/*', i)) {const at = source.indexOf('*/', i + 2); if (at < 0) refuse('SOURCE_LEXICAL'); i = at + 2; continue}
      break
    }
  }
  const quoted = () => {
    const quote = source[i++]; let value = '', escaped = false
    while (i < source.length) {
      const char = source[i++]
      if (char === quote) return {value, escaped}
      if (char === '\\') {escaped = true; if (i >= source.length) break; value += source[i++]} else value += char
    }
    return refuse('SOURCE_LEXICAL')
  }
  while (i < source.length) {
    space(); if (i >= source.length) break
    if (source[i] === '"' || source[i] === "'") {quoted(); continue}
    const token = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i))
    if (!token) {i++; continue}
    i += token[0].length
    if (token[0] !== 'import') continue
    const literals = []; let terminated = false
    while (i < source.length) {
      space()
      if (source[i] === ';') {i++; terminated = true; break}
      if (source[i] === '"' || source[i] === "'") literals.push(quoted()); else i++
    }
    if (!terminated || literals.length !== 1 || literals[0].escaped || literals[0].value.length > 512) refuse('SOURCE_IMPORT')
    imports.push(literals[0].value)
  }
  return imports
}

export function verifyClosure(files, lock) {
  const seen = new Set(), external = new Set()
  const visit = (name) => {
    if (seen.has(name)) return
    const bytes = files.get(name); if (!bytes) refuse('MISSING_IMPORT', name)
    seen.add(name)
    for (const path of solidityImports(utf8(bytes))) {
      if (path.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(name), path))
        if (!canonical(target) || !target.startsWith('contracts/')) refuse('IMPORT_ESCAPE')
        visit(target)
      } else external.add(path)
    }
  }
  ROOTS.forEach(visit)
  if (!equal([...seen].sort(), [...files.keys()].filter(n => n !== 'LICENSE.txt').sort()) ||
      !equal([...external].sort(), lock.selection.externalImports)) refuse('IMPORT_CLOSURE_MISMATCH')
  return {sourceFiles: seen.size, externalImports: [...external].sort()}
}

async function selectedFiles(vendor, lock) {
  const files = new Map()
  const walk = async (relative) => {
    const directory = join(vendor, relative)
    if (!(await lstat(directory)).isDirectory()) refuse('SOURCE_KIND')
    for (const name of (await readdir(directory)).sort()) {
      const path = relative ? relative + '/' + name : name
      if (!canonical(path)) refuse('SOURCE_PATH')
      const file = join(vendor, path), stat = await lstat(file)
      if (stat.isDirectory()) {await walk(path); continue}
      const expected = lock.selection.files[path]
      if (!expected || !regularSource(stat)) refuse('UNEXPECTED_SOURCE', path)
      const bytes = await smallFile(file, LIMITS.source)
      if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) refuse('SOURCE_BYTES_MISMATCH', path)
      files.set(path, bytes)
    }
  }
  await walk('')
  if (!equal([...files.keys()].sort(), Object.keys(lock.selection.files))) refuse('SOURCE_INVENTORY_MISMATCH')
  return files
}

class TarReader {
  constructor(stream, cap) {this.iterator = stream[Symbol.asyncIterator](); this.chunk = Buffer.alloc(0); this.offset = 0; this.bytes = 0; this.cap = cap}
  async consume(size, collect) {
    const output = collect ? Buffer.alloc(size) : null
    let offset = 0
    while (offset < size) {
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next(); if (next.done) refuse('TRUNCATED_TAR')
        this.chunk = next.value; this.offset = 0; this.bytes += this.chunk.length
        if (this.bytes > this.cap) refuse('EXPANDED_LIMIT')
      }
      const take = Math.min(size - offset, this.chunk.length - this.offset)
      if (output) this.chunk.copy(output, offset, this.offset, this.offset + take)
      this.offset += take; offset += take
    }
    return output
  }
  take(size) {return this.consume(size, true)}
  skip(size) {return this.consume(size, false)}
  async zeroTail() {
    for (;;) {
      if (this.chunk.subarray(this.offset).some(x => x !== 0)) refuse('TRAILING_TAR_DATA')
      const next = await this.iterator.next(); if (next.done) return
      this.chunk = next.value; this.offset = 0; this.bytes += this.chunk.length
      if (this.bytes > this.cap) refuse('EXPANDED_LIMIT')
    }
  }
}
const octal = (bytes) => {
  const value = bytes.toString('latin1')
  if (!/^[0-7]+[\0 ]*$/.test(value)) return refuse('TAR_NUMBER')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number) || number < 0) refuse('TAR_NUMBER')
  return number
}
const field = (bytes) => {
  const end = bytes.indexOf(0)
  if (end >= 0 && bytes.subarray(end).some(x => x !== 0)) refuse('TAR_NAME')
  return utf8(end < 0 ? bytes : bytes.subarray(0, end))
}

export async function compareArchive(path, lock, files, limits = {}) {
  const cap = limits.expanded ?? LIMITS.expanded
  if (!integer(cap, LIMITS.expanded)) refuse('INVALID_LIMIT')
  const before = await lstat(path)
  if (!before.isFile() || before.nlink !== 1 || before.size !== lock.archive.bytes || before.size > LIMITS.compressed) refuse('ARCHIVE_KIND_OR_SIZE')
  const hashes = {sha256: createHash('sha256'), sha512: createHash('sha512')}
  let size = 0
  for await (const chunk of createReadStream(path)) {
    size += chunk.length; if (size > LIMITS.compressed) refuse('COMPRESSED_LIMIT')
    Object.values(hashes).forEach(hash => hash.update(chunk))
  }
  if (size !== lock.archive.bytes || hashes.sha256.digest('hex') !== lock.archive.sha256 ||
      'sha512-' + hashes.sha512.digest('base64') !== lock.package.integrity || !identity(before, await lstat(path))) refuse('ARCHIVE_DIGEST_MISMATCH')
  const source = createReadStream(path), gzip = createGunzip()
  // Bind the bytes actually decompressed as well as the initial admission hash.
  // A caller changing a regular file between passes cannot change the proof.
  const consumed = createHash('sha256'); let consumedBytes = 0
  source.on('data', chunk => {
    consumedBytes += chunk.length
    if (consumedBytes > LIMITS.compressed) source.destroy(new VendorError('COMPRESSED_LIMIT'))
    else consumed.update(chunk)
  })
  source.on('error', error => gzip.destroy(error)); source.pipe(gzip)
  const reader = new TarReader(gzip, cap), seen = new Set(), matched = new Set()
  let payloadBytes = 0, packageIdentity = false
  try {
    for (;;) {
      const header = await reader.take(512)
      if (header.every(x => x === 0)) {
        if (!(await reader.take(512)).every(x => x === 0)) refuse('TAR_END_MARKERS')
        await reader.zeroTail(); break
      }
      if (seen.size >= LIMITS.members || header[156] !== 48 || header.subarray(257, 263).toString('latin1') !== 'ustar\0') refuse('TAR_FORMAT')
      const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0)
      if (octal(header.subarray(148, 156)) !== checksum) refuse('TAR_CHECKSUM')
      const prefix = field(header.subarray(345, 500)), name = (prefix ? prefix + '/' : '') + field(header.subarray(0, 100))
      if (!canonicalTar(name) || !name.startsWith('package/')) refuse('TAR_PATH')
      if (seen.has(name)) refuse('DUPLICATE_TAR_MEMBER')
      seen.add(name)
      const bytes = octal(header.subarray(124, 136)); if (bytes > LIMITS.expanded) refuse('TAR_MEMBER_LIMIT')
      payloadBytes += bytes; if (payloadBytes > lock.archive.payloadBytes) refuse('TAR_PAYLOAD_LIMIT')
      const relative = name.slice('package/'.length)
      if (files.has(relative)) {
        if (bytes !== files.get(relative).length || bytes > LIMITS.source) refuse('ARCHIVE_SOURCE_SIZE', relative)
        if (!(await reader.take(bytes)).equals(files.get(relative))) refuse('ARCHIVE_SOURCE_MISMATCH', relative)
        matched.add(relative)
      } else if (relative === 'package.json') {
        if (bytes > LIMITS.source) refuse('PACKAGE_METADATA_SIZE')
        let pkg
        try {pkg = JSON.parse(utf8(await reader.take(bytes)))} catch {refuse('PACKAGE_METADATA')}
        if (pkg.name !== PACKAGE || pkg.version !== VERSION || pkg.license !== 'MIT') refuse('PACKAGE_IDENTITY')
        packageIdentity = true
      } else await reader.skip(bytes)
      if (!(await reader.take((512 - bytes % 512) % 512)).every(x => x === 0)) refuse('TAR_PADDING')
    }
    if (consumedBytes !== lock.archive.bytes || consumed.digest('hex') !== lock.archive.sha256) refuse('ARCHIVE_DIGEST_MISMATCH')
    if (!packageIdentity || seen.size !== lock.archive.fileCount || payloadBytes !== lock.archive.payloadBytes || reader.bytes !== lock.archive.tarBytes ||
        matched.size !== files.size || !identity(before, await lstat(path))) refuse('ARCHIVE_INVENTORY_MISMATCH')
    return {files: seen.size, payloadBytes, tarBytes: reader.bytes, selectedFiles: matched.size}
  } finally {source.destroy(); gzip.destroy()}
}

export async function verifyVendor({vendor, lockPath, dependencyLockPath, deltaRoot, archive, limits} = {}) {
  const directory = fileURLToPath(new URL('../vendor/ens-contracts/', import.meta.url))
  const lockFile = fileURLToPath(new URL('../vendor/ens-contracts.lock.json', import.meta.url))
  const text = utf8(await smallFile(lockPath ?? lockFile, 1 << 20))
  let lock
  try {lock = JSON.parse(text)} catch {refuse('INVALID_LOCK')}
  if (JSON.stringify(lock, null, 2) + '\n' !== text) refuse('NON_CANONICAL_LOCK')
  validateLock(lock)
  const dependencyImportsBound = await verifyDependencyLock(dependencyLockPath ?? new URL('../package-lock.json', import.meta.url), lock)
  for (const name of DELTA) {
    const bytes = await smallFile(deltaRoot ? join(deltaRoot, name) : new URL('../' + name, import.meta.url), LIMITS.source)
    if (bytes.length !== lock.znsDelta[name].bytes || digest(bytes) !== lock.znsDelta[name].sha256) refuse('ZNS_DELTA_REVIEW_REQUIRED', name)
  }
  const files = await selectedFiles(vendor ?? directory, lock), graph = verifyClosure(files, lock)
  const compared = archive ? await compareArchive(archive, lock, files, limits) : null
  return {passed: true, package: PACKAGE, version: VERSION, localManifestVerified: true, archiveCompared: !!compared,
    archiveSha256: lock.archive.sha256, selectedFiles: files.size, selectedBytes: [...files.values()].reduce((n, b) => n + b.length, 0),
    sourceFiles: graph.sourceFiles, externalImports: graph.externalImports, dependencyImportsBound, znsDeltaFilesBound: DELTA.length,
    dependencyLockSha256: lock.dependencyLock.sha256, licenseSha256: lock.selection.files['LICENSE.txt'].sha256,
    packageFilesCompared: compared?.files ?? 0, tarBytesRead: compared?.tarBytes ?? 0,
    vendoredCodeExecuted: false, packageInstallPerformed: false, distributionLicenseReviewCompleted: false}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.length && (args.length !== 2 || args[0] !== '--archive')) refuse('ARGUMENTS')
    console.log(JSON.stringify(await verifyVendor({archive: args[1]})))
  } catch (error) {
    console.error(JSON.stringify({passed: false, error: error instanceof VendorError ? error.code : 'INPUT_READ_OR_DECOMPRESSION_REFUSED',
      ...(error instanceof VendorError && error.path ? {path: error.path} : {})}))
    process.exitCode = 1
  }
}
