import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOrchardClient, narrate, runFetchTrip } from '@orchard/domain'

// Nitro is a build-and-deploy layer, so this client drives the *built* server
// over real HTTP — the most faithful way to exercise its file-based routing.
const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../../../../backends/nitro/h3')
const serverEntry = resolve(backendDir, '.output/server/index.mjs')
const port = 3974
const baseUrl = `http://localhost:${port}`

if (!existsSync(serverEntry)) {
  narrate.info('No build found — running `nitro build` (one-time)…')
  const build = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: backendDir,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if (build.exitCode !== 0)
    throw new Error('nitro build failed')
}

narrate.info(`Spawning Nitro server on ${baseUrl}…`)
const server = Bun.spawn(['node', serverEntry], {
  cwd: backendDir,
  env: { ...process.env, PORT: String(port) },
  stdout: 'ignore',
  stderr: 'ignore',
})

async function waitForReady(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok)
        return
    }
    catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('Nitro server did not become ready in time')
}

try {
  await waitForReady()
  await runFetchTrip(
    'Nitro (h3 file-routing) · typed-fetch shopping trip',
    createOrchardClient({ baseUrl }),
    createOrchardClient({ baseUrl, key: 'wrong-key' }),
  )
}
finally {
  server.kill()
}

process.exit(0)
