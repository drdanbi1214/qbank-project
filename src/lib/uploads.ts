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

/** 붙여넣기, 드롭 이벤트에서 이미지 파일만 골라낸다. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter(isUploadableImage)
}
