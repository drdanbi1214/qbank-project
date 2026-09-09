import { isPageShape, isPageText, TOOL_OPACITY, type Stroke } from '@/components/lecture/pageMarks'
import type { LecturePdfAnnotations } from '@/lib/queries/lectureAnnotations'

type Progress = { completed: number; total: number }

/** 원본 PDF 위에 현재 계정의 필기 획을 벡터로 덧입힌 새 PDF를 만든다. */
export async function exportAnnotatedLecturePdf(params: {
  bytes: ArrayBuffer
  annotations: LecturePdfAnnotations
  onProgress?: (progress: Progress) => void
}): Promise<Blob> {
  // 평소 열람 번들에 큰 PDF 편집기를 싣지 않고 내보낼 때만 받는다.
  const { LineCapStyle, PDFDocument, rgb } = await import('pdf-lib')
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

    for (const mark of marks) {
      if (isPageText(mark) || isPageShape(mark)) continue
      const color = parseHexColor(mark.color)
      const pdfColor = rgb(color[0], color[1], color[2])
      const opacity = TOOL_OPACITY[mark.tool]
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

function strokeThickness(mark: Stroke, pointIndex: number, displayWidth: number): number {
  const pressure = mark.pressures?.[pointIndex]
  const pressureStrength = mark.tool === 'pencil' ? 0.34 : 0.45
  const factor = mark.tool !== 'highlight' && pressure !== undefined
    ? 1 + pressureStrength * (pressure * 2 - 1)
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
