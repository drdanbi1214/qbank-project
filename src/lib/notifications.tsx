import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

type NotificationState = {
  unreadCount: number
  refresh: () => void
}

const NotificationContext = createContext<NotificationState | null>(null)

/**
 * Realtime 채널은 토픽 이름으로 재사용된다. 같은 이름으로 두 번 구독하면
 * "cannot add postgres_changes callbacks after subscribe()" 로 실패하므로
 * 구독 인스턴스마다 토픽을 다르게 만든다.
 */
let channelSeq = 0

/**
 * 미읽음 알림 개수를 한 곳에서 구독한다.
 * 헤더 종 아이콘과 모바일 탭바가 같은 값을 공유하므로 구독은 하나만 유지한다.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [unreadCount, setUnreadCount] = useState(0)
  const reload = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!userId) return

    const uid = userId
    let active = true

    async function load() {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('is_read', false)

      if (!active) return
      if (error) {
        console.error('알림 개수를 불러오지 못했습니다.', error)
        return
      }
      setUnreadCount(count ?? 0)
    }

    reload.current = () => void load()
    void load()

    channelSeq += 1
    const channel = supabase
      .channel(`notifications:${uid}:${channelSeq}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${uid}`,
        },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      active = false
      reload.current = null
      void supabase.removeChannel(channel)
    }
  }, [userId])

  const refresh = useCallback(() => {
    reload.current?.()
  }, [])

  const value = useMemo<NotificationState>(
    () => ({
      // 로그아웃 상태에서는 직전 사용자의 값이 남지 않도록 0으로 노출한다.
      unreadCount: userId ? unreadCount : 0,
      refresh,
    }),
    [userId, unreadCount, refresh],
  )

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationState {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications 는 NotificationProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUnreadCount(): number {
  return useNotifications().unreadCount
}
