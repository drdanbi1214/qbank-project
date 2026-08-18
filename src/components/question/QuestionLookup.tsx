import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { StemBlocks } from '@/components/question/StemBlocks'
import { findQuestionById, findQuestionInExam, type LookupResult } from '@/lib/queries/clusters'
import { searchQuestions, type SearchHit } from '@/lib/queries/study'
import type { Exam } from '@/lib/queries/taxonomy'

type Props = {
  exams: Exam[]
  /** 이 과목의 시험만 후보로 둔다. null 이면 전체 */
  subjectId: string | null
  /** 후보에서 뺄 시험 (기준 문제가 있는 시험 등) */
  excludeExamId?: string
  /** 이 문제를 고르면 거부한다 */
  excludeQuestionId?: string
  /** 이미 야마로 묶인 문제를 거부할지. 클러스터에 붙일 때만 켠다. */
  rejectGrouped?: boolean
  examLabelOf: (examId: string) => string
  confirmLabel: string
  onPick: (found: LookupResult) => void
  onCancel: () => void
}

/**
 * 학번 · 시험 · 번호로 문제를 찾고, 확정 전에 전문을 한 번 보여준다.
 *
 * 자동 유사도 매칭을 쓰지 않기로 했으므로 오류원은 사람의 입력 실수뿐이다.
 * 클릭을 한 번 더 받는 대신 엉뚱한 문제가 붙는 사고를 막는다.
 *
 * 클러스터 묶기와 테마 야마 삽입이 같은 흐름을 쓴다.
 */
export function QuestionLookup({
  exams,
  subjectId,
  excludeExamId,
  excludeQuestionId,
  rejectGrouped = false,
  examLabelOf,
  confirmLabel,
  onPick,
  onCancel,
}: Props) {
  const candidates = useMemo(
    () =>
      exams.filter(
        (exam) =>
          (!subjectId || exam.subjectId === subjectId) && exam.id !== excludeExamId,
      ),
    [exams, subjectId, excludeExamId],
  )

  const cohorts = useMemo(
    () => [...new Set(candidates.map((exam) => exam.cohort))].sort(),
    [candidates],
  )

  const [cohort, setCohort] = useState(() => cohorts[0] ?? '')
  const [pickedExamId, setPickedExamId] = useState('')
  const [number, setNumber] = useState('')
  const [found, setFound] = useState<LookupResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 지문·선지 키워드로 찾기. 학번과 번호를 모를 때가 더 많다.
  const [keyword, setKeyword] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)

  const examsInCohort = useMemo(
    () => candidates.filter((exam) => exam.cohort === cohort),
    [candidates, cohort],
  )

  // 고른 시험이 지금 학번에 없으면 첫 시험으로 떨어뜨린다. 이펙트로 되맞추면
  // 렌더가 연쇄되므로 파생으로 계산한다.
  const examId = examsInCohort.some((exam) => exam.id === pickedExamId)
    ? pickedExamId
    : (examsInCohort[0]?.id ?? '')

  const search = useCallback(() => {
    const parsed = Number.parseInt(number, 10)
    if (!examId || !Number.isFinite(parsed)) {
      setError('시험과 번호를 입력해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    void findQuestionInExam(examId, parsed)
      .then((result) => {
        if (!result) {
          setError('그 시험에 해당 번호의 문제가 없습니다.')
          setFound(null)
          return
        }
        if (result.id === excludeQuestionId) {
          setError('지금 보고 있는 문제와 같습니다.')
          setFound(null)
          return
        }
        if (rejectGrouped && result.groupId) {
          setError('이미 다른 야마에 묶여 있는 문제입니다. 먼저 묶기를 풀어 주세요.')
          setFound(null)
          return
        }
        setFound(result)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '문제를 찾지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [examId, number, excludeQuestionId, rejectGrouped])

  const searchByKeyword = useCallback(() => {
    const trimmed = keyword.trim()
    if (trimmed === '') return
    setBusy(true)
    setError(null)
    setFound(null)
    void searchQuestions({ query: trimmed, includeSolutions: false, subjectId })
      .then((rows) => setHits(rows.filter((row) => row.questionId !== excludeQuestionId)))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '검색하지 못했습니다.')
        setHits([])
      })
      .finally(() => setBusy(false))
  }, [keyword, subjectId, excludeQuestionId])

  const pickHit = useCallback(
    (hit: SearchHit) => {
      setBusy(true)
      setError(null)
      void findQuestionById(hit.questionId)
        .then((result) => {
          if (!result) {
            setError('문제를 불러오지 못했습니다.')
            return
          }
          if (rejectGrouped && result.groupId) {
            setError('이미 다른 야마에 묶여 있는 문제입니다. 먼저 묶기를 풀어 주세요.')
            return
          }
          setHits(null)
          setFound(result)
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        })
        .finally(() => setBusy(false))
    },
    [rejectGrouped],
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') searchByKeyword()
          }}
          placeholder="지문이나 선지 키워드로 찾기"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <Button size="sm" variant="secondary" onClick={searchByKeyword} disabled={busy}>
          검색
        </Button>
      </div>

      {hits !== null && (
        <div className="mb-2 max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
              찾은 문제가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {hits.map((hit) => (
                <li key={hit.questionId}>
                  <button
                    type="button"
                    onClick={() => pickHit(hit)}
                    className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-brand-600 dark:text-brand-300">
                        {examLabelOf(hit.examId)} {hit.questionNumber}번
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {hit.matchedIn}
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-slate-700 dark:text-slate-200">
                      {hit.snippet ?? hit.stemText ?? '본문 없음'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">또는</span>
        <select
          value={cohort}
          onChange={(event) => {
            setCohort(event.target.value)
            setFound(null)
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          {cohorts.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        {/* 시험이 하나뿐이면 고를 것이 없다. 26학번 내과만 학년말고사 + 계통 Y1~Y8 로 9개다. */}
        {examsInCohort.length > 1 && (
          <select
            value={examId}
            onChange={(event) => {
              setPickedExamId(event.target.value)
              setFound(null)
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            {examsInCohort.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {[exam.examCode, exam.examSubjectLabel, exam.examName].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        )}

        <input
          type="number"
          inputMode="numeric"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') search()
          }}
          placeholder="번호"
          className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800"
        />

        <Button size="sm" onClick={search} disabled={busy}>
          찾기
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          취소
        </Button>
        {busy && <Spinner />}
      </div>

      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {found && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {examLabelOf(found.examId)} {found.questionNumber}번
          </p>
          <StemBlocks blocks={found.stemBlocks} />
          <ol className="mt-2 space-y-1 text-sm">
            {found.choices.map((choice) => (
              <li key={choice.no} className="text-slate-700 dark:text-slate-300">
                {choice.text}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setFound(null)}>
              다시 찾기
            </Button>
            <Button size="sm" onClick={() => onPick(found)} disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
