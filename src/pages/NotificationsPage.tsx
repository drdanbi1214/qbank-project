import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useNotifications } from '@/lib/notifications'
import {
  NOTIFICATION_LABEL,
  fetchNotifications,
  markAllRead,
  markRead,
  resolveNotificationLink,
  type AppNotification,
} from '@/lib/queries/notifications'
import { formatRelative } from '@/utils/date'
import { cn } from '@/utils/cn'

export function NotificationsPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { refresh } = useNotifications()
  const userId = session?.user.id ?? ''

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; items: AppNotification[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchNotifications()
      .then((items) => {
        if (active) {
          setLoaded({ key: reloadKey, items })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '알림을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  const open = useCallback(
    async (notification: AppNotification) => {
      if (!notification.isRead) {
        await markRead([notification.id]).catch((caught: unknown) =>
          console.error('읽음 처리하지 못했습니다.', caught),
        )
        refresh()
        reload()
      }
      const link = await resolveNotificationLink(notification)
      if (link) navigate(link)
    },
    [navigate, refresh, reload],
  )

  const ready = loaded?.key === reloadKey
  const items = ready ? loaded.items : []
  const unread = items.filter((item) => !item.isRead).length

  return (
    <section>
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">알림</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unread > 0 ? `읽지 않은 알림 ${unread}개` : '새 알림이 없습니다.'}
          </p>
        </div>
        {unread > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void markAllRead(userId)
                .then(() => {
                  refresh()
                  reload()
                })
                .catch((caught: unknown) => console.error('읽음 처리하지 못했습니다.', caught))
            }}
          >
            모두 읽음
          </Button>
        )}
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : !ready ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">아직 받은 알림이 없습니다.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void open(item)}
                className={cn(
                  'block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  !item.isRead && 'bg-brand-50/60 dark:bg-brand-900/20',
                )}
              >
                <div className="flex items-center gap-2">
                  {!item.isRead && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                  )}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {NOTIFICATION_LABEL[item.type] ?? '알림'}
                  </span>
                  <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                    {formatRelative(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  {item.actor && (
                    <span className="font-semibold">{item.actor.displayName} </span>
                  )}
                  {item.message}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
