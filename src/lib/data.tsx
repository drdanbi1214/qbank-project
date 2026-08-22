import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchTaxonomy, type Taxonomy } from '@/lib/queries/taxonomy'
import {
  fetchExamProgress,
  fetchUnitProgress,
  type ExamProgress,
  type UnitProgress,
} from '@/lib/queries/questions'
import { countMyOpenAssignments } from '@/lib/queries/assignments'
import { useAuth } from '@/lib/auth'

export type Progress = { total: number; solved: number; correct: number }

const EMPTY: Progress = { total: 0, solved: 0, correct: 0 }

type DataState = {
  taxonomy: Taxonomy | null
  loading: boolean
  error: string | null
  /**
   * 단원별 진행률. 단원 미분류 문제는 unitId = null 로 들어온다.
   * unitId 가 null 이면 subjectId 도 함께 넘겨야 한다. null 은 모든 과목에서
   * 공유되는 값이라, 과목을 지정하지 않으면 여러 과목의 미분류 문제가 합쳐진다.
   */
  unitProgress: (unitId: string | null, subjectId?: string) => Progress
  subjectProgress: (subjectId: string) => Progress
  examProgress: (examId: string) => Progress
  /** 아직 끝내지 않은 내 배정 개수 (네비게이션 뱃지용) */
  openAssignments: number
  /** 문제를 푼 뒤 진행률만 다시 받는다. */
  refreshProgress: () => void
  /** 시드나 편집 이후 분류 체계까지 다시 받는다. */
  refreshAll: () => void
}

const DataContext = createContext<DataState | null>(null)
const EMPTY_UNIT_PROGRESS: UnitProgress[] = []
const EMPTY_EXAM_PROGRESS: ExamProgress[] = []

function accumulate(rows: { total: number; solved: number; correct: number }[]): Progress {
  return rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      solved: acc.solved + row.solved,
      correct: acc.correct + row.correct,
    }),
    { ...EMPTY },
  )
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { session, isPending } = useAuth()
  const userId = session?.user.id ?? null
  const enabled = userId !== null && !isPending

  const [taxonomyNonce, setTaxonomyNonce] = useState(0)
  const [progressNonce, setProgressNonce] = useState(0)
  // 결과 소유자는 계정 단위로 기록한다. nonce는 재조회만 일으키므로 같은
  // 계정에서 새 응답을 기다리는 동안 기존 화면을 불필요하게 비우지 않는다.
  const taxonomyRequestKey = enabled ? userId : null
  const progressRequestKey = enabled ? userId : null
  const [taxonomyResult, setTaxonomyResult] = useState<{
    key: string
    taxonomy: Taxonomy | null
    error: string | null
  } | null>(null)
  const [progressResult, setProgressResult] = useState<{
    key: string
    units: UnitProgress[]
    exams: ExamProgress[]
    openAssignments: number
  } | null>(null)

  useEffect(() => {
    if (!enabled || !userId || !taxonomyRequestKey) return
    const requestKey = taxonomyRequestKey
    let active = true

    async function load() {
      try {
        const next = await fetchTaxonomy()
        if (!active) return
        setTaxonomyResult({ key: requestKey, taxonomy: next, error: null })
      } catch (caught) {
        if (!active) return
        setTaxonomyResult({
          key: requestKey,
          taxonomy: null,
          error: caught instanceof Error ? caught.message : '분류 체계를 불러오지 못했습니다.',
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [enabled, userId, taxonomyRequestKey, taxonomyNonce])

  useEffect(() => {
    if (!enabled || !userId || !progressRequestKey) return
    const requestKey = progressRequestKey
    let active = true

    async function load() {
      try {
        const [unitRows, examRows, assignmentCount] = await Promise.all([
          fetchUnitProgress(),
          fetchExamProgress(),
          countMyOpenAssignments(),
        ])
        if (!active) return
        setProgressResult({
          key: requestKey,
          units: unitRows,
          exams: examRows,
          openAssignments: assignmentCount,
        })
      } catch (caught) {
        console.error('진행률을 불러오지 못했습니다.', caught)
        if (!active) return
        setProgressResult({ key: requestKey, units: [], exams: [], openAssignments: 0 })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [enabled, userId, progressRequestKey, progressNonce])

  // Provider 자체는 로그인 화면에서도 유지된다. 이전 사용자의 비동기 결과가
  // 메모리에 남아 있더라도 현재 계정 소유로 확인된 값만 화면에 노출한다.
  const scopedTaxonomy =
    taxonomyRequestKey && taxonomyResult?.key === taxonomyRequestKey
      ? taxonomyResult.taxonomy
      : null
  const scopedUnits =
    progressRequestKey && progressResult?.key === progressRequestKey
      ? progressResult.units
      : EMPTY_UNIT_PROGRESS
  const scopedExams =
    progressRequestKey && progressResult?.key === progressRequestKey
      ? progressResult.exams
      : EMPTY_EXAM_PROGRESS
  const scopedOpenAssignments =
    progressRequestKey && progressResult?.key === progressRequestKey
      ? progressResult.openAssignments
      : 0
  const scopedLoading = enabled && taxonomyResult?.key !== taxonomyRequestKey
  const scopedError =
    taxonomyRequestKey && taxonomyResult?.key === taxonomyRequestKey
      ? taxonomyResult.error
      : null

  const unitProgress = useCallback(
    (unitId: string | null, subjectId?: string): Progress => {
      const rows = scopedUnits.filter(
        (row) => row.unitId === unitId && (unitId !== null || row.subjectId === subjectId),
      )
      return rows.length > 0 ? accumulate(rows) : { ...EMPTY }
    },
    [scopedUnits],
  )

  const subjectProgress = useCallback(
    (subjectId: string): Progress =>
      accumulate(scopedUnits.filter((row) => row.subjectId === subjectId)),
    [scopedUnits],
  )

  const examProgress = useCallback(
    (examId: string): Progress => {
      const row = scopedExams.find((item) => item.examId === examId)
      return row ? { total: row.total, solved: row.solved, correct: row.correct } : { ...EMPTY }
    },
    [scopedExams],
  )

  const value = useMemo<DataState>(
    () => ({
      taxonomy: scopedTaxonomy,
      loading: scopedLoading,
      error: scopedError,
      unitProgress,
      subjectProgress,
      examProgress,
      openAssignments: scopedOpenAssignments,
      refreshProgress: () => setProgressNonce((n) => n + 1),
      refreshAll: () => {
        setTaxonomyNonce((n) => n + 1)
        setProgressNonce((n) => n + 1)
      },
    }),
    [
      scopedTaxonomy,
      scopedLoading,
      scopedError,
      unitProgress,
      subjectProgress,
      examProgress,
      scopedOpenAssignments,
    ],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData(): DataState {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData 는 DataProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}

/** 정답률. 푼 문제가 없으면 null */
// eslint-disable-next-line react-refresh/only-export-components
export function accuracy(progress: Progress): number | null {
  if (progress.solved === 0) return null
  return Math.round((progress.correct / progress.solved) * 100)
}
