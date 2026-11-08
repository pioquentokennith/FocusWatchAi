import { createRequire } from 'node:module'
import { stat } from 'node:fs/promises'

// Electron downloads its runtime lazily. Prepare it outside timed test cases.
const executable = createRequire(import.meta.url)('electron')
await stat(executable)
console.log(`Electron runtime ready: ${executable}`)
