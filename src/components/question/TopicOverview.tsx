import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import type { Unit } from '@/lib/queries/taxonomy'
import type { Topic } from '@/lib/queries/topics'
import { formatShortDate } from '@/utils/date'

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
 * 과목에 처음 들어오면 무엇이 쌓였는지를 넓은 한 줄 목록으로 보여 준다.
 * 좌측 목차는 빠른 이동용으로만 두고, 여기서는 긴 단원명·글 수·작성일을
 * 같은 열에 맞춰 읽을 수 있게 한다. 하나를 고르면 이 자리에 글이 들어선다.
 */
export function TopicOverview({ topics, units, subjectId, onNewTopic }: Props) {
  if (topics === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const byUnit = new Map<string, Topic[]>()
  for (const row of topics) {
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

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        이 과목은 아직 단원도 주제도 없습니다.
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-baseline justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
        <h2 className="text-xl font-bold tracking-tight">전체 목차</h2>
        <p className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
          글 {topics.length}개 · 주제 {units.length}개
        </p>
      </header>

      <ol className="divide-y divide-slate-200 dark:divide-slate-700">
        {groups.map((group, index) => (
          <li key={group.key} className="py-4">
            <section className="min-w-0">
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3">
                <span className="tabular-nums text-xs text-slate-400 dark:text-slate-500">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="min-w-0 text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                  {group.name}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                    {group.rows.length}글
                  </span>
                  {onNewTopic && (
                    <button
                      type="button"
                      onClick={() => onNewTopic(group.key === NO_UNIT ? null : group.key)}
                      aria-label={`${group.name}에 새 주제`}
                      title={`${group.name}에 새 주제`}
                      className="rounded px-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:text-slate-500 dark:hover:bg-slate-800"
                    >
                      ＋
                    </button>
                  )}
                </div>
              </div>

              {group.rows.length === 0 ? (
                <p className="mt-2 pl-11 text-sm text-slate-500 dark:text-slate-400">
                  아직 작성한 풀이가 없습니다.
                </p>
              ) : (
                <ul className="mt-2 space-y-0.5 pl-11">
                  {group.rows.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={`/topics/${subjectId}/${row.id}`}
                        className="flex items-baseline gap-3 rounded-md py-1 text-sm text-slate-700 transition-colors hover:text-sky-800 dark:text-slate-200 dark:hover:text-sky-200"
                      >
                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                        <span className="min-w-0 flex-1 font-medium">{row.title}</span>
                        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                          {formatShortDate(row.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
        ))}
      </ol>
    </div>
  )
}
