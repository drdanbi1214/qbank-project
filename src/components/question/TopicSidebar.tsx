import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import type { Unit } from '@/lib/queries/taxonomy'
import type { Topic } from '@/lib/queries/topics'
import { richTextToPlain } from '@/types/richtext'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  topics: Topic[] | null
  subjectId: string
  /** 지금 열려 있는 테마 */
  topicId: string | undefined
  /** 이 과목의 단원. taxonomy 순서 그대로 넘긴다. */
  units: Unit[]
  /** 그 단원에 새 주제를 만든다. 없으면 만들기 버튼을 내지 않는다. */
  onNewTopic?: (unitId: string | null) => void
}

/** 대표 단원이 없는 테마를 모으는 자리. 단원 id 와 겹치지 않는 값이면 된다. */
const NO_UNIT = ''

/**
 * 테마 목록.
 *
 * 큰 주제(단원)로 묶어 접었다 펴고, 위쪽 검색으로 제목과 본문을 함께 훑는다.
 * 검색 중에는 묶음을 풀고 결과만 늘어놓는다 — 어느 단원에 있었는지보다
 * 찾았는지가 먼저다.
 */
export function TopicSidebar({ topics, subjectId, topicId, units, onNewTopic }: Props) {
  const [keyword, setKeyword] = useState('')
  // 사람이 직접 접거나 편 것만 담는다. 손대지 않은 단원은 아래 규칙대로 열린다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const searching = keyword.trim() !== ''

  const matched = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (needle === '') return topics ?? []
    return (topics ?? []).filter(
      (row) =>
        row.title.toLowerCase().includes(needle) ||
        richTextToPlain(row.content).toLowerCase().includes(needle),
    )
  }, [topics, keyword])

  /**
   * 단원 순서대로 묶는다.
   *
   * 아직 아무도 안 쓴 단원도 내보낸다. 빈 것을 감추면 목차가 쓴 만큼만 보여서
   * 무엇이 남았는지 알 수 없다. 전체 지도가 보여야 빈 자리를 채우러 간다.
   * 다만 찾는 중에는 뺀다 — 결과가 없는 줄이 끼면 훑기가 어렵다.
   */
  const groups = useMemo(() => {
    const byUnit = new Map<string, Topic[]>()
    for (const row of matched) {
      const key = row.unitId ?? NO_UNIT
      const bucket = byUnit.get(key)
      if (bucket) bucket.push(row)
      else byUnit.set(key, [row])
    }
    for (const bucket of byUnit.values()) {
      bucket.sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true }))
    }

    const ordered: { key: string; name: string; rows: Topic[] }[] = []
    for (const unit of units) {
      const rows = byUnit.get(unit.id)
      if (rows) ordered.push({ key: unit.id, name: unit.name, rows })
      else if (!searching) ordered.push({ key: unit.id, name: unit.name, rows: [] })
    }
    // 단원이 없는 테마는 맨 아래로 몰아 둔다. 이 자리는 비면 내보내지 않는다 —
    // 단원과 달리 채워야 할 칸이 아니라 분류가 덜 된 것들이 잠깐 머무는 곳이다.
    const loose = byUnit.get(NO_UNIT)
    if (loose) ordered.push({ key: NO_UNIT, name: '단원 없음', rows: loose })
    return ordered
  }, [matched, units, searching])

  const selectedUnit = useMemo(
    () => (topics ?? []).find((row) => row.id === topicId)?.unitId ?? NO_UNIT,
    [topics, topicId],
  )

  if (topics === null) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  return (
    <nav className="h-fit space-y-1 rounded-xl border border-slate-300 bg-white p-2.5 shadow-sm dark:border-slate-600 dark:bg-slate-900 md:sticky md:top-20">
      <div className="flex items-center justify-between px-1 pb-1">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">목차</h2>
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {(topics ?? []).length}개 글
        </span>
      </div>
      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="주제 찾기 (제목·본문)"
        className="mb-2 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-brand-500 focus:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
      />

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          이 과목은 아직 단원도 주제도 없습니다.
        </p>
      ) : matched.length === 0 && searching ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          "{keyword.trim()}" 에 맞는 주제가 없습니다.
        </p>
      ) : (
        groups.map((group) => {
          const empty = group.rows.length === 0
          // 아직 테마를 안 골랐으면 전부 펼쳐 두고, 고른 뒤에는 그 테마가 든
          // 단원만 남긴다. 사람이 직접 접거나 편 단원은 그 선택을 따른다.
          const natural = topicId === undefined || group.key === selectedUnit
          // 빈 단원은 펼쳐 봐야 나올 것이 없어 늘 접어 둔다.
          // 검색 중에는 접힌 단원 때문에 결과를 놓치지 않도록 전부 펼친다.
          const open = !empty && (searching || (toggled[group.key] ?? natural))
          return (
            <div key={group.key}>
              <div className="group/unit flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={empty && !onNewTopic}
                  onClick={() => {
                    if (empty) {
                      onNewTopic?.(group.key === NO_UNIT ? null : group.key)
                      return
                    }
                    setToggled((previous) => ({ ...previous, [group.key]: !open }))
                  }}
                  title={empty ? `${group.name}에 첫 글 작성` : undefined}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm font-semibold transition-colors',
                    empty
                      ? onNewTopic
                        ? 'border border-dashed border-slate-300 text-slate-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-600 dark:hover:bg-brand-950/30 dark:hover:text-brand-200'
                        : 'cursor-default text-slate-500 dark:text-slate-500'
                      : 'text-slate-800 hover:bg-slate-100 hover:text-brand-700 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-brand-200',
                  )}
                >
                  <span className="w-3 shrink-0 text-[10px]">
                    {empty ? '＋' : open ? '▼' : '▶'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="shrink-0 tabular-nums text-xs">{group.rows.length}</span>
                </button>
                {onNewTopic && (
                  <button
                    type="button"
                    // 단원 줄에서 바로 만들면 어느 단원에 넣을지 다시 고를 일이 없다.
                    onClick={() => onNewTopic(group.key === NO_UNIT ? null : group.key)}
                    aria-label={`${group.name}에 새 주제`}
                    title={`${group.name}에 새 주제`}
                    className={cn(
                      'shrink-0 rounded px-1.5 py-1 text-xs text-slate-500 transition-opacity hover:bg-slate-100 hover:text-brand-600 focus-visible:opacity-100 dark:text-slate-400 dark:hover:bg-slate-800',
                      empty ? 'opacity-100' : 'opacity-0 group-hover/unit:opacity-100',
                    )}
                  >
                    ＋
                  </button>
                )}
              </div>

              {open && (
                <div className="space-y-0.5 pl-2">
                  {group.rows.map((row) => (
                    <Link
                      key={row.id}
                      to={`/topics/${subjectId}/${row.id}`}
                      className={cn(
                        'block rounded-lg px-3 py-1.5 text-sm transition-colors',
                        row.id === topicId
                          ? 'bg-brand-100 font-semibold text-brand-800 ring-1 ring-brand-200 dark:bg-brand-900/50 dark:text-brand-100 dark:ring-brand-800'
                          : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white',
                      )}
                    >
                      <span className="block truncate">{row.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                        {formatShortDate(row.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </nav>
  )
}
