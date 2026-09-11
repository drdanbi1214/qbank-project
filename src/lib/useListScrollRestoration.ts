import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'

/** Restore only once the asynchronous list has enough height to scroll. */
export function useListScrollRestoration(ready: boolean) {
  const { pathname, search } = useLocation()
  const { session } = useAuth()
  const key = `list-scroll:${session?.user.id ?? ''}:${pathname}${search}`
  useLayoutEffect(() => {
    if (!ready) return
    let frame = 0
    const save = () => {
      try { sessionStorage.setItem(key, String(window.scrollY)) } catch { /* Optional preference. */ }
    }
    try {
      const top = Number(sessionStorage.getItem(key)) || 0
      window.scrollTo({ top, behavior: 'instant' })
    } catch { /* Storage can be disabled. */ }
    // Start listening after restoration, so a pending scroll event from the old page
    // cannot replace the saved position while the new list is mounting.
    frame = requestAnimationFrame(() => window.addEventListener('scroll', save, { passive: true }))
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', save)
    }
  }, [key, ready])
}
