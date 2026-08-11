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
  const enabled = Boolean(session) && !isPending

  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null)
  const [units, setUnits] = useState<UnitProgress[]>([])
  const [exams, setExams] = useState<ExamProgress[]>([])
  const [openAssignments, setOpenAssignments] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taxonomyNonce, setTaxonomyNonce] = useState(0)
  const [progressNonce, setProgressNonce] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true

    async function load() {
      try {
        const next = await fetchTaxonomy()
        if (!active) return
        setTaxonomy(next)
        setError(null)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '분류 체계를 불러오지 못했습니다.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [enabled, taxonomyNonce])

  useEffect(() => {
    if (!enabled) return
    let active = true

    async function load() {
      try {
        const [unitRows, examRows, assignmentCount] = await Promise.all([
          fetchUnitProgress(),
          fetchExamProgress(),
          countMyOpenAssignments(),
        ])
        if (!active) return
        setUnits(unitRows)
        setExams(examRows)
        setOpenAssignments(assignmentCount)
      } catch (caught) {
        console.error('진행률을 불러오지 못했습니다.', caught)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [enabled, progressNonce])

  const unitProgress = useCallback(
    (unitId: string | null, subjectId?: string): Progress => {
      const rows = units.filter(
        (row) => row.unitId === unitId && (unitId !== null || row.subjectId === subjectId),
      )
      return rows.length > 0 ? accumulate(rows) : { ...EMPTY }
    },
    [units],
  )

  const subjectProgress = useCallback(
    (subjectId: string): Progress => accumulate(units.filter((row) => row.subjectId === subjectId)),
    [units],
  )

  const examProgress = useCallback(
    (examId: string): Progress => {
      const row = exams.find((item) => item.examId === examId)
      return row ? { total: row.total, solved: row.solved, correct: row.correct } : { ...EMPTY }
    },
    [exams],
  )

  const value = useMemo<DataState>(
    () => ({
      taxonomy,
      loading,
      error,
      unitProgress,
      subjectProgress,
      examProgress,
      openAssignments,
      refreshProgress: () => setProgressNonce((n) => n + 1),
      refreshAll: () => {
        setTaxonomyNonce((n) => n + 1)
        setProgressNonce((n) => n + 1)
      },
    }),
    [taxonomy, loading, error, unitProgress, subjectProgress, examProgress, openAssignments],
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
