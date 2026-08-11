/** 게시판 목록 등에서 쓰는 `26.08.01` 형식 */
export function formatShortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const year = String(date.getFullYear()).slice(2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

/** `2026.08.01 14:32` */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day} ${hour}:${minute}`
}

/** 알림 목록처럼 최근 시각이 중요한 곳에 쓴다. */
export function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 60) return '방금'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}일 전`
  return formatShortDate(iso)
}
