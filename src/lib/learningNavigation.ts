/** Only allow local app destinations, including their filters. */
export function safeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return null
  const url = new URL(value, 'https://qbank.local')
  if (url.origin !== 'https://qbank.local' || url.pathname === '/solve') return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function withReturnTo(href: string, returnTo: string): string {
  const url = new URL(href, 'https://qbank.local')
  const safe = safeReturnTo(returnTo)
  if (safe) url.searchParams.set('returnTo', safe)
  return `${url.pathname}${url.search}${url.hash}`
}

export function sessionReturnTo(mode: string, scope: Record<string, unknown>): string {
  if (mode === 'daily') return '/study'
  if (typeof scope.return_to === 'string') {
    const saved = safeReturnTo(scope.return_to)
    if (saved) return saved
  }
  if (mode === 'bookmark') return '/wrong-notes?tab=bookmark'
  if (typeof scope.unit_id === 'string' && typeof scope.subject_id === 'string') {
    return `/study/${scope.subject_id}/${scope.unit_id}`
  }
  if (typeof scope.exam_id === 'string') return `/exams/${scope.exam_id}`
  if (typeof scope.subject_id === 'string') return `/study/${scope.subject_id}`
  return mode === 'wrong_only' ? '/wrong-notes' : '/study'
}
