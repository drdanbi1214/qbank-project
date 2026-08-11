import { supabase } from '@/lib/supabase'
import { toAuthor, type Author } from '@/lib/queries/solutions'
import {
  parseChoices,
  parseStemBlocks,
  type AnswerStatus,
  type Choice,
  type Completeness,
  type QuestionType,
  type StemBlock,
} from '@/types/question'
import { toJson } from '@/types/richtext'

// =============================================================================
// 관리자 조회 및 편집
//
// 문제 편집은 정답 컬럼까지 다뤄야 하므로 questions_solve 뷰가 아니라
// get_question_for_edit RPC 로 전체 행을 받는다.
// =============================================================================

export type EditableQuestion = {
  id: string
  examId: string
  unitId: string | null
  questionNumber: number
  questionType: QuestionType
  setId: string | null
  stemBlocks: StemBlock[]
  choices: Choice[]
  answerCount: number
  editorAnswer: number[]
  yamaAnswer: number[] | null
  answerStatus: AnswerStatus
  answerNote: string | null
  officialExplanation: StemBlock[] | null
  modelAnswer: string | null
  gradingPoints: string[] | null
  professor: string | null
  restorerNote: string | null
  sourceTags: string[]
  /** DB 에서 not null 이라 비우지 않는다. 기본값은 original */
  variantType: string
  groupId: string | null
  completeness: Completeness
  status: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export function parseEditableQuestion(value: unknown): EditableQuestion | null {
  if (!isRecord(value)) return null

  return {
    id: asString(value.id) ?? '',
    examId: asString(value.exam_id) ?? '',
    unitId: asString(value.unit_id),
    questionNumber: typeof value.question_number === 'number' ? value.question_number : 0,
    questionType: (asString(value.question_type) as QuestionType) ?? 'A',
    setId: asString(value.set_id),
    stemBlocks: parseStemBlocks(value.stem_blocks),
    choices: parseChoices(value.choices),
    answerCount: typeof value.answer_count === 'number' ? value.answer_count : 1,
    editorAnswer: asIntArray(value.editor_answer),
    yamaAnswer: Array.isArray(value.yama_answer) ? asIntArray(value.yama_answer) : null,
    answerStatus: (asString(value.answer_status) as AnswerStatus) ?? 'unconfirmed',
    answerNote: asString(value.answer_note),
    officialExplanation: Array.isArray(value.official_explanation)
      ? parseStemBlocks(value.official_explanation)
      : null,
    modelAnswer: asString(value.model_answer),
    gradingPoints: Array.isArray(value.grading_points)
      ? asStringArray(value.grading_points)
      : null,
    professor: asString(value.professor),
    restorerNote: asString(value.restorer_note),
    sourceTags: asStringArray(value.source_tags),
    variantType: asString(value.variant_type) ?? 'original',
    groupId: asString(value.group_id),
    completeness: (asString(value.completeness) as Completeness) ?? 'complete',
    status: asString(value.status) ?? 'published',
  }
}

export async function fetchQuestionForEdit(id: string): Promise<EditableQuestion | null> {
  const { data, error } = await supabase.rpc('get_question_for_edit', { p_question_id: id })
  if (error) throw error
  return parseEditableQuestion(data)
}

/** 저장 대상. id 가 없으면 새로 만든다. */
export type QuestionDraft = Omit<EditableQuestion, 'id'> & { id?: string }

function toRow(draft: QuestionDraft) {
  return {
    exam_id: draft.examId,
    unit_id: draft.unitId,
    question_number: draft.questionNumber,
    question_type: draft.questionType,
    set_id: draft.setId,
    stem_blocks: toJson(draft.stemBlocks),
    choices: toJson(draft.choices),
    answer_count: draft.answerCount,
    editor_answer: draft.editorAnswer,
    yama_answer: draft.yamaAnswer,
    answer_status: draft.answerStatus,
    answer_note: draft.answerNote,
    official_explanation: draft.officialExplanation
      ? toJson(draft.officialExplanation)
      : null,
    model_answer: draft.modelAnswer,
    grading_points: draft.gradingPoints ? toJson(draft.gradingPoints) : null,
    professor: draft.professor,
    restorer_note: draft.restorerNote,
    source_tags: draft.sourceTags,
    variant_type: draft.variantType,
    group_id: draft.groupId,
    completeness: draft.completeness,
    status: draft.status,
  }
}

export async function saveQuestion(draft: QuestionDraft): Promise<string> {
  if (draft.id) {
    const { error } = await supabase.from('questions').update(toRow(draft)).eq('id', draft.id)
    if (error) throw error
    return draft.id
  }

  const { data, error } = await supabase
    .from('questions')
    .insert(toRow(draft))
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().eq('id', id)
  if (error) throw error
}

/** 여러 문항을 한 번에 넣는다 (CSV 업로드). */
export async function insertQuestions(drafts: QuestionDraft[]): Promise<number> {
  if (drafts.length === 0) return 0
  const { error, count } = await supabase
    .from('questions')
    .insert(drafts.map(toRow), { count: 'exact' })
  if (error) throw error
  return count ?? drafts.length
}

// -----------------------------------------------------------------------------
// 목록 (관리자 문제 관리)
// -----------------------------------------------------------------------------

export type AdminQuestionRow = {
  id: string
  examId: string
  unitId: string | null
  questionNumber: number
  questionType: string
  stemText: string | null
  answerStatus: string
  completeness: string
  status: string
  groupId: string | null
}

export type AdminQuestionFilter = {
  examId?: string | null
  subjectId?: string | null
  unlabeledOnly?: boolean
  unconfirmedOnly?: boolean
  incompleteOnly?: boolean
  search?: string
}

export async function fetchAdminQuestions(
  filter: AdminQuestionFilter = {},
): Promise<AdminQuestionRow[]> {
  let query = supabase
    .from('questions_solve')
    .select(
      'id, exam_id, unit_id, question_number, question_type, stem_text, answer_status, completeness, status, group_id',
    )

  if (filter.examId) query = query.eq('exam_id', filter.examId)
  if (filter.unlabeledOnly) query = query.is('unit_id', null)
  if (filter.unconfirmedOnly) query = query.neq('answer_status', 'confirmed')
  if (filter.incompleteOnly) query = query.neq('completeness', 'complete')
  if (filter.search && filter.search.trim() !== '') {
    query = query.ilike('stem_text', `%${filter.search.trim()}%`)
  }

  if (filter.subjectId) {
    const { data: exams, error } = await supabase
      .from('exams')
      .select('id')
      .eq('subject_id', filter.subjectId)
    if (error) throw error
    const examIds = (exams ?? []).map((row) => row.id)
    if (examIds.length === 0) return []
    query = query.in('exam_id', examIds)
  }

  const { data, error } = await query
    .order('exam_id', { ascending: true })
    .order('question_number', { ascending: true })
    .limit(500)

  if (error) throw error

  return (data ?? []).flatMap((row) =>
    row.id && row.exam_id
      ? [
          {
            id: row.id,
            examId: row.exam_id,
            unitId: row.unit_id,
            questionNumber: row.question_number ?? 0,
            questionType: row.question_type ?? 'A',
            stemText: row.stem_text,
            answerStatus: row.answer_status ?? 'confirmed',
            completeness: row.completeness ?? 'complete',
            status: row.status ?? 'published',
            groupId: row.group_id,
          },
        ]
      : [],
  )
}

/** 단원 라벨링 큐에서 여러 문항을 한 번에 단원에 넣는다. */
export async function assignUnit(questionIds: string[], unitId: string | null): Promise<void> {
  if (questionIds.length === 0) return
  const { error } = await supabase
    .from('questions')
    .update({ unit_id: unitId })
    .in('id', questionIds)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 중복 그룹
// -----------------------------------------------------------------------------

export type SimilarQuestion = {
  questionId: string
  similarity: number
  examId: string
  questionNumber: number
  cohort: string
  subjectName: string
}

export async function findSimilarQuestions(
  questionId: string,
  threshold = 0.6,
): Promise<SimilarQuestion[]> {
  const { data, error } = await supabase.rpc('find_similar_questions', {
    p_question_id: questionId,
    p_threshold: threshold,
  })
  if (error) throw error

  return (data ?? []).map((row) => ({
    questionId: row.question_id,
    similarity: row.similarity ?? 0,
    examId: row.exam_id,
    questionNumber: row.question_number ?? 0,
    cohort: row.cohort ?? '',
    subjectName: row.subject_name ?? '',
  }))
}

/** 여러 문항을 같은 그룹으로 묶는다. 기존 그룹이 있으면 그쪽에 합친다. */
export async function groupQuestions(params: {
  questionIds: string[]
  /** 대표 문항. 같은 내용이 여러 학번에 걸쳐 있을 때 기준이 되는 문항이다. */
  canonicalId: string
  userId: string
}): Promise<string> {
  const { data: existing, error: lookupError } = await supabase
    .from('questions_solve')
    .select('group_id')
    .in('id', params.questionIds)
    .not('group_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (lookupError) throw lookupError

  let groupId: string | null = existing?.group_id ?? null

  if (groupId) {
    const { error } = await supabase
      .from('question_groups')
      .update({ canonical_question_id: params.canonicalId })
      .eq('id', groupId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('question_groups')
      .insert({ canonical_question_id: params.canonicalId, created_by: params.userId })
      .select('id')
      .single()
    if (error) throw error
    groupId = data.id
  }

  const { error: updateError } = await supabase
    .from('questions')
    .update({ group_id: groupId })
    .in('id', params.questionIds)
  if (updateError) throw updateError

  return groupId
}

export async function ungroupQuestion(questionId: string): Promise<void> {
  const { error } = await supabase
    .from('questions')
    .update({ group_id: null })
    .eq('id', questionId)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 사용자 관리
// -----------------------------------------------------------------------------

export type Member = {
  id: string
  email: string
  displayName: string
  role: string
  isSuspended: boolean
  createdAt: string
  attemptCount: number
  solutionCount: number
  lastActiveAt: string | null
}

export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase.rpc('admin_list_members')
  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isSuspended: row.is_suspended,
    createdAt: row.created_at,
    attemptCount: row.attempt_count ?? 0,
    solutionCount: row.solution_count ?? 0,
    lastActiveAt: row.last_active_at,
  }))
}

export async function setSuspended(userId: string, suspended: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_suspended', {
    p_user_id: userId,
    p_suspended: suspended,
  })
  if (error) throw error
}

export async function setRole(userId: string, role: 'admin' | 'member'): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', { p_user_id: userId, p_role: role })
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 신고
// -----------------------------------------------------------------------------

export type Report = {
  id: string
  targetType: string
  targetId: string
  reason: string | null
  status: string
  createdAt: string
  reporter: Author | null
}

export async function fetchReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(
      `id, target_type, target_id, reason, status, created_at, reporter_id,
       profiles!reports_reporter_id_fkey (id, display_name, avatar_url)`,
    )
    .order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as unknown as {
    id: string
    target_type: string
    target_id: string
    reason: string | null
    status: string
    created_at: string
    reporter_id: string | null
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reporter: row.reporter_id ? toAuthor(row.profiles, row.reporter_id) : null,
  }))
}

export async function resolveReport(id: string, status: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: id,
    p_status: status,
  })
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 변경 이력
// -----------------------------------------------------------------------------

export type RevisionRow = {
  id: string
  entityType: string
  entityId: string
  summary: string | null
  createdAt: string
  editor: Author | null
  fields: string[]
}

export async function fetchRevisions(limit = 100): Promise<RevisionRow[]> {
  const { data, error } = await supabase
    .from('revisions')
    .select(
      `id, entity_type, entity_id, change_summary, created_at, editor_id, diff,
       profiles!revisions_editor_id_fkey (id, display_name, avatar_url)`,
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return ((data ?? []) as unknown as {
    id: string
    entity_type: string
    entity_id: string
    change_summary: string | null
    created_at: string
    editor_id: string | null
    diff: unknown
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.change_summary,
    createdAt: row.created_at,
    editor: row.editor_id ? toAuthor(row.profiles, row.editor_id) : null,
    fields: isRecord(row.diff) ? Object.keys(row.diff) : [],
  }))
}

export async function revertRevision(id: string): Promise<void> {
  const { error } = await supabase.rpc('revert_question_revision', { p_revision_id: id })
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 통계 대시보드
// -----------------------------------------------------------------------------

export type AdminStats = {
  members: number
  pendingMembers: number
  active7d: number
  questions: number
  published: number
  unlabeled: number
  unconfirmedAnswers: number
  incomplete: number
  solutions: number
  questionsWithoutSolution: number
  discussions: number
  openReports: number
  openAssignments: number
  overdueAssignments: number
  dailyActive: { day: string; users: number; attempts: number }[]
  hardest: {
    questionId: string
    questionNumber: number
    cohort: string
    subjectName: string
    attempts: number
    accuracy: number
  }[]
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('get_admin_stats')
  if (error) throw error
  if (!isRecord(data)) throw new Error('통계를 해석하지 못했습니다.')

  const daily = Array.isArray(data.daily_active)
    ? (data.daily_active as unknown[]).filter(isRecord).map((row) => ({
        day: asString(row.day) ?? '',
        users: num(row.users),
        attempts: num(row.attempts),
      }))
    : []

  const hardest = Array.isArray(data.hardest)
    ? (data.hardest as unknown[]).filter(isRecord).map((row) => ({
        questionId: asString(row.question_id) ?? '',
        questionNumber: num(row.question_number),
        cohort: asString(row.cohort) ?? '',
        subjectName: asString(row.subject_name) ?? '',
        attempts: num(row.attempts),
        accuracy: num(row.accuracy),
      }))
    : []

  return {
    members: num(data.members),
    pendingMembers: num(data.pending_members),
    active7d: num(data.active_7d),
    questions: num(data.questions),
    published: num(data.published),
    unlabeled: num(data.unlabeled),
    unconfirmedAnswers: num(data.unconfirmed_answers),
    incomplete: num(data.incomplete),
    solutions: num(data.solutions),
    questionsWithoutSolution: num(data.questions_without_solution),
    discussions: num(data.discussions),
    openReports: num(data.open_reports),
    openAssignments: num(data.open_assignments),
    overdueAssignments: num(data.overdue_assignments),
    dailyActive: daily,
    hardest,
  }
}
