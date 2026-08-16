import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { BRAND_NAME, BrandMark } from '@/components/ui/BrandMark'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { MAIN_NAV } from '@/lib/navigation'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

type HeaderProps = {
  onOpenDrawer?: () => void
  showDrawerButton?: boolean
}

export function Header({ onOpenDrawer, showDrawerButton = false }: HeaderProps) {
  const { profile, isAdmin, hasPermission, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { openAssignments } = useData()

  const items = MAIN_NAV.filter(
    (item) => (!item.adminOnly || isAdmin) && (!item.permission || hasPermission(item.permission)),
  )

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-4">
        {showDrawerButton && (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="메뉴 열기"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Icon name="menu" />
          </button>
        )}

        <NavLink to="/study" className="flex shrink-0 items-center gap-2">
          <BrandMark className="h-8 w-8 text-sm" />
          <span className="hidden font-brand text-lg sm:inline">{BRAND_NAME}</span>
        </NavLink>

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              {item.label}
              {item.to === '/assignments' && openAssignments > 0 && (
                <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-[10px] leading-4 text-white">
                  {openAssignments}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <NotificationBell />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Avatar path={profile?.avatar_url} name={profile?.display_name} size={28} />
              <span className="hidden max-w-28 truncate sm:inline">
                {profile?.display_name ?? '사용자'}
              </span>
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="메뉴 닫기"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {profile?.email}
                  </div>

                  {/* 좁은 화면에서는 상단 네비게이션이 숨겨지므로 전체 메뉴를 여기서 제공한다. */}
                  <div className="border-y border-slate-200 py-1 lg:hidden dark:border-slate-700">
                    {items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Icon name={item.icon} size={16} />
                        {item.label}
                        {item.to === '/assignments' && openAssignments > 0 && (
                          <span className="ml-auto rounded-full bg-brand-600 px-1.5 text-[10px] leading-4 text-white">
                            {openAssignments}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>

                  <NavLink
                    to="/me"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    마이페이지
                  </NavLink>
                  <NavLink
                    to="/profiles"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    프로필 보기
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-slate-100 dark:text-rose-400 dark:hover:bg-slate-800"
                  >
                    <Icon name="logout" size={16} />
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
