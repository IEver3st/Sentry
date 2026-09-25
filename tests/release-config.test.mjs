import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseConfig } from '../scripts/release-config.mjs'

const input = { repository: 'Example/sentry-drive', approvedRepository: 'Example/sentry-drive', tag: 'v0.1.0', version: '0.1.0' }

test('release builds use the explicitly bound repository without shipping credentials', () => {
  assert.deepEqual(releaseConfig(input).publish, {
    provider: 'github', owner: 'Example', repo: 'sentry-drive', private: false, releaseType: 'draft'
  })
})

test('unbound repositories and mismatched versions cannot produce release config', () => {
  for (const patch of [
    { approvedRepository: undefined }, { approvedRepository: 'Example/old-app' },
    { repository: 'https://github.com/Example/sentry-drive' },
    { tag: 'main' }, { tag: 'v0.2.0' }, { version: '01.1.0', tag: 'v01.1.0' }
  ]) assert.throws(() => releaseConfig({ ...input, ...patch }))
})

test('beta releases require a matching beta tag', () => {
  assert.doesNotThrow(() => releaseConfig({ ...input, tag: 'v0.2.0-beta.1', version: '0.2.0-beta.1' }))
  assert.throws(() => releaseConfig({ ...input, tag: 'v0.2.0-alpha.1', version: '0.2.0-alpha.1' }))
})
