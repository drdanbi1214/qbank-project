import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * 버킷이 모두 비공개라 이미지는 서명 URL 로 표시한다.
 * 저장 형식은 `<bucket>/<path>` 이며, 이미 http 로 시작하면 그대로 사용한다.
 */
const SIGNED_TTL_SEC = 60 * 60
const cache = new Map<string, { url: string; expiresAt: number }>()

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  if (/^https?:\/\//.test(storagePath)) return storagePath

  const cached = cache.get(storagePath)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const [bucket, ...rest] = storagePath.replace(/^\/+/, '').split('/')
  const path = rest.join('/')
  if (!bucket || !path) return null

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL_SEC)
  if (error || !data) {
    console.error('이미지 URL 을 만들지 못했습니다.', storagePath, error)
    return null
  }

  // 만료 직전에 다시 발급받도록 여유를 둔다.
  cache.set(storagePath, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL_SEC - 60) * 1000,
  })
  return data.signedUrl
}

export function useSignedUrl(storagePath: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!storagePath) {
      return
    }
    let active = true
    void getSignedUrl(storagePath).then((next) => {
      if (active) setUrl(next)
    })
    return () => {
      active = false
    }
  }, [storagePath])

  return storagePath ? url : null
}
