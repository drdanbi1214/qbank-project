import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * 버킷이 모두 비공개라 이미지는 서명 URL 로 표시한다.
 * 저장 형식은 `<bucket>/<path>` 이며, 이미 http 로 시작하면 그대로 사용한다.
 */
const SIGNED_TTL_SEC = 60 * 60
const cache = new Map<string, { url: string; expiresAt: number }>()

const STORAGE_PROVIDER = import.meta.env.VITE_STORAGE_PROVIDER ?? 'supabase'
const R2_GATEWAY_URL = import.meta.env.VITE_R2_GATEWAY_URL?.replace(/\/$/, '')
const R2_CANARY_BUCKETS = new Set(
  (import.meta.env.VITE_R2_CANARY_BUCKETS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
)
const READ_FALLBACK = import.meta.env.VITE_STORAGE_READ_FALLBACK === 'true'
const UPLOAD_FALLBACK = import.meta.env.VITE_STORAGE_UPLOAD_FALLBACK === 'true'
const R2_UPLOAD_ATTEMPTS = 3

function parseStoragePath(storagePath: string): { bucket: string; path: string } | null {
  const [bucket, ...rest] = storagePath.replace(/^\/+/, '').split('/')
  const path = rest.join('/')
  return bucket && path ? { bucket, path } : null
}

function encodeStoragePath(storagePath: string): string {
  return storagePath.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function usesR2(bucket: string): boolean {
  return STORAGE_PROVIDER === 'r2' || R2_CANARY_BUCKETS.has(bucket)
}

async function getSupabaseSignedUrl(storagePath: string): Promise<{ url: string; expiresAt: number } | null> {
  const parsed = parseStoragePath(storagePath)
  if (!parsed) return null

  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, SIGNED_TTL_SEC)
  if (error || !data) {
    console.error('Supabase 이미지 URL을 만들지 못했습니다.', storagePath, error)
    return null
  }
  return {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL_SEC - 60) * 1000,
  }
}

async function getR2SignedUrl(storagePath: string): Promise<{ url: string; expiresAt: number } | null> {
  if (!R2_GATEWAY_URL) return null
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) return null

  const response = await fetch(`${R2_GATEWAY_URL}/v1/sign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storagePath }),
  })
  if (!response.ok) {
    console.error('R2 이미지 URL을 만들지 못했습니다.', storagePath, response.status)
    return null
  }

  const result = await response.json() as { url?: unknown; expiresAt?: unknown }
  if (typeof result.url !== 'string' || typeof result.expiresAt !== 'number') return null
  return { url: result.url, expiresAt: Math.max(Date.now(), result.expiresAt - 30_000) }
}

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  if (/^https?:\/\//.test(storagePath)) return storagePath

  const cached = cache.get(storagePath)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const parsed = parseStoragePath(storagePath)
  if (!parsed) return null
  const useR2 = usesR2(parsed.bucket)
  let signed = useR2 ? await getR2SignedUrl(storagePath) : await getSupabaseSignedUrl(storagePath)
  if (!signed && useR2 && READ_FALLBACK) {
    signed = await getSupabaseSignedUrl(storagePath)
  }
  if (!signed) return null

  cache.set(storagePath, signed)
  return signed.url
}

async function uploadToSupabase(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    cacheControl: '3600',
    contentType,
  })
  if (error) throw error
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function uploadToR2(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
): Promise<void> {
  if (!R2_GATEWAY_URL) throw new Error('VITE_R2_GATEWAY_URL이 설정되지 않았습니다.')
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.')

  const storagePath = `${bucket}/${path}`
  let lastError: Error | null = null
  for (let attempt = 0; attempt < R2_UPLOAD_ATTEMPTS; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch(`${R2_GATEWAY_URL}/v1/uploads/${encodeStoragePath(storagePath)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': contentType,
        },
        body,
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (response) {
      if (response.ok) return
      const result = await response.json().catch(() => null) as { error?: unknown } | null
      const reason = typeof result?.error === 'string' ? result.error : `HTTP ${response.status}`
      lastError = new Error(`R2 업로드 실패: ${reason}`)
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!retryable) throw lastError
    }
    if (attempt < R2_UPLOAD_ATTEMPTS - 1) await wait(300 * 2 ** attempt)
  }
  throw lastError ?? new Error('R2 업로드에 실패했습니다.')
}

/** 환경변수로 선택된 비공개 스토리지에 같은 `<bucket>/<path>` 키로 업로드한다. */
export async function uploadStoredObject(
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
): Promise<void> {
  if (!usesR2(bucket)) {
    await uploadToSupabase(bucket, path, body, contentType)
    return
  }

  try {
    await uploadToR2(bucket, path, body, contentType)
  } catch (error) {
    if (!UPLOAD_FALLBACK) throw error
    console.warn('R2 업로드 실패로 Supabase Storage에 임시 저장합니다.', error)
    await uploadToSupabase(bucket, path, body, contentType)
  }
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
