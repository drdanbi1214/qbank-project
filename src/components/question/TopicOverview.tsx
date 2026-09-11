import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import type { Unit } from '@/lib/queries/taxonomy'
import type { Topic } from '@/lib/queries/topics'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  /** 아직 받아오는 중이면 null */
  topics: Topic[] | null
  /** 이 과목의 단원. taxonomy 순서 그대로 넘긴다. */
  units: Unit[]
  subjectId: string
  /** 그 단원에 새 주제를 만든다. 없으면 만들기 버튼을 내지 않는다. */
  onNewTopic?: (unitId: string | null) => void
}

/** 대표 단원이 없는 테마를 모으는 자리. TopicSidebar 와 같은 규칙이다. */
const NO_UNIT = ''

/**
 * 과목만 고르고 아직 글은 고르지 않았을 때 가운데에 펼치는 전체 목차.
 *
 * 예전에는 "왼쪽에서 주제를 고르세요" 한 줄만 놓았다. 과목에 처음 들어온
 * 사람에게는 그 과목에 무엇이 쌓여 있는지가 먼저 보여야 한다. 왼쪽 목차는
 * 폭이 좁아 제목이 잘리는데, 여기서는 단원별로 넓게 늘어놓을 수 있다.
 * 하나를 고르면 그 자리에 글이 들어서고 목차는 왼쪽에만 남는다.
 */
export function TopicOverview({ topics, units, subjectId, onNewTopic }: Props) {
  const byUnit = new Map<string, Topic[]>()
  for (const row of topics ?? []) {
    const key = row.unitId ?? NO_UNIT
    const bucket = byUnit.get(key)
    if (bucket) bucket.push(row)
    else byUnit.set(key, [row])
  }
  for (const bucket of byUnit.values()) {
    bucket.sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true }))
  }

  // 빈 단원도 내보낸다. 쓴 만큼만 보이면 무엇이 남았는지 알 수 없다.
  const groups: { key: string; name: string; rows: Topic[] }[] = units.map((unit) => ({
    key: unit.id,
    name: unit.name,
    rows: byUnit.get(unit.id) ?? [],
  }))
  const loose = byUnit.get(NO_UNIT)
  if (loose) groups.push({ key: NO_UNIT, name: '단원 없음', rows: loose })

  if (topics === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        이 과목은 아직 단원도 주제도 없습니다.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
      <header className="mb-3 border-b border-slate-200 pb-3 dark:border-slate-700">
        <h2 className="text-xl font-bold tracking-tight">전체 목차</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          글 {topics.length}개 · 단원 {units.length}개. 읽을 글을 고르면 이 자리에 펼쳐집니다.
        </p>
      </header>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.key} className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-sky-900 dark:text-sky-200">
                {group.name}
              </h3>
              <span className="shrink-0 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                {group.rows.length}
              </span>
              {onNewTopic && (
                <button
                  type="button"
                  onClick={() => onNewTopic(group.key === NO_UNIT ? null : group.key)}
                  aria-label={`${group.name}에 새 주제`}
                  title={`${group.name}에 새 주제`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  ＋
                </button>
              )}
            </div>

            {group.rows.length === 0 ? (
              <p className="mt-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                아직 글이 없습니다.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={`/topics/${subjectId}/${row.id}`}
                      className={cn(
                        'flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                        'text-slate-700 hover:bg-sky-50 hover:text-sky-800 dark:text-slate-200 dark:hover:bg-sky-950/40 dark:hover:text-sky-200',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                        {formatShortDate(row.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
