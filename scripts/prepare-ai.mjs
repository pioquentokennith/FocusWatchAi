import { mkdir, readdir, copyFile, stat, writeFile, rename, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const wasmSource = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmTarget = path.join(root, 'public/wasm')
const modelDirectory = path.join(root, 'public/models')
const modelPath = path.join(modelDirectory, 'face_landmarker.task')
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

await mkdir(wasmTarget, { recursive: true })
await mkdir(modelDirectory, { recursive: true })
for (const name of await readdir(wasmSource)) {
  if (name.endsWith('.js') || name.endsWith('.wasm')) {
    await copyFile(path.join(wasmSource, name), path.join(wasmTarget, name))
  }
}

const existing = await stat(modelPath).catch(() => null)
if (!existing || existing.size < 1_000_000) {
  console.log('Downloading the Face Landmarker model (one-time setup)…')
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 1_000_000) throw new Error('Model download is incomplete. Run npm run prepare:ai again.')
  const temporary = `${modelPath}.download`
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, modelPath)
  } finally {
    await rm(temporary, { force: true })
  }
}
console.log('AI model and version-matched WASM assets are ready to serve locally.')
