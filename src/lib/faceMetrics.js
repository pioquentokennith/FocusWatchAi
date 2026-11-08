const RIGHT_EYE = [33, 160, 158, 133, 153, 144]
const LEFT_EYE = [362, 385, 387, 263, 373, 380]
export const GAZE_KEYS = ['leftGazeX', 'leftGazeY', 'rightGazeX', 'rightGazeY']

// Measure iris position in each eye's local coordinates, independent of the
// preview's mirror setting. Using the corner axis also compensates for head roll.
function irisPosition(points, eye, irisIndex, width, height) {
  const iris = points[irisIndex]
  if (!iris) return null
  const [a, b, c, d, e, f] = eye.map((index) => points[index])
  const dx = (d.x - a.x) * width
  const dy = (d.y - a.y) * height
  const span = Math.hypot(dx, dy)
  if (span < 12) return null
  const project = (point) => {
    const x = (point.x - a.x) * width
    const y = (point.y - a.y) * height
    return { x: (x * dx + y * dy) / (span * span), y: (-x * dy + y * dx) / span }
  }
  const upper = (project(b).y + project(c).y) / 2
  const lower = (project(e).y + project(f).y) / 2
  const opening = lower - upper
  if (opening < 3) return null
  const center = project(iris)
  const x = center.x
  const y = (center.y - upper) / opening
  if (![x, y].every(Number.isFinite) || x < -0.05 || x > 1.05 || y < -0.3 || y > 1.3) return null
  return { x, y }
}

function eyeAspectRatio(points, indices, width, height) {
  const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
  const [a, b, c, d, e, f] = indices.map((index) => points[index])
  const horizontal = distance(a, d)
  return horizontal > 1 ? (distance(b, f) + distance(c, e)) / (2 * horizontal) : NaN
}

export function extractFaceMetrics(result, width, height) {
  const points = result.faceLandmarks?.[0]
  if (!points?.length) return { kind: 'NO_FACE' }
  if (points.length < 468 || !width || !height || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { kind: 'UNKNOWN' }
  }
  const left = Math.min(...points.map((point) => point.x))
  const right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const bottom = Math.max(...points.map((point) => point.y))
  if (right - left < 0.12 || bottom - top < 0.18 || left < 0.01 || right > 0.99 || top < 0.01 || bottom > 0.99) {
    return { kind: 'UNKNOWN' }
  }
  const matrix = result.facialTransformationMatrixes?.[0]?.data
  if (!matrix || matrix.length !== 16 || Array.from(matrix).some((value) => !Number.isFinite(value))) return { kind: 'UNKNOWN' }

  // MediaPipe's transform is column-major. Only deviation from a neutral pose is used.
  const yaw = Math.atan2(-matrix[2], Math.hypot(matrix[0], matrix[1])) * 180 / Math.PI
  const pitch = Math.atan2(matrix[6], matrix[10]) * 180 / Math.PI
  const rightEye = eyeAspectRatio(points, RIGHT_EYE, width, height)
  const leftEye = eyeAspectRatio(points, LEFT_EYE, width, height)
  const scores = Object.fromEntries((result.faceBlendshapes?.[0]?.categories || []).map((entry) => [entry.categoryName, entry.score]))
  if (![leftEye, rightEye, yaw, pitch].every(Number.isFinite) || leftEye > 0.8 || rightEye > 0.8) return { kind: 'UNKNOWN' }
  const leftGaze = irisPosition(points, LEFT_EYE, 473, width, height)
  const rightGaze = irisPosition(points, RIGHT_EYE, 468, width, height)
  return {
    kind: 'FACE', leftEye, rightEye, yaw, pitch,
    gazeValid: Boolean(leftGaze && rightGaze),
    leftGazeX: leftGaze?.x ?? null, leftGazeY: leftGaze?.y ?? null,
    rightGazeX: rightGaze?.x ?? null, rightGazeY: rightGaze?.y ?? null,
    blink: Math.max(scores.eyeBlinkLeft ?? 1, scores.eyeBlinkRight ?? 1),
  }
}
