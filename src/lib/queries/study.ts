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
  /** `문제`, `선지` 또는 `풀이` */
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

export type SessionMode = 'sequential' | 'block_test' | 'wrong_only' | 'bookmark' | 'daily'

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

/** 이어풀기 대상. 진행 중인 가장 최근 세션 하나만 본다. 오늘의 문제는 별도 카드로 보여주므로 제외한다. */
export async function fetchOpenSession(): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select('id, mode, scope, question_ids, current_index, time_limit_sec, started_at, status')
    .eq('status', 'in_progress')
    .neq('mode', 'daily')
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
  // 오늘의 문제는 독립된 흐름이라 여기서 건드리지 않는다.
  await supabase
    .from('study_sessions')
    .update({ status: 'abandoned' })
    .eq('user_id', params.userId)
    .eq('status', 'in_progress')
    .neq('mode', 'daily')

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

/** 셔플 버튼으로 문제 순서를 바꿨을 때, 새로고침해도 유지되도록 순서 자체를 다시 저장한다. */
export async function updateSessionOrder(id: string, questionIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ question_ids: questionIds, current_index: 0 })
    .eq('id', id)
  if (error) console.error('문제 순서를 저장하지 못했습니다.', error)
}

export async function finishSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('study_sessions')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 오늘의 문제
//   26학번 학년말고사 전 과목 중 매일 같은 10문제를, 모든 사용자가 동일하게 푼다.
//   문제 목록은 서버(get_daily_question_set)가 날짜를 시드로 결정적으로 뽑아
//   저장해두고, 진행 위치는 study_sessions 를 그대로 재사용한다(mode: 'daily').
// -----------------------------------------------------------------------------

export type DailyChallengeDay = { date: string; total: number; done: number }

export type DailyChallengeStats = {
  currentStreak: number
  longestStreak: number
  totalDays: number
  history: DailyChallengeDay[]
}

/** 오늘 날짜(KST)의 고정 10문제. 서버가 최초 1회 생성해 저장하고, 그 뒤로는 같은 값을 돌려준다. */
export async function fetchDailyQuestionSet(): Promise<{ date: string; questionIds: string[] }> {
  const { data, error } = await supabase.rpc('get_daily_question_set')
  if (error) throw error
  const row = data as { date: string; question_ids: string[] }
  return { date: row.date, questionIds: row.question_ids }
}

/** 이 사용자가 만든 가장 최근 오늘의 문제 세션. 날짜가 오늘과 같은지는 호출부에서 scope.date 로 확인한다. */
async function fetchLatestDailySession(userId: string): Promise<StudySession | null> {
  const { data, error } = await supabase
    .from('study_sessions')
    .select('id, mode, scope, question_ids, current_index, time_limit_sec, started_at, status')
    .eq('user_id', userId)
    .eq('mode', 'daily')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? toSession(data as SessionRow) : null
}

/** 오늘의 문제 세션을 새로 만든다. 다른 모드 세션을 밀어내지 않는다(startSession 과 달리 독립적으로 공존). */
async function startDailySession(params: {
  userId: string
  date: string
  questionIds: string[]
}): Promise<string> {
  const { data, error } = await supabase
    .from('study_sessions')
    .insert({
      user_id: params.userId,
      mode: 'daily',
      scope: { date: params.date } as never,
      question_ids: params.questionIds,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/** 오늘의 문제 카드를 열 때 호출. 오늘 것이 이미 있으면 이어가고, 없으면 새로 만든다. */
export async function ensureDailySession(
  userId: string,
): Promise<{ sessionId: string; date: string; questionIds: string[] }> {
  const { date, questionIds } = await fetchDailyQuestionSet()
  const existing = await fetchLatestDailySession(userId)

  if (existing && existing.scope.date === date) {
    return { sessionId: existing.id, date, questionIds: existing.questionIds }
  }

  const sessionId = await startDailySession({ userId, date, questionIds })
  return { sessionId, date, questionIds }
}

/** 연속 성공일, 최고 기록, 총 성공일, 최근 히스토리(현황 보기 화면용). */
export async function fetchDailyChallengeStats(): Promise<DailyChallengeStats> {
  const { data, error } = await supabase.rpc('get_daily_challenge_stats')
  if (error) throw error
  const row = data as {
    current_streak: number
    longest_streak: number
    total_days: number
    history: { date: string; total: number; done: number }[]
  }
  return {
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    totalDays: row.total_days,
    history: row.history,
  }
}

export type DailyChallengeLeaderboardEntry = {
  userId: string
  displayName: string
  avatarUrl: string | null
  currentStreak: number
  longestStreak: number
  totalDays: number
}

/** 연속 성공일 기준 전체 순위. 한 번도 성공한 적 없는 사용자는 제외한다. */
export async function fetchDailyChallengeLeaderboard(): Promise<DailyChallengeLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_daily_challenge_leaderboard')
  if (error) throw error
  const rows = data as {
    user_id: string
    display_name: string
    avatar_url: string | null
    current_streak: number
    longest_streak: number
    total_days: number
  }[]
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    totalDays: row.total_days,
  }))
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
