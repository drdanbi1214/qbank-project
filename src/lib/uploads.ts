import { uploadStoredObject } from '@/lib/storage'

/**
 * 본문 이미지 업로드.
 *
 * 버킷이 비공개라 저장하는 값은 URL 이 아니라 `<bucket>/<path>` 형태의 경로다.
 * 서명 URL 은 만료되므로 본문에 박아두면 며칠 뒤에 깨진다. 표시 시점에
 * getSignedUrl 로 매번 발급한다.
 */
const BUCKET = 'solution-images'
const MAX_BYTES = 10 * 1024 * 1024
/** 압축 전 원본 상한. 이보다 크면 디코딩에서 브라우저가 버벅인다. */
const INPUT_MAX_BYTES = 40 * 1024 * 1024
const ALLOWED = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif'])

/**
 * WebP 재인코딩 품질.
 *
 * 실제 저장된 시험지 스캔·방사선 영상으로 측정했을 때 0.95 는 SSIM 0.995 이상을
 * 유지하면서 PNG 대비 84% 가 줄었다. 값을 더 낮추면 CT 입자 질감이 눈에 띄게
 * 뭉개지므로 내리지 말 것.
 */
const WEBP_QUALITY = 0.95

export function isUploadableImage(file: File): boolean {
  return ALLOWED.has(file.type)
}

function extensionOf(file: File): string {
  const fromType = file.type.split('/')[1]
  if (fromType) return fromType === 'jpeg' ? 'jpg' : fromType
  const fromName = file.name.split('.').pop()
  return fromName ? fromName.toLowerCase() : 'png'
}

/**
 * 업로드 전에 WebP 로 다시 인코딩한다.
 *
 * 압축하지 않으면 캡처 도구가 뱉는 PNG 원본이 그대로 쌓여 스토리지 한도를
 * 금방 채운다. 되돌릴 수 없는 변환이라 아래 경우에는 원본을 그대로 올린다.
 *  - GIF: 재인코딩하면 애니메이션이 첫 프레임만 남는다
 *  - 브라우저가 WebP 인코딩을 지원하지 않는 경우 (toBlob 이 다른 형식을 준다)
 *  - 압축 결과가 원본보다 큰 경우 (이미 잘 압축된 이미지)
 */
async function toWebp(file: File): Promise<{ blob: Blob; extension: string; type: string }> {
  const original = { blob: file, extension: extensionOf(file), type: file.type }
  if (file.type === 'image/gif') return original

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return original
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return original
    context.drawImage(bitmap, 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY)
    })
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return original

    return { blob, extension: 'webp', type: 'image/webp' }
  } finally {
    bitmap.close()
  }
}

/**
 * 이미지 버킷 업로드의 공통 경로.
 *
 * 버킷마다 함수가 따로 있어도 검증·압축·경로 규칙은 같아야 한다. 여기 하나로
 * 모아 두어야 새 버킷이 생겨도 압축이 빠지지 않는다.
 */
async function uploadImageTo(
  bucket: string,
  file: File,
  userId: string,
  limitBytes = MAX_BYTES,
  limitLabel = '이미지 크기는 10MB 까지 가능합니다.',
): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('PNG, JPG, GIF, WebP 이미지만 올릴 수 있습니다.')
  }
  if (file.size > INPUT_MAX_BYTES) {
    throw new Error('이미지 원본은 40MB 까지 열 수 있습니다.')
  }

  const { blob, extension, type } = await toWebp(file)
  // 상한은 실제로 저장되는 크기에 건다. 원본이 커도 압축 후 작아지면 통과시킨다.
  if (blob.size > limitBytes) throw new Error(limitLabel)

  const path = `${userId}/${crypto.randomUUID()}.${extension}`
  await uploadStoredObject(bucket, path, blob, type)

  return `${bucket}/${path}`
}

export async function uploadImage(file: File, userId: string): Promise<string> {
  return uploadImageTo(BUCKET, file, userId)
}

// 풀이에서 강의록 파일을 올리던 함수는 없앴다. 이제 강의록은 관리자가 라이브러리에
// 등록하고 풀이는 그 문서를 가리키기만 한다. 이미 올라간 solution-lecture-files
// 객체 21개는 기존 풀이 660건이 계속 참조하므로 읽기는 그대로 열어 둔다.

/**
 * 프로필 사진 업로드.
 * 경로 앞자리가 본인 id 여야 Storage 정책을 통과한다.
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  return uploadImageTo(
    'avatars',
    file,
    userId,
    5 * 1024 * 1024,
    '프로필 사진은 5MB 까지 가능합니다.',
  )
}

/**
 * 문제 본문 이미지 업로드 (관리자 편집 화면).
 * 풀이 이미지와 버킷을 나눠 두어야 나중에 정리하거나 옮기기 쉽다.
 */
export async function uploadQuestionImage(file: File, userId: string): Promise<string> {
  return uploadImageTo('question-images', file, userId)
}

/**
 * 테마 본문의 이미지 업로드.
 *
 * theory-images 는 업로드가 관리자 전용이고 solution-images 는 읽기가 풀이에
 * 묶여 있어 둘 다 쓸 수 없다. 그래서 topic-images 를 따로 둔다.
 */
export async function uploadTopicImage(file: File, userId: string): Promise<string> {
  return uploadImageTo('topic-images', file, userId)
}

/** 관리자 이론 편집기의 이미지 업로드. */
export async function uploadTheoryImage(file: File, userId: string): Promise<string> {
  return uploadImageTo('theory-images', file, userId)
}

/** 붙여넣기, 드롭 이벤트에서 이미지 파일만 골라낸다. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.files).filter(isUploadableImage)
  if (files.length > 0) return files

  // 일부 브라우저는 붙여넣기 이미지가 files가 아니라 items에만 들어온다.
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && ALLOWED.has(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/** 클립보드가 실제 파일 대신 HTML의 img 태그로 이미지를 전달하는 경우까지 감지한다. */
export function clipboardHasImage(data: DataTransfer | null): boolean {
  if (!data) return false
  if (imageFilesFrom(data).length > 0) return true
  if (Array.from(data.items).some((item) => item.type.startsWith('image/'))) return true
  return /<img\b/i.test(data.getData('text/html'))
}

/** 붙여넣기 이미지를 업로드 가능한 File 배열로 정규화한다. */
export async function imageFilesFromClipboard(data: DataTransfer | null): Promise<File[]> {
  if (!data) return []
  const direct = imageFilesFrom(data)
  if (direct.length > 0) return direct

  return imageFilesFromHtml(data.getData('text/html'))
}

/**
 * 클립보드 HTML 의 img 태그를 실제 파일로 바꾼다.
 *
 * DataTransfer 는 이벤트 핸들러가 끝나면 못 읽으므로, 호출하는 쪽에서 HTML 을
 * 먼저 동기적으로 꺼내 넘긴다.
 */
export async function imageFilesFromHtml(html: string): Promise<File[]> {
  if (!html) return []

  const document = new DOMParser().parseFromString(html, 'text/html')
  const sources = Array.from(new Set(Array.from(document.images, (image) => image.src))).filter(
    Boolean,
  )
  const converted = await Promise.allSettled(
    sources.map(async (source, index) => {
      const response = await fetch(source)
      if (!response.ok) throw new Error('클립보드 이미지를 읽지 못했습니다.')
      const blob = await response.blob()
      if (!ALLOWED.has(blob.type)) throw new Error('지원하지 않는 이미지 형식입니다.')
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1]
      return new File([blob], `pasted-image-${index + 1}.${extension}`, { type: blob.type })
    }),
  )

  return converted.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}
