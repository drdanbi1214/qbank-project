import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import {
  addLearningActivity,
  type LearningActivityCategory,
} from '@/lib/queries/study'

const IDLE_AFTER_MS = 2 * 60 * 1000
const COUNT_EVERY_MS = 10 * 1000
const SEND_EVERY_MS = 30 * 1000
const MIN_SEND_SECONDS = 5

function categoryForPath(pathname: string): LearningActivityCategory {
  if (
    pathname === '/solve' ||
    pathname === '/block-test' ||
    pathname.startsWith('/study') ||
    pathname.startsWith('/exams') ||
    pathname.startsWith('/wrong-notes')
  ) {
    return 'question'
  }
  if (pathname.startsWith('/theory') || pathname.startsWith('/lectures')) {
    return 'theory'
  }
  return 'other'
}

/**
 * 로그인한 사용자가 실제로 보고 있는 화면의 활성 시간을 짧게 나누어 저장한다.
 * 숨겨진 탭, 포커스를 잃은 창, 2분 이상 입력이 없는 화면은 세지 않는다.
 */
export function LearningActivityTracker() {
  const { session, profile, isPending } = useAuth()
  const location = useLocation()
  const category = useMemo(() => categoryForPath(location.pathname), [location.pathname])
  const userId = session?.user.id ?? null
  const enabled = Boolean(userId && profile && !isPending)

  useEffect(() => {
    if (!enabled) return

    let accumulatedSeconds = 0
    let lastMeasuredAt = performance.now()
    let lastInteractionAt = Date.now()
    let disposed = false

    const isActivelyUsing = () =>
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      Date.now() - lastInteractionAt < IDLE_AFTER_MS

    const measure = () => {
      const now = performance.now()
      const elapsedSeconds = Math.max(0, Math.min(30, (now - lastMeasuredAt) / 1000))
      if (isActivelyUsing()) accumulatedSeconds += elapsedSeconds
      lastMeasuredAt = now
    }

    const markInteraction = () => {
      measure()
      lastInteractionAt = Date.now()
    }

    const flush = () => {
      measure()
      const seconds = Math.floor(accumulatedSeconds)
      if (seconds < MIN_SEND_SECONDS) return
      accumulatedSeconds -= seconds

      void addLearningActivity(category, seconds).catch((caught: unknown) => {
        if (!disposed) accumulatedSeconds += seconds
        console.error('학습 이용 시간을 저장하지 못했습니다.', caught)
      })
    }

    const onVisibilityChange = () => {
      measure()
      if (document.visibilityState === 'hidden') flush()
      else {
        lastMeasuredAt = performance.now()
        lastInteractionAt = Date.now()
      }
    }
    const onBlur = () => {
      measure()
      flush()
    }
    const onFocus = () => {
      lastMeasuredAt = performance.now()
      lastInteractionAt = Date.now()
    }

    const interactionEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    interactionEvents.forEach((eventName) =>
      window.addEventListener(eventName, markInteraction, { passive: true }),
    )
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)

    const countTimer = window.setInterval(measure, COUNT_EVERY_MS)
    const sendTimer = window.setInterval(flush, SEND_EVERY_MS)

    return () => {
      flush()
      disposed = true
      window.clearInterval(countTimer)
      window.clearInterval(sendTimer)
      interactionEvents.forEach((eventName) =>
        window.removeEventListener(eventName, markInteraction),
      )
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [category, enabled, userId])

  return null
}
