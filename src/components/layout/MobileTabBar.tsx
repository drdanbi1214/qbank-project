import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { MAIN_NAV, MOBILE_NAV } from '@/lib/navigation'
import { useUnreadCount } from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

const MENU_ITEM_CLASS =
  'flex min-h-12 items-center gap-2 rounded-lg px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-800'

/**
 * 모바일 하단 탭바.
 *
 * 탭은 자주 쓰는 학습 기능(학습·검색·오답노트·강의록)만 두고, 나머지는 전체 메뉴로
 * 모은다. 하단은 엄지로 닿는 자리라 문제를 풀다 검색·오답노트로 건너뛰는 흐름이
 * 프로필 메뉴 안에 숨어 있을 때보다 짧다.
 */
export function MobileTabBar() {
  const unread = useUnreadCount()
  const { hasPermission, isAdmin } = useAuth()
  const { openAssignments } = useData()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const items = MOBILE_NAV.filter((item) => !item.permission || hasPermission(item.permission))
  const allItems = MAIN_NAV.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.permission || hasPermission(item.permission)),
  )
  // 탭에 없는 화면에 있을 때는 전체 메뉴 쪽을 켜 둔다. 지금 보는 화면이 어디에서
  // 왔는지 탭바만 보고도 알 수 있어야 한다.
  const moreActive = !items.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  )

  return (
    <>
      <nav
        aria-label="주요 학습 메뉴"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-950"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <ul className="flex">
          {items.map((item) => (
            <li key={item.to} className="min-w-0 flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                    isActive
                      ? 'text-brand-600 dark:text-brand-300'
                      : 'text-slate-500 dark:text-slate-400',
                  )
                }
              >
                <Icon name={item.icon} size={22} />
                {item.label}
              </NavLink>
            </li>
          ))}

          <li className="min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className={cn(
                'flex min-h-14 w-full flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
                moreActive
                  ? 'text-brand-600 dark:text-brand-300'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {/* 알림과 배정은 전체 메뉴 안으로 들어갔다. 읽지 않은 것이 있으면
                  메뉴를 열어 보기 전에도 알 수 있게 점만 찍어 둔다. */}
              <span className="relative">
                <Icon name="menu" size={22} />
                {(unread > 0 || openAssignments > 0) && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />
                )}
              </span>
              전체 메뉴
            </button>
          </li>
        </ul>
      </nav>

      {menuOpen && (
        <Modal title="전체 메뉴" onClose={() => setMenuOpen(false)}>
          <nav aria-label="전체 메뉴" className="grid grid-cols-2 gap-2">
            {allItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    MENU_ITEM_CLASS,
                    isActive &&
                      'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200',
                  )
                }
              >
                <Icon name={item.icon} size={20} />
                <span className="min-w-0 truncate">{item.label}</span>
                {item.to === '/assignments' && openAssignments > 0 && (
                  <span className="ml-auto rounded-full bg-brand-600 px-1.5 text-[10px] leading-4 text-white">
                    {openAssignments}
                  </span>
                )}
              </NavLink>
            ))}

            <NavLink
              to="/notifications"
              onClick={() => setMenuOpen(false)}
              className={MENU_ITEM_CLASS}
            >
              <Icon name="bell" size={20} />
              <span className="min-w-0 truncate">알림</span>
              {unread > 0 && (
                <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] leading-4 text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
            <NavLink to="/me" onClick={() => setMenuOpen(false)} className={MENU_ITEM_CLASS}>
              <Icon name="user" size={20} />
              <span className="min-w-0 truncate">마이페이지</span>
            </NavLink>
            <NavLink to="/profiles" onClick={() => setMenuOpen(false)} className={MENU_ITEM_CLASS}>
              <Icon name="user" size={20} />
              <span className="min-w-0 truncate">프로필 보기</span>
            </NavLink>
          </nav>
        </Modal>
      )}
    </>
  )
}
