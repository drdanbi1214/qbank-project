import { useEffect, useCallback, useState } from 'react'
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

/** 다시 해 볼 만한 실패. 권한이 없어 막힌 것과 갈라야 헛되이 조르지 않는다. */
const RETRY: unique symbol = Symbol('retry')
type SignResult = { url: string; expiresAt: number } | null | typeof RETRY

async function getR2SignedUrl(
  storagePath: string,
  accessToken: string,
): Promise<SignResult> {
  if (!R2_GATEWAY_URL) return null

  let response: Response
  try {
    response = await fetch(`${R2_GATEWAY_URL}/v1/sign`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storagePath }),
    })
  } catch {
    // 그물이 끊겼거나 한꺼번에 너무 많이 보냈다. 다시 해 볼 값어치가 있다.
    return RETRY
  }
  if (!response.ok) {
    console.error('R2 이미지 URL을 만들지 못했습니다.', storagePath, response.status)
    // 408·429·5xx 는 잠시 뒤면 되는 것들이다. 403 처럼 막힌 것은 졸라도 같다.
    return response.status === 408 || response.status === 429 || response.status >= 500
      ? RETRY
      : null
  }

  const result = await response.json() as { url?: unknown; expiresAt?: unknown }
  if (typeof result.url !== 'string' || typeof result.expiresAt !== 'number') return null
  return { url: result.url, expiresAt: Math.max(Date.now(), result.expiresAt - 30_000) }
}

/**
 * 지금 받아오는 중인 서명. 한 쪽에 같은 그림이 여러 번 나오거나 카드가 수십 장
 * 깔리면, 예전에는 저마다 따로 요청을 보내 문지기에게 한꺼번에 몰렸다. 몰리면
 * 일부가 밀려나 "어떤 그림만 랜덤하게 안 뜨는" 것처럼 보인다.
 */
const inflight = new Map<string, Promise<string | null>>()

const SIGN_ATTEMPTS = 3

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  if (/^https?:\/\//.test(storagePath)) return storagePath

  // A signed URL is a bearer credential. Keep it scoped to the account that
  // passed the authorization check so a later login in the same tab cannot
  // reuse the previous account's URL.
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return null
  const cacheKey = `${session.user.id}:${storagePath}`

  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const pending = inflight.get(cacheKey)
  if (pending) return pending

  const task = signOnce(storagePath, session.access_token, cacheKey).finally(() => {
    inflight.delete(cacheKey)
  })
  inflight.set(cacheKey, task)
  return task
}

async function signOnce(
  storagePath: string,
  accessToken: string,
  cacheKey: string,
): Promise<string | null> {
  const parsed = parseStoragePath(storagePath)
  if (!parsed) return null
  const useR2 = usesR2(parsed.bucket)

  for (let attempt = 0; attempt < SIGN_ATTEMPTS; attempt += 1) {
    let signed: SignResult = useR2
      ? await getR2SignedUrl(storagePath, accessToken)
      : await getSupabaseSignedUrl(storagePath)

    if (signed === RETRY) {
      // 한꺼번에 몰려 밀린 것이라면 조금 기다렸다 다시 간다.
      if (attempt < SIGN_ATTEMPTS - 1) await wait(250 * 2 ** attempt)
      continue
    }
    if (!signed && useR2 && READ_FALLBACK) {
      signed = await getSupabaseSignedUrl(storagePath)
    }
    if (!signed) return null

    cache.set(cacheKey, signed)
    return signed.url
  }
  return null
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

export type SignedUrlState = {
  url: string | null
  status: 'idle' | 'loading' | 'ready' | 'failed'
  /** 다시 받아 본다. 서명이 한 번 막혔다고 영영 못 보게 둘 이유는 없다. */
  retry: () => void
}

/**
 * 서명 주소를 상태와 함께 돌려준다.
 *
 * getSignedUrl 은 권한이 없든, 그물이 끊겼든, 주소가 이상하든 모두 null 을
 * 돌려준다. 그것만 보면 "아직 받는 중" 과 "못 받았다" 가 구별되지 않아, 실패한
 * 카드가 영영 "불러오는 중…" 에 머문다. 무엇이 일어났는지 부르는 쪽이 알아야
 * 안내를 하든 다시 받든 할 수 있다.
 */
export function useSignedUrlState(storagePath: string | null | undefined): SignedUrlState {
  const [nonce, setNonce] = useState(0)
  const [result, setResult] = useState<{ key: string; url: string | null } | null>(null)
  const key = `${nonce}:${storagePath ?? ''}`

  useEffect(() => {
    if (!storagePath) return
    let active = true
    getSignedUrl(storagePath)
      .then((next) => {
        if (active) setResult({ key, url: next })
      })
      .catch(() => {
        // 던져도 여기서 받는다. 예전에는 catch 가 없어 거부된 약속이 그대로
        // 새고, 카드가 끝나지 않는 로딩에 갇혔다.
        if (active) setResult({ key, url: null })
      })
    return () => {
      active = false
    }
  }, [storagePath, key])

  const retry = useCallback(() => setNonce((value) => value + 1), [])
  const settled = result?.key === key
  if (!storagePath) return { url: null, status: 'idle', retry }
  if (!settled) return { url: null, status: 'loading', retry }
  return { url: result.url, status: result.url ? 'ready' : 'failed', retry }
}

export function useSignedUrl(storagePath: string | null | undefined): string | null {
  return useSignedUrlState(storagePath).url
}
