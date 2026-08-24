import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { subjectVisual } from '@/lib/subjectVisual'
import { fetchAllTopicCounts } from '@/lib/queries/topics'
import {
  fetchLatestAnnouncement,
  type AnnouncementPreview,
} from '@/lib/queries/notifications'
import { richTextToPlain } from '@/types/richtext'
import { cn } from '@/utils/cn'

const SCOPE = 'study_legendob'
const NEW_NOTICE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * 테마 첫 화면. 과목을 고르는 자리다.
 *
 * 이론 보기와 나란히 있지만 성격이 다르다. 이론은 Notion 에서 임포트한 교과
 * 정리이고, 테마는 스터디원이 주제 단위로 직접 쓰고 야마를 붙이는 글이다.
 */
export function TopicIndexPage() {
  const { taxonomy, loading: taxonomyLoading } = useData()
  const { isAdmin, hasPermission } = useAuth()
  const canUse = isAdmin || hasPermission('study_legendob')

  const [counts, setCounts] = useState<Map<string, number> | null>(null)
  const [latestNotice, setLatestNotice] = useState<AnnouncementPreview | null | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [openedAt] = useState(Date.now)

  useEffect(() => {
    if (!canUse) return
    let active = true
    void Promise.all([fetchAllTopicCounts(), fetchLatestAnnouncement(SCOPE)])
      .then(([rows, notice]) => {
        if (active) {
          setCounts(rows)
          setLatestNotice(notice)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '주제를 불러오지 못했습니다.')
          setCounts(new Map())
          setLatestNotice(null)
        }
      })
    return () => {
      active = false
    }
  }, [canUse])

  if (!canUse) return <Navigate to="/study" replace />

  if (taxonomyLoading || counts === null || latestNotice === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  const noticePreview = latestNotice ? richTextToPlain(latestNotice.content) : ''
  const noticeCreatedAt = latestNotice ? new Date(latestNotice.createdAt).getTime() : Number.NaN
  const isNewNotice = Number.isFinite(noticeCreatedAt)
    && openedAt - noticeCreatedAt >= 0
    && openedAt - noticeCreatedAt < NEW_NOTICE_MS

  return (
    <section>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">레전드옵세스터디</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          레전드로옵세시브한그들.
        </p>
      </header>

      <Link
        to="/topics/notices"
        className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 transition-colors hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/30"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
          <Icon name="megaphone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            공지사항
            {isNewNotice && (
              <span
                title="최근 3일 이내 등록된 공지"
                aria-label="새 공지"
                className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-rose-500 px-1 text-[10px] font-bold leading-none text-white"
              >
                N
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate font-semibold">
            {latestNotice?.title ?? '등록된 공지가 없습니다.'}
          </span>
          {latestNotice && (
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              {noticePreview || '본문 내용이 없습니다.'}
            </span>
          )}
        </span>
        <Icon name="chevron-right" size={18} className="text-slate-400" />
      </Link>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(taxonomy?.subjects ?? []).map((subject) => {
            const visual = subjectVisual(subject)
            return (
            <li key={subject.id}>
              <Link
                to={`/topics/${subject.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', visual.tint)}>
                  <Icon name={visual.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{subject.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    주제 {counts.get(subject.id) ?? 0}개
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="text-slate-400" />
              </Link>
            </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
