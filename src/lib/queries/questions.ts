import { supabase } from '@/lib/supabase'
import { toClusterRole, type ClusterRole } from '@/lib/queries/clusters'
import {
  parseAnswerPayload,
  parseChoices,
  parseSharedChoices,
  parseStats,
  parseStemBlocks,
  type AnswerPayload,
  type Choice,
  type Completeness,
  type QuestionStats,
  type QuestionType,
  type SharedChoice,
  type StemBlock,
  type SubmitResult,
} from '@/types/question'
import { parseSubmitResult } from '@/types/question'

/** 풀이 화면이 다루는 문제. 정답 관련 필드는 들어 있지 않다. */
export type SolveQuestion = {
  id: string
  examId: string
  unitId: string | null
  questionNumber: number
  questionType: QuestionType
  setId: string | null
  stemBlocks: StemBlock[]
  choices: Choice[]
  answerCount: number
  restorerNote: string | null
  sourceTags: string[]
  groupId: string | null
  /** 클러스터 안에서의 역할. 'identical' 은 이어풀기에서 하나만 남긴다. */
  variantType: ClusterRole
  completeness: Completeness
  viewCount: number
  /** 'ai_suggested' 면 사람이 아직 확인하지 않은 AI 1차 단원 분류다 */
  unitSource: 'ai_suggested' | 'human_confirmed' | null
  /** 학번2자리+과목코드2자리+문항번호3자리. 과목에 code 가 없으면 null */
  questionCode: string | null
}

export type QuestionSet = {
  id: string
  setTitle: string | null
  instruction: string | null
  sharedChoices: SharedChoice[]
}

/** 복기 원문에 적힌 출제 강의. 강의록 파일은 나중에 별도로 연결될 수 있다. */
export type QuestionLectureSource = {
  id: string
  title: string
  professor: string | null
  theoryDocumentId: string | null
}

export async function fetchQuestionLectureSources(questionId: string): Promise<QuestionLectureSource[]> {
  const { data, error } = await supabase.rpc('get_question_lecture_sources', {
    p_question_id: questionId,
  })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    professor: row.professor,
    theoryDocumentId: row.theory_document_id,
  }))
}

/** 내 풀이 상태 (문제 목록의 O/X 표시) */
export type QuestionState = {
  isCorrect: boolean | null
  attempts: number
}

const SOLVE_COLUMNS =
  'id, exam_id, unit_id, question_number, question_type, set_id, stem_blocks, choices, answer_count, restorer_note, source_tags, group_id, variant_type, completeness, view_count, unit_source, question_code'

type SolveRow = {
  id: string
  exam_id: string
  unit_id: string | null
  question_number: number
  question_type: string
  set_id: string | null
  stem_blocks: unknown
  choices: unknown
  answer_count: number
  restorer_note: string | null
  source_tags: string[] | null
  group_id: string | null
  variant_type: string | null
  completeness: string
  view_count: number
  unit_source: string | null
  question_code: string | null
}

function toSolveQuestion(row: SolveRow): SolveQuestion {
  return {
    id: row.id,
    examId: row.exam_id,
    unitId: row.unit_id,
    questionNumber: row.question_number,
    questionType: (row.question_type as QuestionType) ?? 'A',
    setId: row.set_id,
    stemBlocks: parseStemBlocks(row.stem_blocks),
    choices: parseChoices(row.choices),
    answerCount: row.answer_count,
    restorerNote: row.restorer_note,
    sourceTags: row.source_tags ?? [],
    groupId: row.group_id,
    variantType: toClusterRole(row.variant_type),
    completeness: (row.completeness as Completeness) ?? 'complete',
    viewCount: row.view_count,
    unitSource: row.unit_source === 'ai_suggested' || row.unit_source === 'human_confirmed' ? row.unit_source : null,
    questionCode: row.question_code,
  }
}

export type QuestionFilter = {
  unitId?: string | null
  examId?: string
  subjectId?: string
  /** unit_id 가 비어 있는 문제만 (라벨링 대기) */
  unlabeledOnly?: boolean
}

/**
 * 한 번에 받아올 행 수.
 *
 * PostgREST 는 한 응답에 담는 행 수에 상한이 있고, 상한에 걸려도 오류가
 * 아니라 그냥 잘려서 온다. 잘린 줄 모르면 "문제가 없다" 처럼 보인다.
 * 실제로 문제가 2577개가 되면서 전체 조회가 조용히 잘렸다.
 * 서버 상한보다 확실히 작은 값으로 나눠 받고, 전체 개수와 맞을 때까지 돈다.
 */
const PAGE_SIZE = 500

export async function fetchQuestions(filter: QuestionFilter): Promise<SolveQuestion[]> {
  let examIds: string[] | null = null
  if (filter.subjectId) {
    // 과목으로 좁힐 때는 해당 과목의 시험 목록을 먼저 구한다.
    const { data: exams, error } = await supabase
      .from('exams')
      .select('id')
      .eq('subject_id', filter.subjectId)
    if (error) throw error
    examIds = (exams ?? []).map((row) => row.id)
    if (examIds.length === 0) return []
  }

  const build = () => {
    let query = supabase
      .from('questions_solve')
      .select(SOLVE_COLUMNS, { count: 'exact' })
      .eq('status', 'published')

    if (filter.unlabeledOnly) {
      query = query.is('unit_id', null)
    } else if (filter.unitId) {
      query = query.eq('unit_id', filter.unitId)
    }
    if (filter.examId) query = query.eq('exam_id', filter.examId)
    if (examIds) query = query.in('exam_id', examIds)

    return query
      .order('exam_id', { ascending: true })
      .order('question_number', { ascending: true })
  }

  const rows: SolveRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error, count } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw error

    const page = (data ?? []) as SolveRow[]
    rows.push(...page)
    // 서버가 세어 준 전체 개수를 다 받았거나, 더 줄 게 없으면 끝난다.
    if (page.length === 0 || (count !== null && rows.length >= count)) break
  }

  return rows.map((row) => toSolveQuestion(row))
}

export async function fetchQuestionById(id: string): Promise<SolveQuestion | null> {
  const { data, error } = await supabase
    .from('questions_solve')
    .select(SOLVE_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? toSolveQuestion(data as SolveRow) : null
}

/** 인쇄용으로 여러 문제를 한 번에 받는다. 요청한 순서를 지킨다. */
export async function fetchQuestionsByIds(ids: string[]): Promise<SolveQuestion[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('questions_solve')
    .select(SOLVE_COLUMNS)
    .in('id', ids)

  if (error) throw error
  const byId = new Map((data ?? []).map((row) => [row.id, toSolveQuestion(row as SolveRow)]))
  return ids.flatMap((id) => {
    const found = byId.get(id)
    return found ? [found] : []
  })
}

/** 문제집 인쇄에서만 쓴다. 화면 풀이 중에는 절대 호출하지 않는다. */
export async function revealAnswers(ids: string[]): Promise<Map<string, AnswerPayload>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('reveal_answers', { p_question_ids: ids })
  if (error) throw error

  const map = new Map<string, AnswerPayload>()
  for (const row of data ?? []) {
    const parsed = parseAnswerPayload({
      question_id: row.question_id,
      editor_answer: row.editor_answer,
      yama_answer: row.yama_answer,
      answer_status: row.answer_status,
      answer_note: row.answer_note,
      official_explanation: row.official_explanation,
      model_answer: row.model_answer,
      grading_points: row.grading_points,
    })
    if (parsed && row.question_id) map.set(row.question_id, parsed)
  }
  return map
}

export async function fetchQuestionSet(setId: string): Promise<QuestionSet | null> {
  const { data, error } = await supabase
    .from('question_sets')
    .select('id, set_title, instruction, shared_choices')
    .eq('id', setId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    setTitle: data.set_title,
    instruction: data.instruction,
    sharedChoices: parseSharedChoices(data.shared_choices),
  }
}

/** 정답 확인 및 스킵 시점에만 호출한다. */
/**
 * 편집자답을 정한다. 배정 화면에서 문항을 검토할 때 쓴다.
 * can_write() 를 만족하는 계정이면 누구나 호출할 수 있다 (위키형 편집 정책과 동일).
 */
export async function setEditorAnswer(questionId: string, answer: number[]): Promise<void> {
  const { error } = await supabase.from('questions').update({ editor_answer: answer }).eq('id', questionId)
  if (error) throw error
}

export async function revealAnswer(questionId: string): Promise<AnswerPayload | null> {
  const { data, error } = await supabase.rpc('reveal_answer', { p_question_id: questionId })
  if (error) throw error
  return parseAnswerPayload(data)
}

export async function fetchStats(questionId: string): Promise<QuestionStats> {
  const { data, error } = await supabase.rpc('get_question_stats', { p_question_id: questionId })
  if (error) throw error
  return parseStats(data)
}

export async function submitAttempt(params: {
  questionId: string
  selected: number[]
  timeSpentSec: number | null
  selfGrade?: 'correct' | 'partial' | 'wrong' | null
}): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_question_id: params.questionId,
    p_selected: params.selected,
    p_time_spent_sec: params.timeSpentSec ?? undefined,
    p_self_grade: params.selfGrade ?? undefined,
  })
  if (error) throw error

  const parsed = parseSubmitResult(data)
  if (!parsed) throw new Error('채점 결과를 해석하지 못했습니다.')
  return parsed
}

export async function incrementView(questionId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_question_view', { p_question_id: questionId })
  if (error) console.error('조회수를 올리지 못했습니다.', error)
}

export async function fetchQuestionStates(
  questionIds: string[],
): Promise<Map<string, QuestionState>> {
  if (questionIds.length === 0) return new Map()

  const { data, error } = await supabase.rpc('get_my_question_states', {
    p_question_ids: questionIds,
  })
  if (error) throw error

  return new Map(
    (data ?? []).map((row) => [
      row.question_id,
      { isCorrect: row.is_correct, attempts: row.attempts ?? 0 },
    ]),
  )
}

/** 같은 그룹에 속한 다른 시험의 문제들 (동일 출제 안내용) */
export async function fetchGroupSiblings(
  groupId: string,
  excludeQuestionId: string,
): Promise<{ id: string; examId: string; questionNumber: number }[]> {
  const { data, error } = await supabase
    .from('questions_solve')
    .select('id, exam_id, question_number')
    .eq('group_id', groupId)
    .neq('id', excludeQuestionId)

  if (error) throw error
  // 뷰 컬럼은 생성 타입상 모두 nullable 이라 값이 있는 행만 추린다.
  return (data ?? []).flatMap((row) =>
    row.id && row.exam_id
      ? [{ id: row.id, examId: row.exam_id, questionNumber: row.question_number ?? 0 }]
      : [],
  )
}

export async function fetchDiscussionCount(questionId: string): Promise<number> {
  const { count, error } = await supabase
    .from('discussions')
    .select('id', { count: 'exact', head: true })
    .eq('question_id', questionId)

  if (error) {
    console.error('게시글 수를 불러오지 못했습니다.', error)
    return 0
  }
  return count ?? 0
}

// -----------------------------------------------------------------------------
// 북마크
// -----------------------------------------------------------------------------

export async function fetchBookmarked(questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('bookmarks')
    .select('question_id')
    .in('question_id', questionIds)

  if (error) throw error
  return new Set((data ?? []).map((row) => row.question_id))
}

export async function setBookmark(
  questionId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('bookmarks')
      .upsert({ question_id: questionId, user_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('question_id', questionId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

// -----------------------------------------------------------------------------
// 진행률
// -----------------------------------------------------------------------------

export type UnitProgress = {
  subjectId: string
  unitId: string | null
  total: number
  solved: number
  correct: number
}

export async function fetchUnitProgress(): Promise<UnitProgress[]> {
  const { data, error } = await supabase.rpc('get_progress_by_unit')
  if (error) throw error
  return (data ?? []).map((row) => ({
    subjectId: row.subject_id,
    unitId: row.unit_id,
    total: row.total_questions ?? 0,
    solved: row.solved_questions ?? 0,
    correct: row.correct_questions ?? 0,
  }))
}

export type ExamProgress = {
  examId: string
  total: number
  solved: number
  correct: number
}

export async function fetchExamProgress(): Promise<ExamProgress[]> {
  const { data, error } = await supabase.rpc('get_progress_by_exam')
  if (error) throw error
  return (data ?? []).map((row) => ({
    examId: row.exam_id,
    total: row.total_questions ?? 0,
    solved: row.solved_questions ?? 0,
    correct: row.correct_questions ?? 0,
  }))
}

export async function resetProgress(scope: {
  subjectId?: string
  unitId?: string
  examId?: string
}): Promise<number> {
  const { data, error } = await supabase.rpc('reset_progress', {
    p_subject_id: scope.subjectId ?? undefined,
    p_unit_id: scope.unitId ?? undefined,
    p_exam_id: scope.examId ?? undefined,
  })
  if (error) throw error
  return data ?? 0
}
