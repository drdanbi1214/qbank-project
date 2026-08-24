import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { useAuth } from '@/lib/auth'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { searchQuestions, type SearchHit } from '@/lib/queries/study'
import { searchTopics, type TopicForQuestion } from '@/lib/queries/topics'
import { fetchLectureDocuments, mixLectureHits, type LectureDocument } from '@/lib/queries/lectures'
import { splitLectureSearchText } from '@/lib/lectureSearch'
import { cn } from '@/utils/cn'

/**
 * 검색.
 * 한국어 형태소 분석기가 없어 서버에서 부분 일치와 trgm 유사도를 함께 쓴다.
 * 결과에서는 검색어가 들어간 부분을 굵게 칠해 어디가 맞았는지 보여준다.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const { taxonomy } = useData()
  const { hasPermission } = useAuth()
  const canViewStudySolutions = hasPermission('study_hapbon3')

  const query = params.get('q') ?? ''
  const includeLectures = params.get('lectures') === '1'
  const includeQuestionSearch = !includeLectures
  const includeSolutions =
    includeQuestionSearch && canViewStudySolutions && params.get('scope') === 'all'
  const subjectId = params.get('subject')
  const cohort = params.get('cohort')

  const [input, setInput] = useState(query)
  const [loaded, setLoaded] = useState<{ key: string; hits: SearchHit[] } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  // 테마는 레옵스 전용이라 권한이 있을 때만 찾는다. RLS 도 같은 조건으로 막지만
  // 없는 사람에게 헛조회를 보내지 않는다.
  const canSearchTopics = hasPermission('study_legendob')
  const [topicLoaded, setTopicLoaded] = useState<{
    key: string
    rows: TopicForQuestion[]
  } | null>(null)

  const [lectureLoaded, setLectureLoaded] = useState<{
    key: string
    rows: LectureDocument[]
  } | null>(null)

  const searchTopicsEnabled = canSearchTopics && includeQuestionSearch
  const requestKey = `${query}|${includeSolutions}|${includeLectures}|${subjectId ?? ''}|${cohort ?? ''}`
  const error = failed?.key === requestKey ? failed.message : null

  useEffect(() => {
    if (query.trim() === '') {
      return
    }
    let active = true

    if (includeQuestionSearch) {
      void searchQuestions({
        query,
        includeSolutions,
        subjectId,
        cohort,
      })
        .then((hits) => {
          if (active) {
            setLoaded({ key: requestKey, hits })
            setFailed(null)
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setFailed({
              key: requestKey,
              message: caught instanceof Error ? caught.message : '검색하지 못했습니다.',
            })
          }
        })
    }

    if (includeLectures) {
      // 강의록 분류는 임상 과목과 다른 축이라 과목 거르개를 넘기지 않는다.
      void fetchLectureDocuments({ keyword: query })
        .then((rows) => {
          // 앞에서부터 자르면 제목 일치가 자리를 다 차지해 본문 일치가 사라진다.
          if (active) setLectureLoaded({ key: requestKey, rows: mixLectureHits(rows, query, 30) })
        })
        .catch(() => {
          if (active) setLectureLoaded({ key: requestKey, rows: [] })
        })
    }

    if (searchTopicsEnabled) {
      void searchTopics(query, subjectId)
        .then((rows) => {
          if (active) setTopicLoaded({ key: requestKey, rows })
        })
        .catch(() => {
          if (active) setTopicLoaded({ key: requestKey, rows: [] })
        })
    }

    return () => {
      active = false
    }
  }, [
    query,
    includeSolutions,
    includeLectures,
    includeQuestionSearch,
    subjectId,
    cohort,
    requestKey,
    searchTopicsEnabled,
  ])

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

  // 현재 범위에 필요한 검색이 모두 끝날 때까지 로딩을 유지한다. 특히 느린 강의록
  // 본문 검색 중에 성급하게 "결과 없음"이 보이지 않게 한다.
  const searching =
    query.trim() !== '' &&
    error === null &&
    ((includeQuestionSearch && loaded?.key !== requestKey) ||
      (includeLectures && lectureLoaded?.key !== requestKey) ||
      (searchTopicsEnabled && topicLoaded?.key !== requestKey))
  const hits = includeQuestionSearch && loaded?.key === requestKey ? loaded.hits : []
  const topicHits = searchTopicsEnabled && topicLoaded?.key === requestKey ? topicLoaded.rows : []
  // 검색어나 조건이 바뀌면 이전 강의록 결과가 잠깐 남지 않게 열쇠로 잠근다.
  const lectureHits = lectureLoaded?.key === requestKey ? lectureLoaded.rows : []

  function submit(event: FormEvent) {
    event.preventDefault()
    update({ q: input.trim() })
  }

  const changeScope = useCallback(
    (target: 'problems' | 'all' | 'lectures') => {
      if (target === 'lectures') {
        update({ lectures: '1' })
        return
      }
      update({
        lectures: null,
        scope: target === 'all' ? 'all' : null,
      })
    },
    [update],
  )

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
          placeholder="문제·풀이·강의록 내용을 검색하세요"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit" disabled={searching || input.trim() === ''}>
          {searching && (
            <Spinner className="h-4 w-4 border-white/40 border-t-white dark:border-white/40 dark:border-t-white" />
          )}
          {searching ? '검색 중…' : '검색'}
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="검색 범위"
          className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
        >
          <ScopeButton
            active={includeQuestionSearch && !includeSolutions}
            onClick={() => changeScope('problems')}
          >
            문제만
          </ScopeButton>
          {canViewStudySolutions && (
            <ScopeButton
              active={includeQuestionSearch && includeSolutions}
              onClick={() => changeScope('all')}
            >
              문제 + 풀이
            </ScopeButton>
          )}
          <ScopeButton
            active={includeLectures}
            onClick={() => changeScope('lectures')}
          >
            강의록만
          </ScopeButton>
        </div>

        <select
          value={subjectId ?? ''}
          onChange={(event) => update({ subject: event.target.value || null })}
          disabled={!includeQuestionSearch}
          className={cn(selectClass, !includeQuestionSearch && 'cursor-not-allowed opacity-45')}
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
          disabled={!includeQuestionSearch}
          className={cn(selectClass, !includeQuestionSearch && 'cursor-not-allowed opacity-45')}
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
      ) : hits.length === 0 && topicHits.length === 0 && lectureHits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">검색 결과가 없습니다.</p>
        </div>
      ) : (
        <>
          {/* 테마는 문제보다 위에 둔다. 개념을 찾는 사람에게는 이쪽이 먼저다. */}
          {topicHits.length > 0 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                레옵스 주제 {topicHits.length}개
              </h2>
              <ul className="space-y-2">
                {topicHits.map((topic) => (
                  <li key={topic.id}>
                    <Link
                      to={`/topics/${topic.subjectId}/${topic.id}`}
                      className="block rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 transition-colors hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/20"
                    >
                      <span className="font-medium">{topic.title}</span>
                      {topic.preview !== '' && (
                        <span className="mt-1 line-clamp-2 block text-sm text-slate-600 dark:text-slate-300">
                          {topic.preview}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lectureHits.length > 0 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                강의록 {lectureHits.length}개
              </h2>
              <ul className="space-y-2">
                {lectureHits.map((lecture) => (
                  <li key={lecture.id}>
                    <a
                      href={lectureLink(lecture, query)}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 transition-colors hover:border-indigo-400 dark:border-indigo-900 dark:bg-indigo-950/20"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {lecture.title}
                        </span>
                        {lecture.professor && (
                          <span className="text-slate-400">{lecture.professor}</span>
                        )}
                        {lecture.matchPage !== null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {lecture.matchPage}쪽
                            {lecture.matchPageCount > 1 && ` 외 ${lecture.matchPageCount - 1}쪽`}
                          </span>
                        )}
                      </div>
                      {lecture.matchSnippet && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                          <LectureHighlighted text={lecture.matchSnippet} query={query} />
                        </p>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hits.length > 0 && (
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              문제 {hits.length}개를 찾았습니다.
            </p>
          )}
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

/** 일치한 쪽으로 바로 열고, 뷰어가 그 자리에서 검색어를 칠하게 한다. */
function lectureLink(lecture: LectureDocument, query: string): string {
  const search = new URLSearchParams()
  if (lecture.matchPage !== null) search.set('page', String(lecture.matchPage))
  if (query.trim() !== '') search.set('q', query.trim())
  const tail = search.toString()
  return `/lectures/${lecture.id}${tail === '' ? '' : `?${tail}`}`
}

/** 강의록은 여러 낱말 AND 검색이므로 일치한 낱말을 각각 표시한다. */
function LectureHighlighted({ text, query }: { text: string; query: string }) {
  const parts = splitLectureSearchText(text, query)
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
      aria-pressed={active}
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

/** 문제·선지·풀이도 여러 낱말과 공백이 갈라진 일치를 각각 표시한다. */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const parts = splitLectureSearchText(text, needle)

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
