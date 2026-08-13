/**
 * 배포가 새로 올라간 뒤에도 브라우저 탭이 예전 index.html 을 들고 있으면,
 * 그 안에 적힌 청크 해시(예: jspdf.es.min-XXXX.js)가 서버에 더 이상 없어
 * 동적 import 가 실패한다. "Failed to fetch dynamically imported module" 류의
 * 메시지가 그 신호다.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    message,
  )
}

// 이 값은 배포할 때마다 달라진다. 이전 배포본에서 한 번 복구를 시도했다는
// 사실 때문에, 다음 배포본에서도 자동 복구가 막히지 않도록 버전별로 기록한다.
const RELOAD_FLAG = `qbank:chunk-reload-attempted:${__BUILD_TIME__}`

/**
 * 새로고침하면 최신 index.html 을 받아와 청크 해시가 다시 맞아떨어진다.
 * 세션당 한 번만 시도해서, 정말 다른 이유로 계속 실패하는 경우 무한 새로고침에
 * 빠지지 않게 막는다.
 */
export function reloadOnce(): boolean {
  if (sessionStorage.getItem(RELOAD_FLAG)) return false
  sessionStorage.setItem(RELOAD_FLAG, '1')
  window.location.reload()
  return true
}
