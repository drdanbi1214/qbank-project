import { useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Icon } from '@/components/ui/Icon'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

/**
 * 학습 화면 셸. 웹은 좌측 사이드바(과목 -> 단원 트리) + 우측 콘텐츠,
 * 모바일은 사이드바를 드로어로 전환한다.
 */
export function StudyLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { taxonomy, loading, subjectProgress, unitProgress } = useData()
  const params = useParams()
  const [expanded, setExpanded] = useState<string | null>(params.subjectId ?? null)

  const activeSubject = params.subjectId ?? expanded

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header showDrawerButton onOpenDrawer={() => setDrawerOpen(true)} />

      <div className="mx-auto flex max-w-7xl">
        <Sidebar title="과목" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !taxonomy || taxonomy.subjects.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              등록된 과목이 없습니다.
            </p>
          ) : (
            <ul className="space-y-1">
              {taxonomy.subjects.map((subject) => {
                const units = taxonomy.units.filter((unit) => unit.subjectId === subject.id)
                const isOpen = activeSubject === subject.id

                return (
                  <li key={subject.id}>
                    <div className="flex items-center gap-1">
                      <NavLink
                        to={`/study/${subject.id}`}
                        onClick={() => {
                          setExpanded(subject.id)
                          setDrawerOpen(false)
                        }}
                        className={({ isActive }) =>
                          cn(
                            'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                          )
                        }
                      >
                        <span className="truncate">{subject.name}</span>
                        <ProgressBadge
                          progress={subjectProgress(subject.id)}
                          showAccuracy={false}
                        />
                      </NavLink>
                      <button
                        type="button"
                        aria-label={isOpen ? '단원 접기' : '단원 펼치기'}
                        onClick={() => setExpanded(isOpen ? null : subject.id)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Icon
                          name="chevron-right"
                          size={16}
                          className={cn('transition-transform', isOpen && 'rotate-90')}
                        />
                      </button>
                    </div>

                    {isOpen && units.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {units.map((unit) => (
                          <li key={unit.id}>
                            <NavLink
                              to={`/study/${subject.id}/${unit.id}`}
                              onClick={() => setDrawerOpen(false)}
                              className={({ isActive }) =>
                                cn(
                                  'flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                                  isActive
                                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                                )
                              }
                            >
                              <span className="truncate">{unit.name}</span>
                              <ProgressBadge
                                progress={unitProgress(unit.id)}
                                showAccuracy={false}
                              />
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Sidebar>

        <main className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-4 lg:pb-10">
          <Outlet />
        </main>
      </div>

      <MobileTabBar />
    </div>
  )
}
