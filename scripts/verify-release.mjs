import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'

// js-yaml is part of the locked electron-builder dependency tree.
const require = createRequire(import.meta.url)
const { load } = require('js-yaml')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const config = JSON.parse(await readFile('dist/release-builder.json', 'utf8'))
const feed = load(await readFile('dist/win-unpacked/resources/app-update.yml', 'utf8'))
assert.equal(feed.provider, 'github')
assert.equal(feed.owner, config.publish.owner)
assert.equal(feed.repo, config.publish.repo)
assert.ok(!feed.private && !feed.token && !feed.requestHeaders, 'Packaged feed must be public and credential-free')
const manifestName = version.includes('-beta.') ? 'beta.yml' : 'latest.yml'
const manifest = load(await readFile(join('dist', manifestName), 'utf8'))
assert.equal(manifest.version, version)
assert.equal(manifest.files?.length, 1, 'Expected one Windows x64 installer')
const file = manifest.files[0]
const installer = decodeURIComponent(file.url)
assert.equal(basename(installer), installer, 'Installer must be a plain asset filename')
assert.ok(!installer.includes('\\') && installer.endsWith('.exe'))
const bytes = await readFile(join('dist', installer))
assert.equal(createHash('sha512').update(bytes).digest('base64'), file.sha512, 'Installer SHA-512 does not match feed')
assert.equal(bytes.length, file.size)
assert.equal(manifest.sha512, file.sha512)
assert.equal(decodeURIComponent(manifest.path), installer)
const assets = [installer, `${installer}.blockmap`, manifestName]
const output = 'dist/release-assets'
await mkdir(output, { recursive: true })
const checksums = []
for (const name of assets) {
  const content = await readFile(join('dist', name))
  assert.ok(content.length > 0, `${name} must not be empty`)
  checksums.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`)
  await copyFile(join('dist', name), join(output, name))
}
await writeFile(join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
console.log(`Verified v${version}: packaged public feed, installer digest, blockmap, and ${manifestName}.`)
