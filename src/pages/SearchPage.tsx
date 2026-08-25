import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { useAuth } from '@/lib/auth'
import { PERMISSION } from '@/lib/permissions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { searchQuestions, type SearchHit } from '@/lib/queries/study'
import { fetchLectureDocuments, mixLectureHits, type LectureDocument } from '@/lib/queries/lectures'
import { searchTheoryDocuments, type TheorySearchHit } from '@/lib/queries/theory'
import { includesLectureSearchTerms, splitLectureSearchText } from '@/lib/lectureSearch'
import { cn } from '@/utils/cn'

type SearchSource = 'questions' | 'theory' | 'lectures' | 'notes'
const SEARCH_SOURCE_ORDER: SearchSource[] = ['questions', 'theory', 'lectures', 'notes']

/**
 * 검색.
 * 한국어 형태소 분석기가 없어 서버에서 부분 일치와 trgm 유사도를 함께 쓴다.
 * 결과에서는 검색어가 들어간 부분을 굵게 칠해 어디가 맞았는지 보여준다.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const { taxonomy } = useData()
  const { hasPermission, isAdmin } = useAuth()
  const canViewStudySolutions = isAdmin || hasPermission('study_hapbon3')
  const canSearchNotes =
    isAdmin || hasPermission(PERMISSION.mediprepLectureNotesView)

  const query = params.get('q') ?? ''
  const encodedSources = params.get('sources')
  const legacyDefault = params.get('lectures') === '1' ? 'lectures' : 'questions'
  const selectedSources = new Set(
    (encodedSources ?? legacyDefault)
      .split(',')
      .filter((source): source is SearchSource =>
        SEARCH_SOURCE_ORDER.includes(source as SearchSource),
      ),
  )
  const includeQuestionSearch = selectedSources.has('questions')
  const includeSolutions = includeQuestionSearch && canViewStudySolutions
  const includeTheory = selectedSources.has('theory')
  const includeLectures = selectedSources.has('lectures')
  const includeNotes = selectedSources.has('notes') && canSearchNotes
  const includeLectureSearch = includeLectures || includeNotes
  const selectableSources = SEARCH_SOURCE_ORDER.filter(
    (source) => source !== 'notes' || canSearchNotes,
  )
  const allSourcesSelected = selectableSources.every((source) => selectedSources.has(source))
  const hasSelectedSource =
    includeQuestionSearch || includeTheory || includeLectures || includeNotes
  const subjectId = params.get('subject')
  const cohort = params.get('cohort')

  const [input, setInput] = useState(query)
  const [loaded, setLoaded] = useState<{ key: string; hits: SearchHit[] } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  const [theoryLoaded, setTheoryLoaded] = useState<{
    key: string
    rows: TheorySearchHit[]
  } | null>(null)

  const [lectureLoaded, setLectureLoaded] = useState<{
    key: string
    rows: LectureDocument[]
  } | null>(null)
  const [lectureFailed, setLectureFailed] = useState<{
    key: string
    message: string
  } | null>(null)

  const requestKey = `${query}|${includeQuestionSearch}|${includeSolutions}|${includeTheory}|${includeLectures}|${includeNotes}|${subjectId ?? ''}|${cohort ?? ''}`
  const error = failed?.key === requestKey ? failed.message : null
  const lectureError = lectureFailed?.key === requestKey ? lectureFailed.message : null
  const searchError = [error, lectureError].filter(Boolean).join(' · ') || null

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
            // 실패한 요청도 완료된 것으로 표시해야 다른 범위의 로딩 표시가
            // 영원히 남지 않는다. 오류 문구는 아래 결과 영역에서 따로 보여 준다.
            setLoaded({ key: requestKey, hits: [] })
            setFailed({
              key: requestKey,
              message: caught instanceof Error ? caught.message : '검색하지 못했습니다.',
            })
          }
        })
    }

    if (includeLectureSearch) {
      // 강의록 분류는 임상 과목과 다른 축이라 과목 거르개를 넘기지 않는다.
      void fetchLectureDocuments({ keyword: query })
        .then((rows) => {
          if (active) {
            setLectureLoaded({ key: requestKey, rows })
            setLectureFailed(null)
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setLectureLoaded({ key: requestKey, rows: [] })
            setLectureFailed({
              key: requestKey,
              message: `강의록 검색 실패: ${caughtMessage(caught, '잠시 후 다시 검색해 주세요.')}`,
            })
          }
        })
    }

    if (includeTheory) {
      void searchTheoryDocuments(query, subjectId)
        .then((rows) => {
          if (active) setTheoryLoaded({ key: requestKey, rows })
        })
        .catch(() => {
          if (active) setTheoryLoaded({ key: requestKey, rows: [] })
        })
    }

    return () => {
      active = false
    }
  }, [
    query,
    includeSolutions,
    includeLectures,
    includeNotes,
    includeLectureSearch,
    includeQuestionSearch,
    includeTheory,
    subjectId,
    cohort,
    requestKey,
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

  // 검색 범위마다 끝나는 시간이 다르다. 먼저 끝난 결과는 바로 보여 주되, 아래의
  // pendingSearchLabels 가 남아 있는 동안에는 절대 "결과 없음"으로 단정하지 않는다.
  const pendingSearchLabels = [
    includeQuestionSearch && loaded?.key !== requestKey ? '문제+풀이' : null,
    includeTheory && theoryLoaded?.key !== requestKey ? '알렌' : null,
    includeLectureSearch && lectureLoaded?.key !== requestKey
      ? includeLectures && includeNotes
        ? '강의록·정리본'
        : includeLectures
          ? '강의록'
          : '정리본'
      : null,
  ].filter((label): label is string => label !== null)
  const searching = query.trim() !== '' && pendingSearchLabels.length > 0
  const hits = includeQuestionSearch && loaded?.key === requestKey ? loaded.hits : []
  const theoryHits = includeTheory && theoryLoaded?.key === requestKey ? theoryLoaded.rows : []
  // 검색어나 조건이 바뀌면 이전 강의록 결과가 잠깐 남지 않게 열쇠로 잠근다.
  const lectureRows = lectureLoaded?.key === requestKey ? lectureLoaded.rows : []
  const lectureHits = includeLectures
    ? mixLectureHits(
        lectureRows.filter(
          (lecture) =>
            lecture.matchPage !== null ||
            includesLectureSearchTerms(
              [lecture.title, lecture.professor, lecture.curriculum].filter(Boolean).join(' '),
              query,
            ),
        ),
        query,
        30,
      )
    : []
  const noteHits = includeNotes
    ? lectureRows.filter((lecture) => lecture.noteMatchId !== null).slice(0, 30)
    : []
  const hasSearchResults =
    hits.length > 0 || theoryHits.length > 0 || lectureHits.length > 0 || noteHits.length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    update({ q: input.trim() })
  }

  function toggleSource(source: SearchSource) {
    const next = new Set(selectedSources)
    if (next.has(source)) next.delete(source)
    else next.add(source)
    const value = SEARCH_SOURCE_ORDER.filter((item) => next.has(item)).join(',') || 'none'
    update({ sources: value, lectures: null, scope: null })
  }

  function toggleAllSources() {
    const next = allSourcesSelected ? new Set<SearchSource>() : new Set(selectableSources)
    const value = SEARCH_SOURCE_ORDER.filter((item) => next.has(item)).join(',') || 'none'
    update({ sources: value, lectures: null, scope: null })
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
          placeholder="문제·풀이·알렌·강의록·정리본 내용을 검색하세요"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <Button type="submit" disabled={searching || input.trim() === '' || !hasSelectedSource}>
          {searching && (
            <Spinner className="h-4 w-4 border-white/40 border-t-white dark:border-white/40 dark:border-t-white" />
          )}
          {searching ? '검색 중…' : '검색'}
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="검색 범위" className="flex flex-wrap gap-1.5">
          <SourceCheckbox
            checked={allSourcesSelected}
            onChange={toggleAllSources}
            label="전체"
          />
          <SourceCheckbox
            checked={includeQuestionSearch}
            onChange={() => toggleSource('questions')}
            label="문제+풀이"
          />
          <SourceCheckbox
            checked={includeTheory}
            onChange={() => toggleSource('theory')}
            label="알렌"
          />
          <SourceCheckbox
            checked={includeLectures}
            onChange={() => toggleSource('lectures')}
            label="강의록"
          />
          <SourceCheckbox
            checked={includeNotes}
            disabled={!canSearchNotes}
            onChange={() => toggleSource('notes')}
            label="정리본"
            title={!canSearchNotes ? '요약정리노트 권한이 필요합니다.' : undefined}
          />
        </div>

        <select
          value={subjectId ?? ''}
          onChange={(event) => update({ subject: event.target.value || null })}
          disabled={!includeQuestionSearch && !includeTheory}
          className={cn(
            selectClass,
            !includeQuestionSearch && !includeTheory && 'cursor-not-allowed opacity-45',
          )}
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

      {query.trim() === '' ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            찾고 싶은 내용을 입력해주세요.
          </p>
        </div>
      ) : !hasSelectedSource ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            검색할 범위를 하나 이상 선택해 주세요.
          </p>
        </div>
      ) : searching && !hasSearchResults ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-brand-200 py-10 dark:border-brand-900">
          <Spinner className="h-6 w-6" />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              검색 결과를 찾고 있습니다.
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {pendingSearchLabels.join(' · ')} 검색이 끝날 때까지 잠시 기다려 주세요.
            </p>
          </div>
        </div>
      ) : !hasSearchResults ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {searchError ?? '검색 결과가 없습니다.'}
          </p>
        </div>
      ) : (
        <>
          {searchError && (
            <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              일부 범위를 검색하지 못했습니다: {searchError}
            </p>
          )}
          {theoryHits.length > 0 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                알렌 {theoryHits.length}개
              </h2>
              <ul className="space-y-2">
                {theoryHits.map((theory) => (
                  <li key={theory.id}>
                    <Link
                      to={`/theory/${theory.subjectId}/${theory.id}`}
                      className="block rounded-xl border border-blue-200 bg-blue-50/50 p-3 transition-colors hover:border-blue-400 dark:border-blue-900 dark:bg-blue-950/20"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{theory.title}</span>
                        <span className="text-xs text-slate-400">
                          {taxonomy?.subjectById.get(theory.subjectId)?.name}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-slate-600 dark:text-slate-300">
                        <LectureHighlighted text={theory.snippet} query={query} />
                      </span>
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
                      href={lecturePdfLink(lecture, query)}
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
                          <LectureHighlighted
                            text={lecture.matchSnippet}
                            query={query}
                          />
                        </p>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {noteHits.length > 0 && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                정리본 {noteHits.length}개
              </h2>
              <ul className="space-y-2">
                {noteHits.map((lecture) => (
                  <li key={lecture.id}>
                    <a
                      href={lectureNoteLink(lecture, query)}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 transition-colors hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/20"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {lecture.noteMatchTitle
                            ? cleanLectureNoteTitle(lecture.noteMatchTitle)
                            : lecture.title}
                        </span>
                        <span className="text-slate-400">{lecture.title}</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                          요약정리본
                          {lecture.noteMatchCount > 1 && ` · 외 ${lecture.noteMatchCount - 1}개`}
                        </span>
                      </div>
                      {lecture.noteMatchSnippet && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                          <LectureHighlighted text={lecture.noteMatchSnippet} query={query} />
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

          {searching && (
            <div
              role="status"
              aria-live="polite"
              className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-200"
            >
              <Spinner className="h-5 w-5" />
              <span>
                현재 결과를 먼저 보여드렸습니다. {pendingSearchLabels.join(' · ')}도 계속 검색
                중입니다…
              </span>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function caughtMessage(caught: unknown, fallback: string): string {
  if (caught instanceof Error && caught.message.trim() !== '') return caught.message
  if (caught && typeof caught === 'object' && 'message' in caught) {
    const message = String((caught as { message?: unknown }).message ?? '').trim()
    if (message !== '') return message
  }
  return fallback
}

/** PDF 본문 일치 쪽으로 바로 열고 뷰어가 검색어를 칠하게 한다. */
function lecturePdfLink(lecture: LectureDocument, query: string): string {
  const search = new URLSearchParams()
  if (lecture.matchPage !== null) search.set('page', String(lecture.matchPage))
  if (query.trim() !== '') search.set('q', query.trim())
  const tail = search.toString()
  return `/lectures/${lecture.id}${tail === '' ? '' : `?${tail}`}`
}

/** 정리본 일치 구획으로 바로 열고 오른쪽 패널에서 검색어를 칠한다. */
function lectureNoteLink(lecture: LectureDocument, query: string): string {
  const search = new URLSearchParams({ view: 'notes' })
  if (lecture.noteMatchId) search.set('note', lecture.noteMatchId)
  if (query.trim() !== '') search.set('nq', query.trim())
  return `/lectures/${lecture.id}?${search.toString()}`
}

function cleanLectureNoteTitle(title: string): string {
  return title.replace(
    /^(?:📝\s*)?시험\s*대비\s*요점\s*정리\s*[:：]\s*/u,
    '',
  )
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

function SourceCheckbox({
  checked,
  disabled = false,
  onChange,
  label,
  title,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
  title?: string
}) {
  return (
    <label
      title={title}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors',
        checked
          ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
          : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:border-brand-400',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 accent-brand-600"
      />
      {label}
    </label>
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
