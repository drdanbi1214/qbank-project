import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StemBlocks } from '@/components/question/StemBlocks'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { SolutionList } from '@/components/solution/SolutionList'
import { useData } from '@/lib/data'
import {
  attachToCluster,
  detachFromCluster,
  ensureClusterGroup,
  fetchClusterSiblings,
  type ClusterSibling,
  type VariantType,
} from '@/lib/queries/clusters'

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
  /** 해설 편집기에 넘길 기준 문제 정보. 없으면 해설 영역을 그리지 않는다. */
  solutionContext?: {
    choiceCount: number
    unitId: string | null
    unitSource: 'ai_suggested' | 'human_confirmed' | null
  }
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
  solutionContext,
}: Props) {
  const { taxonomy } = useData()
  const [groupId, setGroupId] = useState(initialGroupId)
  // 묶인 그룹이 없으면 조회할 것도 없으므로 빈 배열로 시작한다.
  // 이펙트 안에서 동기적으로 setState 하지 않기 위한 초기값 분기다.
  const [siblings, setSiblings] = useState<ClusterSibling[] | null>(initialGroupId ? null : [])
  const [adding, setAdding] = useState<VariantType | null>(null)
  // 해설 영역을 펼쳤는지. 펼칠 때 그룹을 보장해 두어야 해설이 판본 전체에 붙는다.
  const [solutionGroupId, setSolutionGroupId] = useState<string | null>(null)
  const [openingSolutions, setOpeningSolutions] = useState(false)

  const refresh = useCallback(
    (id: string) => {
      void fetchClusterSiblings(id, questionId)
        .then(setSiblings)
        .catch((caught: unknown) => {
          console.error('야마 묶음을 불러오지 못했습니다.', caught)
          setSiblings([])
        })
    },
    [questionId],
  )

  const load = useCallback(() => {
    if (!groupId) return
    refresh(groupId)
  }, [groupId, refresh])

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
  //
  // 두 번째부터는 cluster_attach 가 같은 그룹 id 를 돌려주므로 setGroupId 로는
  // 아무 일도 일어나지 않는다(값이 같아 이펙트가 다시 돌지 않는다). 그래서 받은
  // id 로 직접 다시 읽는다.
  const handleAttached = useCallback(
    (nextGroupId: string) => {
      setAdding(null)
      setGroupId(nextGroupId)
      refresh(nextGroupId)
    },
    [refresh],
  )

  // 해설은 항상 그룹에 붙인다. 그룹 없이 문제에 붙이면 나중에 판본을 묶어도
  // 해설이 따라가지 않는다.
  const openSolutions = useCallback(() => {
    if (solutionGroupId) {
      setSolutionGroupId(null)
      return
    }
    setOpeningSolutions(true)
    void ensureClusterGroup(questionId)
      .then((id) => {
        setGroupId(id)
        setSolutionGroupId(id)
      })
      .catch((caught: unknown) => {
        window.alert(caught instanceof Error ? caught.message : '해설을 열지 못했습니다.')
      })
      .finally(() => setOpeningSolutions(false))
  }, [questionId, solutionGroupId])

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
                  {choice.text}
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

            {/* 변주는 지문이 달라 덧붙일 말이 생긴다. 이 해설은 groupId 없이
                이 문제에만 붙어, 이 판본을 풀 때만 공유 해설과 함께 보인다. */}
            {solutionContext && (
              <div className="mt-3 border-t border-amber-200 pt-3 dark:border-amber-900">
                <h5 className="mb-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                  이 변주에만 붙는 해설
                </h5>
                <SolutionList
                  questionId={row.id}
                  groupId={null}
                  choiceCount={row.choices.length}
                  subjectId={subjectId}
                  unitId={row.unitId}
                  unitSource={row.unitSource}
                />
              </div>
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
          {solutionContext && (
            <Button variant="secondary" size="sm" onClick={openSolutions} disabled={openingSolutions}>
              {solutionGroupId ? '문제 해설 닫기' : '문제 해설'}
            </Button>
          )}
        </div>
      )}

      {solutionGroupId && solutionContext && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <h4 className="mb-2 text-sm font-semibold">
            문제 해설
            <span className="ml-2 font-normal text-xs text-slate-500 dark:text-slate-400">
              이 야마로 묶인 모든 판본에서 함께 보입니다.
            </span>
          </h4>
          <SolutionList
            questionId={questionId}
            groupId={solutionGroupId}
            choiceCount={solutionContext.choiceCount}
            subjectId={subjectId}
            unitId={solutionContext.unitId}
            unitSource={solutionContext.unitSource}
          />
        </div>
      )}

      {adding && taxonomy && (
        <div className="rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
          <h4 className="mb-2 text-sm font-semibold">{VARIANT_LABEL[adding]} 추가</h4>
          <QuestionLookup
            exams={taxonomy.exams}
            subjectId={subjectId}
            excludeExamId={examId}
            excludeQuestionId={questionId}
            rejectGrouped
            examLabelOf={examLabelOf}
            confirmLabel="이 문제로 확정"
            onCancel={() => setAdding(null)}
            onPick={(found) => {
              void attachToCluster({ anchorId: questionId, targetId: found.id, variant: adding })
                .then(handleAttached)
                .catch((caught: unknown) => {
                  window.alert(caught instanceof Error ? caught.message : '묶지 못했습니다.')
                })
            }}
          />
        </div>
      )}
    </section>
  )
}

