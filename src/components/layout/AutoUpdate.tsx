import { useCallback, useEffect, useRef, useState } from 'react'

const CHECK_INTERVAL_MS = 60_000
const FIRST_CHECK_DELAY_MS = 10_000
const RELOAD_ATTEMPT_PREFIX = 'qbank:auto-update-attempted:'

type VersionFile = {
  buildTime?: unknown
}

/** 풀이와 작성 도중에는 새 배포가 있어도 현재 작업을 먼저 보호한다. */
function shouldDeferAutoRefresh(): boolean {
  const protectedRoute = ['/solve', '/block-test', '/print'].some((path) =>
    window.location.pathname.startsWith(path),
  )
  if (protectedRoute) return true

  if (document.querySelector('[data-auto-update-blocker], [contenteditable="true"]')) {
    return true
  }

  const active = document.activeElement
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  )
}

function reloadAttemptKey(nextVersion: string): string {
  return `${RELOAD_ATTEMPT_PREFIX}${__BUILD_TIME__}:${nextVersion}`
}

/**
 * 배포 후에도 열려 있던 일반 화면은 최신 번들을 스스로 받아온다.
 * 풀이·작성 중인 탭은 작업이 끝난 뒤에도 자동으로 새로고침하지 않고 안내만
 * 유지한다. 사용자가 직접 반영 시점을 고르게 해야 임시 입력을 잃지 않는다.
 */
export function AutoUpdate() {
  const checking = useRef(false)
  const [availableVersion, setAvailableVersion] = useState<string | null>(null)

  const reloadFor = useCallback((nextVersion: string) => {
    const key = reloadAttemptKey(nextVersion)
    // CDN 장애 등으로 새로고침 뒤에도 예전 HTML이 온 경우 무한 반복하지 않는다.
    if (window.sessionStorage.getItem(key) === '1') {
      setAvailableVersion(nextVersion)
      return
    }
    window.sessionStorage.setItem(key, '1')
    window.location.reload()
  }, [])

  const checkForUpdate = useCallback(async () => {
    if (checking.current || document.visibilityState === 'hidden') return
    checking.current = true
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        return
      }

      const data = (await response.json()) as VersionFile
      const nextVersion = typeof data.buildTime === 'string' ? data.buildTime : null
      if (!nextVersion || nextVersion === __BUILD_TIME__) return

      if (shouldDeferAutoRefresh()) setAvailableVersion(nextVersion)
      else reloadFor(nextVersion)
    } catch {
      // 오프라인이나 일시적인 배포 전환 중에는 다음 검사에서 다시 시도한다.
    } finally {
      checking.current = false
    }
  }, [reloadFor])

  useEffect(() => {
    if (!import.meta.env.PROD) return

    const firstCheck = window.setTimeout(() => void checkForUpdate(), FIRST_CHECK_DELAY_MS)
    const interval = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
    const onFocus = () => void checkForUpdate()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForUpdate()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(firstCheck)
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [checkForUpdate])

  if (!availableVersion) return null

  return (
    <aside
      role="status"
      className="fixed inset-x-3 bottom-20 z-[60] mx-auto flex max-w-lg items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm shadow-xl dark:border-brand-800 dark:bg-slate-900 lg:bottom-4"
    >
      <p className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
        새 버전이 준비됐습니다. 작성 중인 내용은 그대로 유지되며, 직접 새로고침할 때 반영됩니다.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700"
      >
        지금 새로고침
      </button>
    </aside>
  )
}
