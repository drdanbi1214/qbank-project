import { supabase } from '@/lib/supabase'

// =============================================================================
// Phase 4 학습 도구 조회
//   오답노트, 북마크 목록, 검색, 학습 세션(이어풀기, 블록테스트), 마이페이지 통계
// =============================================================================

export type WrongNote = {
  questionId: string
  examId: string
  unitId: string | null
  questionNumber: number
  stemText: string | null
  answerStatus: string
  totalAttempts: number
  wrongCount: number
  lastAttemptAt: string
  lastIsCorrect: boolean
  /** 최근 3회 시도가 모두 오답인 문제. 목록에서 따로 강조한다. */
  recentAllWrong: boolean
}

export type WrongNoteFilter = {
  subjectId?: string | null
  unitId?: string | null
  examId?: string | null
  cohort?: string | null
}

export async function fetchWrongNotes(filter: WrongNoteFilter = {}): Promise<WrongNote[]> {
  const { data, error } = await supabase.rpc('get_wrong_notes', {
    p_subject_id: filter.subjectId ?? undefined,
    p_unit_id: filter.unitId ?? undefined,
    p_exam_id: filter.examId ?? undefined,
    p_cohort: filter.cohort ?? undefined,
  })
  if (error) throw error

  return (data ?? []).map((row) => ({
    questionId: row.question_id,
    examId: row.exam_id,
    unitId: row.unit_id,
    questionNumber: row.question_number ?? 0,
    stemText: row.stem_text,
    answerStatus: row.answer_status ?? 'confirmed',
    totalAttempts: row.total_attempts ?? 0,
    wrongCount: row.wrong_count ?? 0,
    lastAttemptAt: row.last_attempt_at ?? '',
    lastIsCorrect: row.last_is_correct ?? false,
    recentAllWrong: row.recent_all_wrong ?? false,
  }))
}

// -----------------------------------------------------------------------------
// 북마크 목록
// -----------------------------------------------------------------------------

export type BookmarkedQuestion = {
  questionId: string
  examId: string
  unitId: string | null
  questionNumber: number
  stemText: string | null
  createdAt: string
}

export async function fetchBookmarkedQuestions(): Promise<BookmarkedQuestion[]> {
  const { data, error } = await supabase
    .from('bookmarks')
    .select('question_id, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  const ids = (data ?? []).map((row) => row.question_id)
  if (ids.length === 0) return []

  const { data: questions, error: questionError } = await supabase
    .from('questions_solve')
    .select('id, exam_id, unit_id, question_number, stem_text')
    .in('id', ids)

  if (questionError) throw questionError

  const byId = new Map((questions ?? []).map((row) => [row.id, row]))
  return (data ?? []).flatMap((row) => {
    const question = byId.get(row.question_id)
    if (!question?.id || !question.exam_id) return []
    return [
      {
        questionId: question.id,
        examId: question.exam_id,
        unitId: question.unit_id,
        questionNumber: question.question_number ?? 0,
        stemText: question.stem_text,
        createdAt: row.created_at,
      },
    ]
  })
}

// -----------------------------------------------------------------------------
// 검색
// -----------------------------------------------------------------------------

export type SearchHit = {
  questionId: string
  examId: string
  unitId: string | null
  questionNumber: number
  stemText: string | null
  score: number
  /** `문제` 또는 `풀이` */
  matchedIn: string
  snippet: string | null
}

export async function searchQuestions(params: {
  query: string
  includeSolutions: boolean
  subjectId?: string | null
  cohort?: string | null
}): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc('search_questions', {
    p_query: params.query,
    p_include_solutions: params.includeSolutions,
    p_subject_id: params.subjectId ?? undefined,
    p_cohort: params.cohort ?? undefined,
  })
  if (error) throw error

  return (data ?? [])
    .map((row) => ({
      questionId: row.question_id,
      examId: row.exam_id,
      unitId: row.unit_id,
      questionNumber: row.question_number ?? 0,
      stemText: row.stem_text,
      score: row.score ?? 0,
      matchedIn: row.matched_in ?? '문제',
      snippet: row.snippet,
    }))
    .sort((a, b) => b.score - a.score)
}

// -----------------------------------------------------------------------------
// 학습 세션 (이어풀기, 블록테스트)
// -----------------------------------------------------------------------------

export type SessionMode = 'sequential' | 'block_test' | 'wrong_only' | 'bookmark'

export type StudySession = {
  id: string
  mode: SessionMode
  scope: Record<string, unknown>
  questionIds: string[]
  currentIndex: number
  timeLimitSec: number | null
  startedAt: string
  status: 'in_progress' | 'completed' | 'abandoned'
}

type SessionRow = {
  id: string
  mode: string
  scope: unknown
  question_ids: string[]
  current_index: number
  time_limit_sec: number | null
  started_at: string
  status: string
}

function toSession(row: SessionRow): StudySession {
  return {
    id: row.id,
    mode: row.mode as SessionMode,
    scope: (row.scope ?? {}) as Record<string, unknown>,
    questionIds: row.question_ids ?? [],
    currentIndex: row.current_index ?? 0,
    timeLimitSec: row.time_limit_sec,
    startedAt: row.started_at,
    status: row.status as StudySession['status'],
  }
}

/** 이어풀기 대상. 진행 중인 가장 최근 세션 하나만 본다. */
export async function fetchOpenSession(): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select('id, mode, scope, question_ids, current_index, time_limit_sec, started_at, status')
    .eq('status', 'in_progress')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? toSession(data as SessionRow) : null
}

export async function fetchSession(id: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select('id, mode, scope, question_ids, current_index, time_limit_sec, started_at, status')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? toSession(data as SessionRow) : null
}

export async function startSession(params: {
  userId: string
  mode: SessionMode
  scope: Record<string, unknown>
  questionIds: string[]
  timeLimitSec?: number | null
}): Promise<string> {
  // 같은 사람의 예전 진행 중 세션은 접어둔다. 이어풀기는 하나만 유지한다.
  await supabase
    .from('study_sessions')
    .update({ status: 'abandoned' })
    .eq('user_id', params.userId)
    .eq('status', 'in_progress')

  const { data, error } = await supabase
    .from('study_sessions')
    .insert({
      user_id: params.userId,
      mode: params.mode,
      scope: params.scope as never,
      question_ids: params.questionIds,
      time_limit_sec: params.timeLimitSec ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function updateSessionProgress(id: string, currentIndex: number): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ current_index: currentIndex })
    .eq('id', id)
  if (error) console.error('세션 진행 위치를 저장하지 못했습니다.', error)
}

export async function finishSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 마이페이지 요약
// -----------------------------------------------------------------------------

export type WeakUnit = {
  unitId: string
  unitName: string
  subjectName: string
  attempts: number
  accuracy: number
}

export type MySummary = {
  totalQuestions: number
  solved: number
  correct: number
  streakDays: number
  weakUnits: WeakUnit[]
  solutionCount: number
  upvotesReceived: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export async function fetchMySummary(): Promise<MySummary> {
  const { data, error } = await supabase.rpc('get_my_summary')
  if (error) throw error

  const empty: MySummary = {
    totalQuestions: 0,
    solved: 0,
    correct: 0,
    streakDays: 0,
    weakUnits: [],
    solutionCount: 0,
    upvotesReceived: 0,
  }
  if (!isRecord(data)) return empty

  // jsonb 로 온 값이라 생성 타입이 Json 유니온이다. unknown 으로 돌린 뒤 좁힌다.
  const weakUnits = Array.isArray(data.weak_units)
    ? (data.weak_units as unknown[]).filter(isRecord).map((row) => ({
        unitId: typeof row.unit_id === 'string' ? row.unit_id : '',
        unitName: typeof row.unit_name === 'string' ? row.unit_name : '',
        subjectName: typeof row.subject_name === 'string' ? row.subject_name : '',
        attempts: asNumber(row.attempts),
        accuracy: asNumber(row.accuracy),
      }))
    : []

  return {
    totalQuestions: asNumber(data.total_questions),
    solved: asNumber(data.solved),
    correct: asNumber(data.correct),
    streakDays: asNumber(data.streak_days),
    weakUnits,
    solutionCount: asNumber(data.solution_count),
    upvotesReceived: asNumber(data.upvotes_received),
  }
}
