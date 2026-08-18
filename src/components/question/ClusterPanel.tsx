import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { StemBlocks } from '@/components/question/StemBlocks'
import { useData } from '@/lib/data'
import {
  attachToCluster,
  detachFromCluster,
  fetchClusterSiblings,
  findQuestionInExam,
  type ClusterSibling,
  type LookupResult,
  type VariantType,
} from '@/lib/queries/clusters'
import type { Exam } from '@/lib/queries/taxonomy'

type Props = {
  questionId: string
  examId: string
  /** 마운트 시점의 클러스터. 붙이고 나면 컴포넌트가 자체적으로 들고 있는다. */
  initialGroupId: string | null
  /** 이 과목의 시험만 후보로 보여준다 */
  subjectId: string | null
  examLabelOf: (examId: string) => string
  /** 레전드옵세스터디원 + 관리자만 묶을 수 있다 */
  canCluster: boolean
}

const VARIANT_LABEL: Record<VariantType, string> = {
  identical: '완전히 동일한 문제',
  modified: '거의 비슷한 문제',
}

/**
 * 야마 클러스터 패널.
 *
 * 완전 동일은 배너 한 줄로 끝낸다 — 내용이 같으니 본문을 반복할 이유가 없다.
 * 거의 비슷은 문제 전체를 펼친다 — 어디가 다른지 눈으로 봐야 하기 때문이다.
 */
export function ClusterPanel({
  questionId,
  examId,
  initialGroupId,
  subjectId,
  examLabelOf,
  canCluster,
}: Props) {
  const { taxonomy } = useData()
  const [groupId, setGroupId] = useState(initialGroupId)
  // 묶인 그룹이 없으면 조회할 것도 없으므로 빈 배열로 시작한다.
  // 이펙트 안에서 동기적으로 setState 하지 않기 위한 초기값 분기다.
  const [siblings, setSiblings] = useState<ClusterSibling[] | null>(initialGroupId ? null : [])
  const [adding, setAdding] = useState<VariantType | null>(null)

  const load = useCallback(() => {
    if (!groupId) return
    void fetchClusterSiblings(groupId, questionId)
      .then(setSiblings)
      .catch((caught: unknown) => {
        console.error('야마 묶음을 불러오지 못했습니다.', caught)
        setSiblings([])
      })
  }, [groupId, questionId])

  useEffect(load, [load])

  const identical = useMemo(
    () => (siblings ?? []).filter((row) => row.variantType === 'identical'),
    [siblings],
  )
  const modified = useMemo(
    () => (siblings ?? []).filter((row) => row.variantType === 'modified'),
    [siblings],
  )

  // 붙이고 나면 기준 문제도 그 그룹에 들어간다. 부모가 문제를 다시 읽지 않아도
  // 되도록 새 그룹 id 를 여기서 받아 든다.
  const handleAttached = useCallback((nextGroupId: string) => {
    setAdding(null)
    setGroupId(nextGroupId)
  }, [])

  const handleDetach = useCallback(
    (id: string) => {
      void detachFromCluster(id)
        .then(load)
        .catch((caught: unknown) => {
          window.alert(caught instanceof Error ? caught.message : '묶기를 풀지 못했습니다.')
        })
    },
    [load],
  )

  if (siblings === null) return null
  if (siblings.length === 0 && !canCluster) return null

  return (
    <section className="space-y-2">
      {identical.length > 0 && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          이 문제는{' '}
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {identical.map((row) => `${examLabelOf(row.examId)} ${row.questionNumber}번`).join(' · ')}
          </span>
          에도 동일 출제됨
          {canCluster && (
            <span className="ml-2 inline-flex gap-1">
              {identical.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => handleDetach(row.id)}
                  className="text-xs text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
                >
                  {row.questionNumber}번 묶기 풀기
                </button>
              ))}
            </span>
          )}
        </p>
      )}

      {modified.map((row) => (
        <details
          key={row.id}
          className="rounded-lg border border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30"
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            변주 · {examLabelOf(row.examId)} {row.questionNumber}번
            <span className="ml-2 font-normal text-amber-700 dark:text-amber-400">
              지문이 조금 다릅니다. 정답을 따로 확인하세요.
            </span>
          </summary>
          <div className="border-t border-amber-200 px-3 py-3 dark:border-amber-900">
            <StemBlocks blocks={row.stemBlocks} />
            <ol className="mt-2 space-y-1 text-sm">
              {row.choices.map((choice) => (
                <li key={choice.no} className="text-slate-700 dark:text-slate-300">
                  {choice.no}. {choice.text}
                </li>
              ))}
            </ol>
            {canCluster && (
              <button
                type="button"
                onClick={() => handleDetach(row.id)}
                className="mt-2 text-xs text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
              >
                이 문제 묶기 풀기
              </button>
            )}
          </div>
        </details>
      ))}

      {canCluster && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding('identical')}>
            + 완전히 동일한 문제
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAdding('modified')}>
            + 거의 비슷한 문제
          </Button>
        </div>
      )}

      {adding && taxonomy && (
        <AttachForm
          variant={adding}
          anchorId={questionId}
          anchorExamId={examId}
          subjectId={subjectId}
          exams={taxonomy.exams}
          examLabelOf={examLabelOf}
          onCancel={() => setAdding(null)}
          onDone={handleAttached}
        />
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------

type FormProps = {
  variant: VariantType
  anchorId: string
  anchorExamId: string
  subjectId: string | null
  exams: Exam[]
  examLabelOf: (examId: string) => string
  onCancel: () => void
  onDone: (groupId: string) => void
}

/**
 * 찾은 문제를 확정 전에 한 번 보여준다.
 *
 * 자동 유사도 매칭을 쓰지 않기로 했으므로 오류원은 사람의 입력 실수뿐이다.
 * 클릭을 한 번 더 받는 대신, 엉뚱한 문제에 해설이 공유되는 사고를 막는다.
 */
function AttachForm({
  variant,
  anchorId,
  anchorExamId,
  subjectId,
  exams,
  examLabelOf,
  onCancel,
  onDone,
}: FormProps) {
  const candidates = useMemo(() => {
    const list = exams.filter((exam) => !subjectId || exam.subjectId === subjectId)
    // 기준 문제와 같은 시험은 후보에서 뺀다. 같은 시험 안에서 자기 자신을 붙일 일은 없다.
    return list.filter((exam) => exam.id !== anchorExamId)
  }, [exams, subjectId, anchorExamId])

  const [pickedExamId, setPickedExamId] = useState('')
  const [number, setNumber] = useState('')
  const [found, setFound] = useState<LookupResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 후보가 하나뿐이면 고를 것이 없으므로 드롭다운을 숨긴다.
  // 26학번 내과만 시험이 9개(학년말고사 + 계통 Y1~Y8)라 선택이 필요하다.
  const cohorts = useMemo(
    () => [...new Set(candidates.map((exam) => exam.cohort))].sort(),
    [candidates],
  )
  const [cohort, setCohort] = useState(() => cohorts[0] ?? '')
  const examsInCohort = useMemo(
    () => candidates.filter((exam) => exam.cohort === cohort),
    [candidates, cohort],
  )

  // 고른 시험이 지금 학번에 속하지 않으면 첫 시험으로 떨어뜨린다. 학번을 바꿀 때
  // 이펙트로 되맞추는 대신 파생으로 계산해 렌더 연쇄를 피한다.
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
        if (result.id === anchorId) {
          setError('지금 보고 있는 문제와 같습니다.')
          setFound(null)
          return
        }
        if (result.groupId) {
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
  }, [examId, number, anchorId])

  const confirm = useCallback(() => {
    if (!found) return
    setBusy(true)
    void attachToCluster({ anchorId, targetId: found.id, variant })
      .then(onDone)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '묶지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [found, anchorId, variant, onDone])

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
      <h4 className="mb-2 text-sm font-semibold">{VARIANT_LABEL[variant]} 추가</h4>

      <div className="flex flex-wrap items-center gap-2">
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
                {choice.no}. {choice.text}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setFound(null)}>
              다시 찾기
            </Button>
            <Button size="sm" onClick={confirm} disabled={busy}>
              이 문제로 확정
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
