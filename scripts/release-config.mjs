import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function releaseConfig({ repository, approvedRepository, tag, version }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('GITHUB_REPOSITORY must identify the approved public source/release repository.')
  }
  if (repository.toLowerCase() !== approvedRepository?.toLowerCase()) {
    throw new Error('Set the SENTRY_RELEASE_REPOSITORY repository variable after confirming this app owns that update feed.')
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta\.(0|[1-9]\d*))?$/.test(version) || tag !== `v${version}`) {
    throw new Error('Release tag must match package.json: vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.N.')
  }
  const [owner, repo] = repository.split('/')
  return {
    extends: 'electron-builder.yml',
    artifactName: 'Sentry-Setup-${version}-${arch}.${ext}',
    publish: { provider: 'github', owner, repo, private: false, releaseType: 'draft' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'))
  const config = releaseConfig({
    repository: process.env.GITHUB_REPOSITORY,
    approvedRepository: process.env.SENTRY_RELEASE_REPOSITORY,
    tag: process.env.GITHUB_REF_NAME,
    version
  })
  await mkdir('dist', { recursive: true })
  await writeFile('dist/release-builder.json', JSON.stringify(config, null, 2) + '\n')
  console.log(`Release configuration ready for ${config.publish.owner}/${config.publish.repo} v${version}.`)
}
