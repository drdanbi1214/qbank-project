import { supabase } from '@/lib/supabase'

/**
 * 본문 이미지 업로드.
 *
 * 버킷이 비공개라 저장하는 값은 URL 이 아니라 `<bucket>/<path>` 형태의 경로다.
 * 서명 URL 은 만료되므로 본문에 박아두면 며칠 뒤에 깨진다. 표시 시점에
 * getSignedUrl 로 매번 발급한다.
 */
const BUCKET = 'solution-images'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif'])

export function isUploadableImage(file: File): boolean {
  return ALLOWED.has(file.type)
}

function extensionOf(file: File): string {
  const fromType = file.type.split('/')[1]
  if (fromType) return fromType === 'jpeg' ? 'jpg' : fromType
  const fromName = file.name.split('.').pop()
  return fromName ? fromName.toLowerCase() : 'png'
}

export async function uploadImage(file: File, userId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('PNG, JPG, GIF, WebP 이미지만 올릴 수 있습니다.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('이미지 크기는 10MB 까지 가능합니다.')
  }

  const path = `${userId}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
  })
  if (error) throw error

  return `${BUCKET}/${path}`
}

export async function uploadLectureFile(file: File, userId: string): Promise<string> {
  if (file.size > 50 * 1024 * 1024) throw new Error('강의록 파일은 50MB 까지 가능합니다.')
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'file'
  const path = `${userId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('solution-lecture-files').upload(path, file, { cacheControl: '3600', contentType: file.type || 'application/octet-stream' })
  if (error) throw error
  return `solution-lecture-files/${path}`
}

/**
 * 프로필 사진 업로드.
 * 경로 앞자리가 본인 id 여야 Storage 정책을 통과한다.
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('PNG, JPG, GIF, WebP 이미지만 올릴 수 있습니다.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('프로필 사진은 5MB 까지 가능합니다.')
  }

  const path = `${userId}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
  })
  if (error) throw error

  return `avatars/${path}`
}

/**
 * 문제 본문 이미지 업로드 (관리자 편집 화면).
 * 풀이 이미지와 버킷을 나눠 두어야 나중에 정리하거나 옮기기 쉽다.
 */
export async function uploadQuestionImage(file: File, userId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('PNG, JPG, GIF, WebP 이미지만 올릴 수 있습니다.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('이미지 크기는 10MB 까지 가능합니다.')
  }

  const path = `${userId}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error } = await supabase.storage.from('question-images').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
  })
  if (error) throw error

  return `question-images/${path}`
}

/** 관리자 이론 편집기의 이미지 업로드. */
export async function uploadTheoryImage(file: File, userId: string): Promise<string> {
  if (!ALLOWED.has(file.type)) {
    throw new Error('PNG, JPG, GIF, WebP 이미지만 올릴 수 있습니다.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('이미지 크기는 10MB 까지 가능합니다.')
  }

  const path = `${userId}/${crypto.randomUUID()}.${extensionOf(file)}`
  const { error } = await supabase.storage.from('theory-images').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
  })
  if (error) throw error

  return `theory-images/${path}`
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

  const html = data.getData('text/html')
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
