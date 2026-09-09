import {
  isPageShape,
  isPageText,
  NOMINAL_PT_WIDTH,
  TOOL_OPACITY,
  type PageShape,
  type PageText,
  type Stroke,
} from '@/components/lecture/pageMarks'
import type { LecturePdfAnnotations } from '@/lib/queries/lectureAnnotations'

type Progress = { completed: number; total: number }

/** 원본 PDF 위에 현재 계정의 필기 획·도형·글자를 덧입힌 새 PDF를 만든다. */
export async function exportAnnotatedLecturePdf(params: {
  bytes: ArrayBuffer
  annotations: LecturePdfAnnotations
  onProgress?: (progress: Progress) => void
}): Promise<Blob> {
  // 평소 열람 번들에 큰 PDF 편집기를 싣지 않고 내보낼 때만 받는다.
  const { degrees, LineCapStyle, PDFDocument, rgb } = await import('pdf-lib')
  const document = await PDFDocument.load(params.bytes, { updateMetadata: false })
  const pages = document.getPages()
  const annotatedPages = Object.entries(params.annotations).filter(([, marks]) => marks.length > 0)
  let completed = 0

  for (const [pageKey, marks] of annotatedPages) {
    const pageNumber = Number(pageKey)
    const page = pages[pageNumber - 1]
    if (!page) continue
    const width = page.getWidth()
    const height = page.getHeight()
    const rotation = ((page.getRotation().angle % 360) + 360) % 360
    const displayWidth = rotation === 90 || rotation === 270 ? height : width
    const displayHeight = rotation === 90 || rotation === 270 ? width : height

    for (const mark of marks) {
      if (isPageText(mark)) {
        const rendered = await renderTextMark(mark, displayWidth)
        const image = await document.embedPng(rendered.bytes)
        const left = mark.points[0] * displayWidth - rendered.paddingX
        const top = mark.points[1] * displayHeight - rendered.paddingY
        const anchor = toPdfPoint(
          left / displayWidth,
          (top + rendered.height) / displayHeight,
          width,
          height,
          rotation,
        )
        page.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: rendered.width,
          height: rendered.height,
          rotate: degrees(rotation),
        })
        continue
      }
      const color = parseHexColor(mark.color)
      const pdfColor = rgb(color[0], color[1], color[2])
      const opacity = TOOL_OPACITY[mark.tool]

      if (isPageShape(mark)) {
        const shapePoints = pointsForShape(mark)
        for (let index = 1; index < shapePoints.length; index += 1) {
          page.drawLine({
            start: toPdfPoint(shapePoints[index - 1][0], shapePoints[index - 1][1], width, height, rotation),
            end: toPdfPoint(shapePoints[index][0], shapePoints[index][1], width, height, rotation),
            thickness: Math.max(mark.width * displayWidth, 0.25),
            color: pdfColor,
            opacity,
            lineCap: LineCapStyle.Round,
          })
        }
        continue
      }
      const pointCount = mark.points.length / 2

      if (pointCount === 1) {
        const at = toPdfPoint(mark.points[0], mark.points[1], width, height, rotation)
        page.drawCircle({
          x: at.x,
          y: at.y,
          size: strokeThickness(mark, 0, displayWidth) / 2,
          color: pdfColor,
          opacity,
        })
        continue
      }

      for (let index = 1; index < pointCount; index += 1) {
        const from = toPdfPoint(
          mark.points[(index - 1) * 2],
          mark.points[(index - 1) * 2 + 1],
          width,
          height,
          rotation,
        )
        const to = toPdfPoint(
          mark.points[index * 2],
          mark.points[index * 2 + 1],
          width,
          height,
          rotation,
        )
        page.drawLine({
          start: from,
          end: to,
          thickness:
            (strokeThickness(mark, index - 1, displayWidth) +
              strokeThickness(mark, index, displayWidth)) /
            2,
          color: pdfColor,
          opacity,
          lineCap: LineCapStyle.Round,
        })
      }
    }

    completed += 1
    params.onProgress?.({ completed, total: annotatedPages.length })
    // 긴 강의록에서도 진행 문구와 브라우저 화면이 굳지 않게 한 프레임을 내준다.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  }

  const output = await document.save({ useObjectStreams: true, objectsPerTick: 40 })
  return new Blob([output as BlobPart], { type: 'application/pdf' })
}

function pointsForShape(mark: PageShape): Array<[number, number]> {
  const left = Math.min(mark.points[0], mark.points[2])
  const right = Math.max(mark.points[0], mark.points[2])
  const top = Math.min(mark.points[1], mark.points[3])
  const bottom = Math.max(mark.points[1], mark.points[3])
  if (mark.tool === 'rectangle') {
    return [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]
  }
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const points: Array<[number, number]> = []
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const radius = index % 2 === 0 ? 1 : 0.42
    points.push([
      centerX + Math.cos(angle) * ((right - left) / 2) * radius,
      centerY + Math.sin(angle) * ((bottom - top) / 2) * radius,
    ])
  }
  points.push(points[0])
  return points
}

async function renderTextMark(mark: PageText, displayWidth: number): Promise<{
  bytes: Uint8Array
  width: number
  height: number
  paddingX: number
  paddingY: number
}> {
  await window.document.fonts?.ready
  const size = (mark.size / NOMINAL_PT_WIDTH) * displayWidth
  const paddingX = size * 0.32
  const paddingY = size * 0.18
  const scale = 2
  const measure = window.document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('글자 필기를 PDF로 변환하지 못했습니다.')
  const font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  measure.font = font
  const metrics = measure.measureText(mark.text)
  const textHeight = Math.max(size * 1.2, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent)
  const width = Math.max(1, metrics.width + paddingX * 2)
  const height = Math.max(1, textHeight + paddingY * 2)
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('글자 필기를 PDF로 변환하지 못했습니다.')
  context.scale(scale, scale)
  context.font = font
  context.textBaseline = 'top'
  context.lineJoin = 'round'

  if (mark.background !== 'transparent') {
    context.fillStyle = mark.background
    roundRect(context, 0, 0, width, height, size * 0.2)
    context.fill()
  }
  if (mark.borderColor !== 'transparent') {
    context.strokeStyle = mark.borderColor
    context.lineWidth = Math.max(size * 0.08, 1.5)
    roundRect(context, context.lineWidth / 2, context.lineWidth / 2, width - context.lineWidth, height - context.lineWidth, size * 0.2)
    context.stroke()
  }
  if (mark.background === 'transparent') {
    context.strokeStyle = '#ffffff'
    context.lineWidth = size * 0.16
    context.strokeText(mark.text, paddingX, paddingY)
  }
  context.fillStyle = mark.color
  context.fillText(mark.text, paddingX, paddingY)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('글자 필기를 PDF로 변환하지 못했습니다.')), 'image/png')
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, paddingX, paddingY }
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
}

function strokeThickness(mark: Stroke, pointIndex: number, displayWidth: number): number {
  const pressure = mark.pressures?.[pointIndex]
  const factor = mark.tool !== 'highlight' && pressure !== undefined
    ? 1 + (mark.tool === 'pencil' ? 0.34 : 0.45) * (pressure * 2 - 1)
    : 1
  return Math.max(mark.width * displayWidth * factor, 0.25)
}

function toPdfPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number } {
  if (rotation === 90) return { x: y * width, y: x * height }
  if (rotation === 180) return { x: (1 - x) * width, y: y * height }
  if (rotation === 270) return { x: (1 - y) * width, y: (1 - x) * height }
  return { x: x * width, y: (1 - y) * height }
}

function parseHexColor(value: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(value)
  if (!match) return [0.145, 0.388, 0.922]
  const number = Number.parseInt(match[1], 16)
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255]
}
