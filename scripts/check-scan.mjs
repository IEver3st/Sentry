import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Node runs the bundled worker, matching Electron's worker_threads implementation.
// An optional original worker path supplies a comparison without changing that build.
const current = resolve('out/main/scan-worker.js')
const baseline = process.argv[2] && resolve(process.argv[2])
const root = await mkdtemp(join(tmpdir(), 'sentry-scan-check-'))
const results = []

async function repeatedScans(path, label) {
  const workers = []
  let exited = 0
  const started = performance.now()
  try {
    for (let i = 0; i < 4; i++) {
      const worker = new Worker(path, { workerData: { root }, execArgv: [] })
      workers.push(worker)
      worker.once('exit', () => exited++)
      await new Promise((accept, reject) => {
        const timeout = setTimeout(() => reject(new Error('Scan timed out')), 10_000)
        worker.once('error', reject)
        worker.on('message', (message) => {
          if (message.type === 'error') reject(new Error(message.message))
          if (message.type !== 'done') return
          clearTimeout(timeout)
          try {
            assert.equal(message.root.files, 400)
            assert.equal(message.root.size, 400 * Buffer.byteLength('scan fixture'))
            accept()
          } catch (error) { reject(error) }
        })
      })
    }
    const scanMs = Math.round(performance.now() - started)
    await delay(600)
    const result = { label, scans: workers.length, filesPerScan: 400, naturalWorkerExits: exited, workersStillAlive: workers.length - exited, scanMs }
    results.push(result)
    if (label === 'current') assert.equal(result.workersStillAlive, 0, 'Completed workers must exit naturally')
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
}

async function checkWorker(mode) {
  const worker = new Worker(current, { workerData: { root, progressEnabled: false }, execArgv: [] })
  const messages = []
  try {
    await new Promise((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${mode} worker did not exit`)), 10_000)
      worker.on('message', (message) => messages.push(message))
      worker.once('error', reject)
      worker.once('exit', (code) => {
        clearTimeout(timeout)
        try { assert.equal(code, 0); accept() } catch (error) { reject(error) }
      })
      if (mode === 'cancelled') worker.postMessage({ type: 'cancel' })
    })
    assert.equal(messages.filter((message) => message.type === 'progress').length, 0)
    assert.equal(messages.at(-1)?.type, mode === 'cancelled' ? 'cancelled' : 'done')
    if (mode !== 'cancelled') assert.equal(messages.at(-1).root.files, 400)
  } finally { await worker.terminate() }
}

try {
  for (let d = 0; d < 4; d++) {
    const folder = join(root, `folder-${d}`)
    await mkdir(folder)
    for (let i = 0; i < 100; i += 25) {
      await Promise.all(Array.from({ length: 25 }, (_, n) => writeFile(join(folder, `${i + n}.txt`), 'scan fixture')))
    }
  }
  if (baseline) await repeatedScans(baseline, 'baseline')
  await repeatedScans(current, 'current')
  await checkWorker('hidden')
  await checkWorker('cancelled')
  console.log(JSON.stringify({ repeatedScans: results, hiddenScan: 'passed without progress events', cancelledScan: 'passed with natural worker exit' }, null, 2))
} finally { await rm(root, { recursive: true, force: true }) }
