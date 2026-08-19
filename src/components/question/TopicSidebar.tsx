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
export function TopicSidebar({ topics, subjectId, topicId, units }: Props) {
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

  /** 단원 순서대로 묶는다. 테마가 하나도 없는 단원은 내보내지 않는다. */
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
    }
    // 단원이 없는 테마는 맨 아래로 몰아 둔다.
    const loose = byUnit.get(NO_UNIT)
    if (loose) ordered.push({ key: NO_UNIT, name: '단원 없음', rows: loose })
    return ordered
  }, [matched, units])

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
    <nav className="space-y-1">
      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="테마 찾기 (제목·본문)"
        className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
      />

      {topics.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          아직 테마가 없습니다.
        </p>
      ) : matched.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          "{keyword.trim()}" 에 맞는 테마가 없습니다.
        </p>
      ) : (
        groups.map((group) => {
          // 아직 테마를 안 골랐으면 전부 펼쳐 두고, 고른 뒤에는 그 테마가 든
          // 단원만 남긴다. 사람이 직접 접거나 편 단원은 그 선택을 따른다.
          const natural = toggled[group.key] ?? (topicId === undefined || group.key === selectedUnit)
          // 검색 중에는 접힌 단원 때문에 결과를 놓치지 않도록 전부 펼친다.
          const open = searching || natural
          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() =>
                  setToggled((previous) => ({ ...previous, [group.key]: !natural }))
                }
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <span className="w-3 shrink-0 text-[10px]">{open ? '▼' : '▶'}</span>
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{group.rows.length}</span>
              </button>

              {open && (
                <div className="space-y-0.5 pl-2">
                  {group.rows.map((row) => (
                    <Link
                      key={row.id}
                      to={`/topics/${subjectId}/${row.id}`}
                      className={cn(
                        'block rounded-lg px-3 py-1.5 text-sm transition-colors',
                        row.id === topicId
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                      )}
                    >
                      <span className="block truncate">{row.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
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
