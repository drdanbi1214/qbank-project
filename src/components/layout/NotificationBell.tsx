import { NavLink } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { useUnreadCount } from '@/lib/notifications'

export function NotificationBell() {
  const unread = useUnreadCount()

  return (
    <NavLink
      to="/notifications"
      title="알림"
      aria-label={unread > 0 ? `읽지 않은 알림 ${unread}건` : '알림'}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Icon name="bell" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  )
}
