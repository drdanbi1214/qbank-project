export type LectureClipboardPage = {
  lectureId: string
  page: number
  title: string
  professor: string | null
}

const HTML_ATTRIBUTE = 'data-qbank-lecture-page'
const TEXT_PREFIX = 'QBANK_LECTURE_PAGE:'

function encodedPayload(payload: LectureClipboardPage): string {
  return encodeURIComponent(JSON.stringify(payload))
}

function decodedPayload(raw: string | null): LectureClipboardPage | null {
  if (!raw) return null
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<LectureClipboardPage>
    if (
      typeof value.lectureId !== 'string' ||
      typeof value.page !== 'number' ||
      !Number.isInteger(value.page) ||
      value.page < 1 ||
      typeof value.title !== 'string' ||
      (value.professor !== null && typeof value.professor !== 'string')
    ) {
      return null
    }
    return {
      lectureId: value.lectureId,
      page: value.page,
      title: value.title,
      professor: value.professor ?? null,
    }
  } catch {
    return null
  }
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('강의록 이미지를 복사하지 못했습니다.'))
    reader.onerror = () => reject(new Error('강의록 이미지를 복사하지 못했습니다.'))
    reader.readAsDataURL(blob)
  })
}

function clipboardHtml(payload: LectureClipboardPage, imageDataUrl: string): string {
  return `<figure ${HTML_ATTRIBUTE}="${encodedPayload(payload)}"><img src="${imageDataUrl}" alt=""></figure>`
}

/**
 * PDF 쪽 이미지와 강의록 정보를 함께 복사한다.
 *
 * ClipboardItem 안에 Promise를 바로 넘기면 클릭 직후 쓰기 권한을 먼저 확보한 뒤
 * 고해상도 쪽 렌더링을 기다릴 수 있다. HTML에도 data URL을 담아 이미지 MIME을
 * 별도로 주지 않는 브라우저에서 붙여넣을 수 있게 한다.
 */
export async function writeLecturePageClipboard(
  payload: LectureClipboardPage,
  imagePromise: Promise<Blob>,
): Promise<void> {
  const htmlPromise = imagePromise.then(blobAsDataUrl).then(
    (dataUrl) => new Blob([clipboardHtml(payload, dataUrl)], { type: 'text/html' }),
  )
  const textBlob = new Blob(
    [`${TEXT_PREFIX}${encodedPayload(payload)}\n[강의록] ${payload.title} · ${payload.page}쪽`],
    { type: 'text/plain' },
  )

  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('이 브라우저에서는 강의록 페이지 복사를 지원하지 않습니다.')
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': htmlPromise,
      'text/plain': textBlob,
      'image/png': imagePromise,
    }),
  ])
}

/** 일반 붙여넣기와 구분하기 위해 우리 HTML/텍스트 표식을 가진 경우만 읽는다. */
export function readLecturePageClipboard(data: DataTransfer | null): LectureClipboardPage | null {
  if (!data) return null

  const html = data.getData('text/html')
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const marker = document.querySelector<HTMLElement>(`[${HTML_ATTRIBUTE}]`)
    const payload = decodedPayload(marker?.getAttribute(HTML_ATTRIBUTE) ?? null)
    if (payload) return payload
  }

  const text = data.getData('text/plain')
  if (!text.startsWith(TEXT_PREFIX)) return null
  return decodedPayload(text.slice(TEXT_PREFIX.length).split(/\r?\n/, 1)[0])
}
