import type { PDFDocumentProxy } from 'pdfjs-dist'

/** 글에 박을 이미지의 가로 크기와 화질. 장당 200~400KB 쯤 나온다. */
const EMBED_WIDTH = 1600
const EMBED_QUALITY = 0.85

/**
 * 강의록 한 쪽을 글에 넣을 이미지로 굽는다.
 *
 * 화면에 그린 캔버스를 그대로 쓰지 않는 이유는 그것이 창 폭에 맞춰 그려져서다.
 * 좁은 화면에서 고르면 흐린 이미지가 박힌다. 화면 크기와 무관하게 같은 결과가
 * 나오도록 고정 폭으로 다시 그린다.
 */
export async function renderLecturePageToBlob(
  document: PDFDocumentProxy,
  pageNumber: number,
  imageType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<Blob> {
  const page = await document.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: EMBED_WIDTH / base.width })

  const canvas = window.document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('이미지를 만들지 못했습니다.')

  // PDF 가 배경을 스스로 칠하지 않는 쪽이 있어 흰 종이를 먼저 깐다.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, canvasContext: context, viewport }).promise

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했습니다.'))),
      imageType,
      imageType === 'image/jpeg' ? EMBED_QUALITY : undefined,
    )
  })
}
