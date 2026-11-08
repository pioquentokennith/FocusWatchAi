import { describe, expect, it } from 'vitest'
import { extractFaceMetrics } from './faceMetrics.js'

function faceResult() {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  points[10] = { x: 0.5, y: 0.15 }
  points[152] = { x: 0.5, y: 0.85 }
  points[234] = { x: 0.2, y: 0.5 }
  points[454] = { x: 0.8, y: 0.5 }
  for (const [indices, center] of [[[33, 160, 158, 133, 153, 144], 0.35], [[362, 385, 387, 263, 373, 380], 0.65]]) {
    const coordinates = [[-0.05, 0], [-0.03, -0.02], [0.03, -0.02], [0.05, 0], [0.03, 0.02], [-0.03, 0.02]]
    indices.forEach((index, position) => { points[index] = { x: center + coordinates[position][0], y: 0.4 + coordinates[position][1] } })
  }
  points[468] = { x: 0.35, y: 0.4 }
  points[473] = { x: 0.65, y: 0.4 }
  return {
    faceLandmarks: [points],
    facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    faceBlendshapes: [{ categories: [{ categoryName: 'eyeBlinkLeft', score: 0.02 }, { categoryName: 'eyeBlinkRight', score: 0.03 }] }],
  }
}

describe('face measurements', () => {
  it('extracts aspect-correct eye openness and neutral head angles', () => {
    const metrics = extractFaceMetrics(faceResult(), 640, 480)
    expect(metrics.kind).toBe('FACE')
    expect(metrics.leftEye).toBeCloseTo(0.3)
    expect(metrics.rightEye).toBeCloseTo(0.3)
    expect(metrics.yaw).toBeCloseTo(0)
    expect(metrics.pitch).toBeCloseTo(0)
    expect(metrics.gazeValid).toBe(true)
    expect(metrics.leftGazeX).toBeCloseTo(0.5)
    expect(metrics.rightGazeY).toBeCloseTo(0.5)
  })

  it('distinguishes a missing face from an incomplete or cropped face', () => {
    expect(extractFaceMetrics({ faceLandmarks: [] }, 640, 480).kind).toBe('NO_FACE')
    const cropped = faceResult()
    cropped.faceLandmarks[0][10].y = -0.1
    expect(extractFaceMetrics(cropped, 640, 480).kind).toBe('UNKNOWN')
    expect(extractFaceMetrics({ faceLandmarks: [[{ x: 0.5, y: 0.5 }]] }, 640, 480).kind).toBe('UNKNOWN')
  })

  it('reads yaw from the column-major head transform', () => {
    const result = faceResult()
    const angle = 30 * Math.PI / 180
    result.facialTransformationMatrixes[0].data = [Math.cos(angle), 0, -Math.sin(angle), 0, 0, 1, 0, 0, Math.sin(angle), 0, Math.cos(angle), 0, 0, 0, 0, 1]
    expect(extractFaceMetrics(result, 640, 480).yaw).toBeCloseTo(30)
  })

  it('measures iris motion independently of head orientation', () => {
    const result = faceResult()
    result.faceLandmarks[0][468].x += 0.02
    result.faceLandmarks[0][473].x += 0.02
    const metrics = extractFaceMetrics(result, 640, 480)
    expect(metrics.leftGazeX).toBeCloseTo(0.7)
    expect(metrics.rightGazeX).toBeCloseTo(0.7)
    expect(metrics.yaw).toBeCloseTo(0)
  })

  it('keeps iris measurements stable when the whole face rolls', () => {
    const result = faceResult()
    const angle = 0.15
    result.faceLandmarks[0] = result.faceLandmarks[0].map((point) => {
      const x = (point.x - 0.5) * 640
      const y = (point.y - 0.5) * 480
      return { x: 0.5 + (x * Math.cos(angle) - y * Math.sin(angle)) / 640, y: 0.5 + (x * Math.sin(angle) + y * Math.cos(angle)) / 480 }
    })
    const metrics = extractFaceMetrics(result, 640, 480)
    expect(metrics.leftGazeX).toBeCloseTo(0.5)
    expect(metrics.rightGazeY).toBeCloseTo(0.5)
  })

  it('marks missing iris landmarks unreliable rather than assuming screen gaze', () => {
    const result = faceResult()
    result.faceLandmarks[0] = result.faceLandmarks[0].slice(0, 468)
    const metrics = extractFaceMetrics(result, 640, 480)
    expect(metrics.kind).toBe('FACE')
    expect(metrics.gazeValid).toBe(false)
  })
})
