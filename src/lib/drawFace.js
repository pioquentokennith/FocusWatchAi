export function clearOverlay(canvas) {
  canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
}

export function drawFace(canvas, video, points, connections, state) {
  if (!canvas) return
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!points?.length) return
  const trace = (edges, color, width) => {
    context.beginPath()
    context.strokeStyle = color
    context.lineWidth = width
    for (const edge of edges) {
      const a = points[edge.start]
      const b = points[edge.end]
      if (!a || !b) continue
      context.moveTo(a.x * canvas.width, a.y * canvas.height)
      context.lineTo(b.x * canvas.width, b.y * canvas.height)
    }
    context.stroke()
  }
  trace(connections.FACE_LANDMARKS_TESSELATION, 'rgba(200,240,120,0.16)', 0.6)
  trace(connections.FACE_LANDMARKS_FACE_OVAL, '#c8f078', 1.3)
  trace(connections.FACE_LANDMARKS_LEFT_EYE, state === 'EYES_CLOSED' ? '#ffad74' : '#69eadc', 2)
  trace(connections.FACE_LANDMARKS_RIGHT_EYE, state === 'EYES_CLOSED' ? '#ffad74' : '#69eadc', 2)
  trace(connections.FACE_LANDMARKS_LEFT_IRIS, '#e8ffc4', 1)
  trace(connections.FACE_LANDMARKS_RIGHT_IRIS, '#e8ffc4', 1)
}
