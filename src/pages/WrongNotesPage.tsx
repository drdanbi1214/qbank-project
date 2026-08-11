import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import {
  fetchBookmarkedQuestions,
  fetchWrongNotes,
  startSession,
  type BookmarkedQuestion,
  type WrongNote,
} from '@/lib/queries/study'
import { downloadCsv } from '@/utils/download'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Tab = 'wrong' | 'bookmark'
type Sort = 'recent' | 'repeated'

export function WrongNotesPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { taxonomy } = useData()
  const userId = session?.user.id ?? ''

  const [tab, setTab] = useState<Tab>('wrong')
  const [sort, setSort] = useState<Sort>('recent')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState<string | null>(null)
  const [cohort, setCohort] = useState<string | null>(null)
  const [examId, setExamId] = useState<string | null>(null)

  const [loaded, setLoaded] = useState<{
    key: string
    wrong: WrongNote[]
    bookmarks: BookmarkedQuestion[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const requestKey = [subjectId ?? '', unitId ?? '', examId ?? '', cohort ?? ''].join('|')

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const [wrong, bookmarks] = await Promise.all([
          fetchWrongNotes({ subjectId, unitId, examId, cohort }),
          fetchBookmarkedQuestions(),
        ])
        if (!active) return
        setLoaded({ key: requestKey, wrong, bookmarks })
        setError(null)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [subjectId, unitId, examId, cohort, requestKey])

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, subjectName)
    },
    [taxonomy],
  )

  const unitNameOf = useCallback(
    (id: string | null) => (id ? (taxonomy?.unitById.get(id)?.name ?? '미분류') : '미분류'),
    [taxonomy],
  )

  const ready = loaded?.key === requestKey
  const cohorts = useMemo(
    () => [...new Set((taxonomy?.exams ?? []).map((exam) => exam.cohort))].sort(),
    [taxonomy],
  )
  const units = useMemo(
    () => (taxonomy?.units ?? []).filter((unit) => !subjectId || unit.subjectId === subjectId),
    [taxonomy, subjectId],
  )
  const exams = useMemo(
    () =>
      (taxonomy?.exams ?? []).filter(
        (exam) =>
          (!subjectId || exam.subjectId === subjectId) && (!cohort || exam.cohort === cohort),
      ),
    [taxonomy, subjectId, cohort],
  )

  const wrongNotes = useMemo(() => {
    const rows = ready ? [...loaded.wrong] : []
    return rows.sort((a, b) =>
      sort === 'repeated'
        ? b.wrongCount - a.wrongCount || b.lastAttemptAt.localeCompare(a.lastAttemptAt)
        : b.lastAttemptAt.localeCompare(a.lastAttemptAt),
    )
  }, [ready, loaded, sort])

  const bookmarks = ready ? loaded.bookmarks : []

  async function retry(questionIds: string[], mode: 'wrong_only' | 'bookmark') {
    if (questionIds.length === 0 || busy) return
    setBusy(true)
    try {
      const id = await startSession({
        userId,
        mode,
        scope: { subject_id: subjectId, unit_id: unitId, exam_id: examId, cohort },
        questionIds,
      })
      navigate(`/solve?session=${id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '세션을 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  /** 문제집 인쇄 화면으로 넘길 주소. 지금 걸린 필터를 그대로 넘긴다. */
  function printLink() {
    const next = new URLSearchParams()
    next.set('source', tab === 'wrong' ? 'wrong' : 'bookmark')
    if (tab === 'wrong') {
      if (subjectId) next.set('subject', subjectId)
      if (unitId) next.set('unit', unitId)
      if (examId) next.set('exam', examId)
      if (cohort) next.set('cohort', cohort)
    }
    return `/print?${next.toString()}`
  }

  function exportCsv() {
    if (tab === 'wrong') {
      downloadCsv('오답노트', [
        ['시험', '문항', '단원', '틀린 횟수', '총 시도', '최근 시도', '최근 3회 연속 오답', '본문'],
        ...wrongNotes.map((row) => [
          examLabelOf(row.examId),
          row.questionNumber,
          unitNameOf(row.unitId),
          row.wrongCount,
          row.totalAttempts,
          formatShortDate(row.lastAttemptAt),
          row.recentAllWrong ? 'O' : '',
          row.stemText ?? '',
        ]),
      ])
      return
    }
    downloadCsv('북마크', [
      ['시험', '문항', '단원', '추가일', '본문'],
      ...bookmarks.map((row) => [
        examLabelOf(row.examId),
        row.questionNumber,
        unitNameOf(row.unitId),
        formatShortDate(row.createdAt),
        row.stemText ?? '',
      ]),
    ])
  }

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">오답노트</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          틀린 문제와 북마크한 문제를 모아봅니다.
        </p>
      </header>

      <div className="mb-3 flex gap-1 print:hidden">
        <TabButton active={tab === 'wrong'} onClick={() => setTab('wrong')}>
          {`오답 ${wrongNotes.length}`}
        </TabButton>
        <TabButton active={tab === 'bookmark'} onClick={() => setTab('bookmark')}>
          {`북마크 ${bookmarks.length}`}
        </TabButton>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {tab === 'wrong' && (
          <>
            <select
              value={subjectId ?? ''}
              onChange={(event) => {
                setSubjectId(event.target.value || null)
                setUnitId(null)
                setExamId(null)
              }}
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
              value={unitId ?? ''}
              onChange={(event) => setUnitId(event.target.value || null)}
              className={selectClass}
              aria-label="단원"
            >
              <option value="">단원 전체</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>

            <select
              value={cohort ?? ''}
              onChange={(event) => {
                setCohort(event.target.value || null)
                setExamId(null)
              }}
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

            <select
              value={examId ?? ''}
              onChange={(event) => setExamId(event.target.value || null)}
              className={selectClass}
              aria-label="시험"
            >
              <option value="">시험 전체</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {examLabelOf(exam.id)}
                </option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className={selectClass}
              aria-label="정렬"
            >
              <option value="recent">최근 오답순</option>
              <option value="repeated">반복 오답순</option>
            </select>
          </>
        )}

        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            Excel 내보내기
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(printLink())}>
            문제집 PDF
          </Button>
          <Button
            size="sm"
            disabled={busy || (tab === 'wrong' ? wrongNotes.length : bookmarks.length) === 0}
            onClick={() =>
              void retry(
                tab === 'wrong'
                  ? wrongNotes.map((row) => row.questionId)
                  : bookmarks.map((row) => row.questionId),
                tab === 'wrong' ? 'wrong_only' : 'bookmark',
              )
            }
          >
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            재풀이 시작
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {!ready ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : tab === 'wrong' ? (
        wrongNotes.length === 0 ? (
          <Empty text="아직 오답으로 기록된 문제가 없습니다." />
        ) : (
          <ul className="space-y-2">
            {wrongNotes.map((row) => (
              <li key={row.questionId}>
                <Link
                  to={`/solve?question=${row.questionId}`}
                  className={cn(
                    'block rounded-xl border p-3 transition-colors hover:border-brand-400',
                    row.recentAllWrong
                      ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-brand-600 dark:text-brand-300">
                      {examLabelOf(row.examId)} {row.questionNumber}번
                    </span>
                    <span className="text-slate-400">{unitNameOf(row.unitId)}</span>
                    {row.recentAllWrong && (
                      <span className="rounded bg-rose-600 px-1.5 py-0.5 font-semibold text-white">
                        최근 3회 연속 오답
                      </span>
                    )}
                    <span className="ml-auto text-slate-400">
                      {row.wrongCount}회 오답 / {row.totalAttempts}회 시도
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                    {row.stemText ?? '본문 없음'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : bookmarks.length === 0 ? (
        <Empty text="북마크한 문제가 없습니다. 풀이 화면에서 북마크를 눌러보세요." />
      ) : (
        <ul className="space-y-2">
          {bookmarks.map((row) => (
            <li key={row.questionId}>
              <Link
                to={`/solve?question=${row.questionId}`}
                className="block rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-brand-600 dark:text-brand-300">
                    {examLabelOf(row.examId)} {row.questionNumber}번
                  </span>
                  <span className="text-slate-400">{unitNameOf(row.unitId)}</span>
                  <span className="ml-auto text-slate-400">
                    {formatShortDate(row.createdAt)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                  {row.stemText ?? '본문 없음'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TabButton({
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
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}
