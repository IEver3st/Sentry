import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const verifier = fileURLToPath(new URL('../scripts/verify-release.mjs', import.meta.url))

for (const version of ['0.1.0', '0.2.0-beta.1']) {
  test(`release assets validate the ${version} feed and reject altered installers`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sentry-release-test-'))
    try {
      const dist = join(dir, 'dist')
      const resources = join(dist, 'win-unpacked', 'resources')
      await mkdir(resources, { recursive: true })
      const feed = { provider: 'github', owner: 'Example', repo: 'sentry-drive', private: false }
      const installer = `Sentry-Setup-${version}-x64.exe`
      const bytes = Buffer.from('test installer bytes')
      const sha512 = createHash('sha512').update(bytes).digest('base64')
      const manifestName = version.includes('-beta.') ? 'beta.yml' : 'latest.yml'
      // JSON is valid YAML and avoids adding a production dependency for fixtures.
      await writeFile(join(dir, 'package.json'), JSON.stringify({ version }))
      await writeFile(join(dist, 'release-builder.json'), JSON.stringify({ publish: feed }))
      await writeFile(join(resources, 'app-update.yml'), JSON.stringify(feed))
      await writeFile(join(dist, manifestName), JSON.stringify({ version, files: [{ url: installer, size: bytes.length, sha512 }], path: installer, sha512 }))
      await writeFile(join(dist, installer), bytes)
      await writeFile(join(dist, `${installer}.blockmap`), 'test blockmap')
      const run = () => spawnSync(process.execPath, [verifier], { cwd: dir, encoding: 'utf8' })
      const valid = run()
      assert.equal(valid.status, 0, valid.stderr)
      assert.deepEqual((await readdir(join(dist, 'release-assets'))).sort(), [installer, `${installer}.blockmap`, manifestName, 'SHA256SUMS.txt'].sort())
      const digest = createHash('sha256').update(bytes).digest('hex')
      assert.ok((await readFile(join(dist, 'release-assets', 'SHA256SUMS.txt'), 'utf8')).includes(`${digest}  ${installer}`))
      await writeFile(join(dist, installer), 'altered installer')
      assert.notEqual(run().status, 0)
      await writeFile(join(dist, installer), bytes)
      await writeFile(join(resources, 'app-update.yml'), JSON.stringify({ ...feed, repo: 'old-backup-app' }))
      assert.notEqual(run().status, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
