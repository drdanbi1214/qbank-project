import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { searchQuestions, type SearchHit } from '@/lib/queries/study'
import { cn } from '@/utils/cn'

/**
 * 검색.
 * 한국어 형태소 분석기가 없어 서버에서 부분 일치와 trgm 유사도를 함께 쓴다.
 * 결과에서는 검색어가 들어간 부분을 굵게 칠해 어디가 맞았는지 보여준다.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const { taxonomy } = useData()

  const query = params.get('q') ?? ''
  const includeSolutions = params.get('scope') === 'all'
  const subjectId = params.get('subject')
  const cohort = params.get('cohort')

  const [input, setInput] = useState(query)
  const [loaded, setLoaded] = useState<{ key: string; hits: SearchHit[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestKey = `${query}|${includeSolutions}|${subjectId ?? ''}|${cohort ?? ''}`

  useEffect(() => {
    if (query.trim() === '') {
      return
    }
    let active = true

    void searchQuestions({ query, includeSolutions, subjectId, cohort })
      .then((hits) => {
        if (active) {
          setLoaded({ key: requestKey, hits })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '검색하지 못했습니다.')
        }
      })

    return () => {
      active = false
    }
  }, [query, includeSolutions, subjectId, cohort, requestKey])

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, subjectName)
    },
    [taxonomy],
  )

  const cohorts = useMemo(
    () => [...new Set((taxonomy?.exams ?? []).map((exam) => exam.cohort))].sort(),
    [taxonomy],
  )

  const searching = query.trim() !== '' && loaded?.key !== requestKey && error === null
  const hits = loaded?.key === requestKey ? loaded.hits : []

  function submit(event: FormEvent) {
    event.preventDefault()
    update({ q: input.trim() })
  }

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">검색</h1>
      </header>

      <form onSubmit={submit} className="mb-3 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="문제 본문이나 풀이 내용을 검색하세요"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit">검색</Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <ScopeButton
            active={!includeSolutions}
            onClick={() => update({ scope: null })}
          >
            문제만
          </ScopeButton>
          <ScopeButton
            active={includeSolutions}
            onClick={() => update({ scope: 'all' })}
          >
            문제 + 풀이
          </ScopeButton>
        </div>

        <select
          value={subjectId ?? ''}
          onChange={(event) => update({ subject: event.target.value || null })}
          className={selectClass}
          aria-label="과목"
        >
          <option value="">과목 전체</option>
          {(taxonomy?.subjects ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>

        <select
          value={cohort ?? ''}
          onChange={(event) => update({ cohort: event.target.value || null })}
          className={selectClass}
          aria-label="학번"
        >
          <option value="">학번 전체</option>
          {cohorts.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : query.trim() === '' ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            찾고 싶은 내용을 입력해주세요.
          </p>
        </div>
      ) : searching ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : hits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">검색 결과가 없습니다.</p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
            {hits.length}개를 찾았습니다.
          </p>
          <ul className="space-y-2">
            {hits.map((hit) => (
              <li key={hit.questionId}>
                <Link
                  to={`/solve?question=${hit.questionId}`}
                  className="block rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-brand-600 dark:text-brand-300">
                      {examLabelOf(hit.examId)} {hit.questionNumber}번
                    </span>
                    <span className="text-slate-400">
                      {hit.unitId
                        ? (taxonomy?.unitById.get(hit.unitId)?.name ?? '미분류')
                        : '미분류'}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {hit.matchedIn}에서 일치
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                    <Highlighted text={hit.snippet ?? hit.stemText ?? ''} needle={query} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1 text-sm font-medium transition-colors',
        active
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
          : 'text-slate-500 dark:text-slate-400',
      )}
    >
      {children}
    </button>
  )
}

/** 검색어와 일치하는 부분을 굵게 표시한다. */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const trimmed = needle.trim()
  if (trimmed === '') return <>{text}</>

  const parts: { text: string; hit: boolean }[] = []
  const lowerText = text.toLowerCase()
  const lowerNeedle = trimmed.toLowerCase()

  let cursor = 0
  while (cursor < text.length) {
    const found = lowerText.indexOf(lowerNeedle, cursor)
    if (found === -1) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (found > cursor) parts.push({ text: text.slice(cursor, found), hit: false })
    parts.push({ text: text.slice(found, found + trimmed.length), hit: true })
    cursor = found + trimmed.length
  }

  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <span key={index} className="rounded bg-amber-200 font-semibold dark:bg-amber-500/40">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}
