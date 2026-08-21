interface Env {
  STORAGE: R2Bucket
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  URL_SIGNING_SECRET: string
  MIGRATION_SECRET: string
  ALLOWED_ORIGINS: string
  SIGNED_URL_TTL_SECONDS?: string
}

interface ParsedStoragePath {
  bucket: string
  objectName: string
  key: string
}

interface SignRequest {
  storagePath?: unknown
}

const IMAGE_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
const LECTURE_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])

const BUCKET_LIMITS: Record<string, { maxBytes: number; contentTypes: Set<string> }> = {
  'question-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'solution-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  avatars: { maxBytes: 5 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'theory-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'ai-solution-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'senior-solution-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'topic-images': { maxBytes: 10 * 1024 * 1024, contentTypes: IMAGE_TYPES },
  'solution-lecture-files': { maxBytes: 50 * 1024 * 1024, contentTypes: LECTURE_TYPES },
  'exam-sources': { maxBytes: 100 * 1024 * 1024, contentTypes: new Set(['application/pdf']) },
}

const encoder = new TextEncoder()

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const allowed = env.ALLOWED_ORIGINS.split(',').map((item) => item.trim())
  return allowed.includes(origin) ? origin : null
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = allowedOrigin(request, env)
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function parseStoragePath(value: string): ParsedStoragePath | null {
  const clean = value.replace(/^\/+/, '')
  if (!clean || clean.length > 1100 || clean.includes('\\') || clean.includes('//')) return null

  const segments = clean.split('/')
  if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null
  }
  if (segments.some((segment) => [...segment].some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  }))) return null

  const [bucket, ...objectParts] = segments
  if (!BUCKET_LIMITS[bucket]) return null
  const objectName = objectParts.join('/')
  if (objectName.length > 1024) return null
  return { bucket, objectName, key: `${bucket}/${objectName}` }
}

function parsePathname(pathname: string, prefix: string): ParsedStoragePath | null {
  if (!pathname.startsWith(prefix)) return null
  try {
    const encoded = pathname.slice(prefix.length)
    const decoded = encoded.split('/').map((part) => decodeURIComponent(part)).join('/')
    return parseStoragePath(decoded)
  } catch {
    return null
  }
}

function encodeKey(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function signingTtl(env: Env): number {
  const parsed = Number(env.SIGNED_URL_TTL_SECONDS ?? '300')
  if (!Number.isFinite(parsed)) return 300
  return Math.max(60, Math.min(Math.floor(parsed), 900))
}

function base64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
    const binary = atob(padded)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (encoder.encode(secret).byteLength < 32) throw new Error('URL_SIGNING_SECRET must be at least 32 bytes')
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function signObject(env: Env, key: string, expires: number): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.URL_SIGNING_SECRET),
    encoder.encode(`GET\n${key}\n${expires}`),
  )
  return base64Url(signature)
}

async function verifyObjectSignature(
  env: Env,
  key: string,
  expires: number,
  signature: string,
): Promise<boolean> {
  const bytes = fromBase64Url(signature)
  if (!bytes) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(env.URL_SIGNING_SECRET),
    bytes,
    encoder.encode(`GET\n${key}\n${expires}`),
  )
}

async function verifyMigrationSecret(env: Env, provided: string): Promise<boolean> {
  if (encoder.encode(provided).byteLength < 32) return false
  const message = encoder.encode('qbank-r2-migration')
  const providedSignature = await crypto.subtle.sign('HMAC', await hmacKey(provided), message)
  return crypto.subtle.verify('HMAC', await hmacKey(env.MIGRATION_SECRET), providedSignature, message)
}

async function authorize(
  request: Request,
  env: Env,
  path: ParsedStoragePath,
  operation: 'read' | 'upload',
): Promise<'allowed' | 'unauthorized' | 'forbidden' | 'unavailable'> {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return 'unauthorized'

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/authorize_storage_object`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_bucket: path.bucket,
      p_object_name: path.objectName,
      p_operation: operation,
    }),
  })

  if (response.status === 401) return 'unauthorized'
  if (!response.ok) {
    console.error('storage authorization RPC failed', response.status, (await response.text()).slice(0, 300))
    return 'unavailable'
  }
  return (await response.json()) === true ? 'allowed' : 'forbidden'
}

function authorizationError(result: Exclude<Awaited<ReturnType<typeof authorize>>, 'allowed'>, headers: HeadersInit) {
  if (result === 'unauthorized') return json({ error: 'unauthorized' }, 401, headers)
  if (result === 'forbidden') return json({ error: 'forbidden' }, 403, headers)
  return json({ error: 'authorization_unavailable' }, 503, headers)
}

async function handleSign(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env)
  if (request.headers.get('Origin') && !allowedOrigin(request, env)) {
    return json({ error: 'origin_not_allowed' }, 403)
  }

  let body: SignRequest
  try {
    body = await request.json<SignRequest>()
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }
  if (typeof body.storagePath !== 'string') return json({ error: 'invalid_storage_path' }, 400, cors)

  const path = parseStoragePath(body.storagePath)
  if (!path) return json({ error: 'invalid_storage_path' }, 400, cors)

  const auth = await authorize(request, env, path, 'read')
  if (auth !== 'allowed') return authorizationError(auth, cors)

  // A missing R2 object tells the frontend to use the temporary Supabase
  // fallback during migration instead of handing an <img> a doomed URL.
  if (!(await env.STORAGE.head(path.key))) return json({ error: 'object_not_found' }, 404, cors)

  const expires = Math.floor(Date.now() / 1000) + signingTtl(env)
  const signature = await signObject(env, path.key, expires)
  const objectUrl = new URL(`/v1/objects/${encodeKey(path.key)}`, request.url)
  objectUrl.searchParams.set('expires', String(expires))
  objectUrl.searchParams.set('signature', signature)
  return json({ url: objectUrl.toString(), expiresAt: expires * 1000 }, 200, {
    ...cors,
    'Cache-Control': 'no-store',
  })
}

interface ByteRange {
  offset: number
  length: number
}

function parseRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid'

  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    const length = Math.min(suffix, size)
    return { offset: size - length, length }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size) {
    return 'invalid'
  }
  const end = Math.min(requestedEnd, size - 1)
  if (end < start) return 'invalid'
  return { offset: start, length: end - start + 1 }
}

function objectHeaders(object: R2Object, cors: HeadersInit): Headers {
  const headers = new Headers(cors)
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=300')
  headers.set('X-Content-Type-Options', 'nosniff')
  return headers
}

async function handleObject(request: Request, env: Env, url: URL): Promise<Response> {
  const cors = corsHeaders(request, env)
  const path = parsePathname(url.pathname, '/v1/objects/')
  if (!path) return json({ error: 'invalid_storage_path' }, 400, cors)

  const expires = Number(url.searchParams.get('expires'))
  const signature = url.searchParams.get('signature') ?? ''
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + signingTtl(env) + 60) {
    return json({ error: 'expired_or_invalid_signature' }, 403, cors)
  }
  if (!(await verifyObjectSignature(env, path.key, expires, signature))) {
    return json({ error: 'expired_or_invalid_signature' }, 403, cors)
  }

  if (request.method === 'HEAD') {
    const object = await env.STORAGE.head(path.key)
    if (!object) return json({ error: 'object_not_found' }, 404, cors)
    const headers = objectHeaders(object, cors)
    headers.set('Content-Length', String(object.size))
    return new Response(null, { status: 200, headers })
  }

  const rangeHeader = request.headers.get('Range')
  if (rangeHeader) {
    const head = await env.STORAGE.head(path.key)
    if (!head) return json({ error: 'object_not_found' }, 404, cors)
    const range = parseRange(rangeHeader, head.size)
    if (range === 'invalid' || range === null) {
      const headers = new Headers(cors)
      headers.set('Content-Range', `bytes */${head.size}`)
      return new Response(null, { status: 416, headers })
    }
    const object = await env.STORAGE.get(path.key, { range })
    if (!object?.body) return json({ error: 'object_not_found' }, 404, cors)
    const headers = objectHeaders(object, cors)
    headers.set('Content-Length', String(range.length))
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
    return new Response(object.body, { status: 206, headers })
  }

  const object = await env.STORAGE.get(path.key)
  if (!object?.body) return json({ error: 'object_not_found' }, 404, cors)
  const headers = objectHeaders(object, cors)
  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const cors = corsHeaders(request, env)
  if (request.headers.get('Origin') && !allowedOrigin(request, env)) {
    return json({ error: 'origin_not_allowed' }, 403)
  }

  const path = parsePathname(url.pathname, '/v1/uploads/')
  if (!path) return json({ error: 'invalid_storage_path' }, 400, cors)
  const rule = BUCKET_LIMITS[path.bucket]

  const contentType = (request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase()
  if (!rule.contentTypes.has(contentType)) return json({ error: 'content_type_not_allowed' }, 415, cors)

  const contentLength = Number(request.headers.get('Content-Length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return json({ error: 'content_length_required' }, 411, cors)
  }
  if (contentLength > rule.maxBytes) return json({ error: 'file_too_large' }, 413, cors)
  if (!request.body) return json({ error: 'empty_body' }, 400, cors)

  const auth = await authorize(request, env, path, 'upload')
  if (auth !== 'allowed') return authorizationError(auth, cors)

  await env.STORAGE.put(path.key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: 'private, max-age=300',
    },
    customMetadata: {
      uploadedVia: 'qbank-storage-gateway',
    },
  })

  return json({ storagePath: path.key }, 201, { ...cors, 'Cache-Control': 'no-store' })
}

async function handleInternalObject(request: Request, env: Env, url: URL): Promise<Response> {
  // This endpoint is for local administration scripts only.  It deliberately
  // has no CORS response and no delete method.  Its secret is independent from
  // both Supabase and Cloudflare account credentials.
  if (request.headers.has('Origin')) return json({ error: 'browser_requests_not_allowed' }, 403)
  const provided = request.headers.get('X-Qbank-Migration-Secret') ?? ''
  if (!(await verifyMigrationSecret(env, provided))) return json({ error: 'unauthorized' }, 401)

  const path = parsePathname(url.pathname, '/v1/internal/objects/')
  if (!path) return json({ error: 'invalid_storage_path' }, 400)

  if (request.method === 'HEAD') {
    const object = await env.STORAGE.head(path.key)
    if (!object) return new Response(null, { status: 404 })
    const headers = objectHeaders(object, {})
    headers.set('Content-Length', String(object.size))
    const sha256 = object.customMetadata?.sha256
    if (sha256) headers.set('X-Qbank-Sha256', sha256)
    return new Response(null, { status: 200, headers })
  }

  if (request.method === 'GET') {
    const object = await env.STORAGE.get(path.key)
    if (!object?.body) return json({ error: 'object_not_found' }, 404)
    const headers = objectHeaders(object, {})
    headers.set('Content-Length', String(object.size))
    const sha256 = object.customMetadata?.sha256
    if (sha256) headers.set('X-Qbank-Sha256', sha256)
    return new Response(object.body, { status: 200, headers })
  }

  const rule = BUCKET_LIMITS[path.bucket]
  const contentType = (request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase()
  if (!rule.contentTypes.has(contentType)) return json({ error: 'content_type_not_allowed' }, 415)
  const contentLength = Number(request.headers.get('Content-Length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return json({ error: 'content_length_required' }, 411)
  }
  if (contentLength > rule.maxBytes) return json({ error: 'file_too_large' }, 413)
  if (!request.body) return json({ error: 'empty_body' }, 400)

  const sha256 = request.headers.get('X-Content-Sha256') ?? ''
  if (!/^[a-f0-9]{64}$/.test(sha256)) return json({ error: 'sha256_required' }, 400)

  await env.STORAGE.put(path.key, request.body, {
    httpMetadata: { contentType, cacheControl: 'private, max-age=300' },
    customMetadata: { sha256, uploadedVia: 'qbank-migration-gateway' },
  })
  return json({ storagePath: path.key }, 201, { 'Cache-Control': 'no-store' })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin(request, env)) return new Response(null, { status: 403 })
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/sign') return handleSign(request, env)
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/v1/objects/')) {
      return handleObject(request, env, url)
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/v1/uploads/')) {
      return handleUpload(request, env, url)
    }
    if (
      (request.method === 'GET' || request.method === 'HEAD' || request.method === 'PUT')
      && url.pathname.startsWith('/v1/internal/objects/')
    ) {
      return handleInternalObject(request, env, url)
    }
    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>
