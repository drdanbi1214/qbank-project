import { NavLink } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { MOBILE_NAV } from '@/lib/navigation'
import { useUnreadCount } from '@/lib/notifications'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

export function MobileTabBar() {
  const unread = useUnreadCount()
  const { openAssignments } = useData()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-950"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="flex">
        {MOBILE_NAV.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-slate-500 dark:text-slate-400',
                )
              }
            >
              <span className="relative">
                <Icon name={item.icon} size={22} />
                {item.icon === 'bell' && unread > 0 && (
                  <span className="absolute -right-1.5 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                {item.icon === 'clipboard' && openAssignments > 0 && (
                  <span className="absolute -right-1.5 -top-1 min-w-4 rounded-full bg-brand-600 px-1 text-[10px] leading-4 text-white">
                    {openAssignments > 99 ? '99+' : openAssignments}
                  </span>
                )}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
