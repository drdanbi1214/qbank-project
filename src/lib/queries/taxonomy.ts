import { supabase } from '@/lib/supabase'

export type Subject = {
  id: string
  name: string
  iconKey: string | null
  sortOrder: number
  /** 문제 코드용 2자리 과목코드. 없으면 문제 코드를 만들 수 없다 */
  code: string | null
}
export type Unit = { id: string; subjectId: string; name: string; sortOrder: number }
export type Exam = {
  id: string
  cohort: string
  subjectId: string
  examName: string
  examDate: string | null
  durationMin: number | null
  format: string | null
  totalQuestions: number | null
  restoredQuestions: number | null
  overview: string | null
}

export type Taxonomy = {
  subjects: Subject[]
  units: Unit[]
  exams: Exam[]
  subjectById: Map<string, Subject>
  unitById: Map<string, Unit>
  examById: Map<string, Exam>
}

/**
 * 과목/단원/시험은 건수가 적고 화면 대부분에서 필요하므로 한 번에 받아 조합한다.
 * PostgREST 중첩 임베드 대신 클라이언트에서 맞추는 편이 뷰와도 잘 맞는다.
 */
export async function fetchTaxonomy(): Promise<Taxonomy> {
  const [subjectsRes, unitsRes, examsRes] = await Promise.all([
    supabase.from('subjects').select('id, name, icon_key, sort_order, code'),
    supabase.from('units').select('id, subject_id, name, sort_order'),
    supabase
      .from('exams')
      .select(
        'id, cohort, subject_id, exam_name, exam_date, duration_min, format, total_questions, restored_questions, overview',
      ),
  ])

  const error = subjectsRes.error ?? unitsRes.error ?? examsRes.error
  if (error) throw error

  const subjects: Subject[] = (subjectsRes.data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      iconKey: row.icon_key,
      sortOrder: row.sort_order,
      code: row.code,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))

  const units: Unit[] = (unitsRes.data ?? [])
    .map((row) => ({
      id: row.id,
      subjectId: row.subject_id,
      name: row.name,
      sortOrder: row.sort_order,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))

  const exams: Exam[] = (examsRes.data ?? [])
    .map((row) => ({
      id: row.id,
      cohort: row.cohort,
      subjectId: row.subject_id,
      examName: row.exam_name,
      examDate: row.exam_date,
      durationMin: row.duration_min,
      format: row.format,
      totalQuestions: row.total_questions,
      restoredQuestions: row.restored_questions,
      overview: row.overview,
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort, 'ko'))

  return {
    subjects,
    units,
    exams,
    subjectById: new Map(subjects.map((item) => [item.id, item])),
    unitById: new Map(units.map((item) => [item.id, item])),
    examById: new Map(exams.map((item) => [item.id, item])),
  }
}

/**
 * 배정/풀이 작성 화면에서 필요한 단원이 목록에 없을 때 그 자리에서 새로 만든다.
 * sort_order 는 같은 과목 안에서 기존 최대값 + 1 로 둬 목록 맨 뒤에 오게 한다.
 * (subject_id, name) 유니크 제약이 있어 이름이 겹치면 DB 에서 에러가 난다 —
 * 호출 전에 같은 이름이 이미 있는지 확인하는 건 호출부 책임.
 */
export async function createUnit(subjectId: string, name: string, existingUnits: Unit[]): Promise<Unit> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('단원 이름을 입력해주세요.')

  const maxSortOrder = existingUnits
    .filter((unit) => unit.subjectId === subjectId)
    .reduce((max, unit) => Math.max(max, unit.sortOrder), 0)

  const { data, error } = await supabase
    .from('units')
    .insert({ subject_id: subjectId, name: trimmed, sort_order: maxSortOrder + 1 })
    .select('id, subject_id, name, sort_order')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('이미 있는 단원 이름입니다.')
    throw error
  }

  return { id: data.id, subjectId: data.subject_id, name: data.name, sortOrder: data.sort_order }
}

/** `20학번 정신건강의학과 학년말고사` 형태의 표시명 */
export function examTitle(exam: Exam, subjectName: string | undefined): string {
  return [exam.cohort, subjectName, exam.examName].filter(Boolean).join(' ')
}

/** 상단 바에 쓰는 짧은 표기 `[20학번 정신건강의학과]` */
export function examShortLabel(exam: Exam | undefined, subjectName: string | undefined): string {
  if (!exam) return ''
  return `${exam.cohort} ${subjectName ?? ''}`.trim()
}

/** cohort("26학번")를 연도(2026)로 바꿔 exam_name 과 합친다. 예: "2026 학년말고사" */
export function examYearLabel(exam: Exam | undefined): string {
  if (!exam) return ''
  const match = exam.cohort.match(/^(\d{2})학번$/)
  const year = match ? `20${match[1]}` : exam.cohort
  return `${year} ${exam.examName}`.trim()
}
