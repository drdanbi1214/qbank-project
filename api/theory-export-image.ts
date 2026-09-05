export const config = { runtime: 'edge' }

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED_SOURCES: Record<string, readonly string[]> = {
  'media.allenslibrary.com': ['/theory/', '/concept/', '/problem/'],
  'dev.media.allenslibrary.com': ['/problems/'],
  's3.ap-northeast-2.amazonaws.com': ['/media.allenslibrary.com/'],
}

/**
 * 알렌 원본 서버는 이미지를 보여 주지만 CORS 헤더를 주지 않는다. 화면의 <img>
 * 태그에는 보이더라도 브라우저가 바이트를 읽어 DOCX 안에 넣는 요청은 막히므로,
 * 내보내기 때만 같은 출처로 안전하게 전달한다.
 *
 * 공개 프록시가 되지 않도록 현재 DB에 실제로 저장된 호스트와 경로만 허용한다.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return response('method_not_allowed', 405, { Allow: 'GET' })

  const requested = new URL(request.url).searchParams.get('url')
  const source = approvedUrl(requested)
  if (!source) return response('invalid_image_url', 400)

  try {
    const upstream = await fetchApproved(source)
    if (!upstream.ok) return response('upstream_image_unavailable', 502)

    const declaredLength = Number(upstream.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return response('image_too_large', 413)
    }

    const bytes = await upstream.arrayBuffer()
    if (bytes.byteLength === 0) return response('empty_image', 502)
    if (bytes.byteLength > MAX_IMAGE_BYTES) return response('image_too_large', 413)
    const contentType = imageContentType(new Uint8Array(bytes), source.pathname)
    if (!contentType) return response('unsupported_image', 415)

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('theory export image proxy failed', error)
    return response('upstream_fetch_failed', 502)
  }
}

async function fetchApproved(source: URL, redirects = 0): Promise<Response> {
  if (redirects > 2) throw new Error('too_many_redirects')
  const result = await fetch(source, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8' },
  })
  if (![301, 302, 303, 307, 308].includes(result.status)) return result

  const location = result.headers.get('location')
  const redirected = approvedUrl(location ? new URL(location, source).toString() : null)
  if (!redirected) throw new Error('unapproved_redirect')
  return fetchApproved(redirected, redirects + 1)
}

function approvedUrl(value: string | null): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) return null
    const prefixes = ALLOWED_SOURCES[url.hostname.toLowerCase()]
    if (!prefixes?.some((prefix) => url.pathname.startsWith(prefix))) return null
    return url
  } catch {
    return null
  }
}

function imageContentType(bytes: Uint8Array, path: string): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp'
  const prefix = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase()
  if (prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'))) return 'image/svg+xml'

  const extension = path.toLowerCase().match(/\.(png|jpe?g|gif|webp|bmp|svg)$/)?.[1]
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  return extension ? `image/${extension}` : null
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

function response(message: string, status: number, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}
