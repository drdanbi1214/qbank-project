import { useCallback, useRef, useState } from 'react'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { TheoryPicker } from '@/components/question/TheoryPicker'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'

/**
 * 편집기의 "야마"·"알렌" 넣기 배선.
 *
 * 편집기는 버튼만 그리고, 무엇을 고를지는 부모가 정한다. 그 배선이 상태 하나와
 * 약속(Promise) 하나로 이루어져 있어 편집기를 쓰는 곳마다 같은 코드가 필요했다.
 * 여기 모아 두어야 새 편집창이 생겨도 세 줄로 붙는다.
 *
 * 반환한 pickers 를 화면 어딘가에 그려야 고르기 창이 뜬다.
 */
export function useEmbedPickers({
  subjectId,
  yama = false,
  theory = true,
}: {
  /** 이 과목 것을 먼저 보여준다. 없으면 전체에서 찾는다. */
  subjectId?: string | null
  /** 야마(문제 카드) 넣기를 쓸지. 주제 정리 밖에서는 대개 필요 없다. */
  yama?: boolean
  /** 알렌(이론 문서) 넣기를 쓸지. */
  theory?: boolean
} = {}) {
  const { taxonomy } = useData()

  const [pickingYama, setPickingYama] = useState(false)
  const [pickingTheory, setPickingTheory] = useState(false)
  const resolveYama = useRef<((id: string | null) => void) | null>(null)
  const resolveTheory = useRef<((id: string | null) => void) | null>(null)

  const requestYama = useCallback(() => {
    setPickingYama(true)
    return new Promise<string | null>((resolve) => {
      resolveYama.current = resolve
    })
  }, [])

  const finishYama = useCallback((id: string | null) => {
    setPickingYama(false)
    resolveYama.current?.(id)
    resolveYama.current = null
  }, [])

  const requestTheory = useCallback(() => {
    setPickingTheory(true)
    return new Promise<string | null>((resolve) => {
      resolveTheory.current = resolve
    })
  }, [])

  const finishTheory = useCallback((id: string | null) => {
    setPickingTheory(false)
    resolveTheory.current?.(id)
    resolveTheory.current = null
  }, [])

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const name = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, name)
    },
    [taxonomy],
  )

  const pickers = (
    <>
      {pickingTheory && (
        <TheoryPicker
          subjectId={subjectId ?? null}
          onPick={finishTheory}
          onCancel={() => finishTheory(null)}
        />
      )}

      {pickingYama && taxonomy && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-semibold">본문에 넣을 야마 고르기</h3>
            <QuestionLookup
              exams={taxonomy.exams}
              subjectId={subjectId ?? null}
              examLabelOf={examLabelOf}
              confirmLabel="본문에 넣기"
              onCancel={() => finishYama(null)}
              onPick={(found) => finishYama(found.id)}
            />
          </div>
        </div>
      )}
    </>
  )

  return {
    /** 편집기에 그대로 넘긴다. 쓰지 않기로 한 쪽은 undefined 라 버튼이 안 생긴다. */
    onRequestYama: yama ? requestYama : undefined,
    onRequestTheory: theory ? requestTheory : undefined,
    pickers,
  }
}
