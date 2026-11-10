import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
if (process.platform !== 'win32') throw new Error('Build this Windows demo package on Windows.')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const runtime = path.dirname(createRequire(import.meta.url)('electron'))
const output = path.join(root, 'release', `FocusWatchAI-win32-${process.arch}`)
const marker = path.join(output, 'focuswatch-package.json')
if (await stat(output).catch(() => null)) {
  const previous = await readFile(marker, 'utf8').then(JSON.parse).catch(() => null)
  if (previous?.generatedBy !== packageJson.name) throw new Error(`Refusing to replace an unrecognized folder: ${output}`)
  await rm(output, { recursive: true })
}
await mkdir(output, { recursive: true })
await writeFile(marker, JSON.stringify({ generatedBy: packageJson.name, version: packageJson.version }, null, 2))
// The demo only needs Electron and the prebuilt static bundle. No Node runtime
// dependencies, development server, database, or installer are needed to run it.
await cp(runtime, output, { recursive: true })
await rename(path.join(output, 'electron.exe'), path.join(output, 'FocusWatchAI.exe'))
const application = path.join(output, 'resources/app')
await mkdir(application, { recursive: true })
await cp(path.join(root, 'dist'), path.join(application, 'dist'), { recursive: true })
await cp(path.join(root, 'electron'), path.join(application, 'electron'), { recursive: true })
await writeFile(path.join(application, 'package.json'), JSON.stringify({
  name: packageJson.name, productName: 'FocusWatchAI', version: packageJson.version, main: 'electron/main.cjs',
}, null, 2))
await writeFile(path.join(output, 'START-HERE.txt'), 'Run FocusWatchAI.exe. Keep this entire folder together. Choose your timings in Alert settings, then start your camera. Alt+Tab or minimize to continue monitoring. Pause records a break with camera and alarm off; Resume calibrates again. Stop finishes the session. Open My insights for daily reports and CSV exports.\r\n')
console.log(`Desktop app ready: ${path.join(output, 'FocusWatchAI.exe')}`)
