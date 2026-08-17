import { supabase } from '@/lib/supabase'

export type AssignmentStatus = 'pending' | 'in_progress' | 'done'

export type MyAssignment = {
  assignmentId: string
  questionId: string
  status: AssignmentStatus
  dueDate: string | null
  completedAt: string | null
  subjectId: string
  subjectName: string
  unitId: string | null
  unitName: string | null
  examId: string
  cohort: string
  examName: string
  questionNumber: number
  questionType: string
  stemPreview: string
  hasMySolution: boolean
  /** 이 배정이 매인 스터디 공개범위. null 이면 특정 스터디에 매이지 않은 배정. */
  requiredPermission: string | null
}

export async function fetchMyAssignments(): Promise<MyAssignment[]> {
  const { data, error } = await supabase.rpc('get_my_assignments')
  if (error) throw error

  return (data ?? []).map((row) => ({
    assignmentId: row.assignment_id,
    questionId: row.question_id,
    status: (row.status as AssignmentStatus) ?? 'pending',
    dueDate: row.due_date,
    completedAt: row.completed_at,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    unitId: row.unit_id,
    unitName: row.unit_name,
    examId: row.exam_id,
    cohort: row.cohort,
    examName: row.exam_name,
    questionNumber: row.question_number,
    questionType: row.question_type,
    stemPreview: row.stem_preview ?? '',
    hasMySolution: row.has_my_solution ?? false,
    requiredPermission: row.required_permission,
  }))
}

export async function countMyOpenAssignments(): Promise<number> {
  const { data, error } = await supabase.rpc('count_my_open_assignments')
  if (error) {
    console.error('배정 개수를 불러오지 못했습니다.', error)
    return 0
  }
  return data ?? 0
}

export type AssignmentProgress = {
  assigneeId: string
  displayName: string
  total: number
  done: number
  overdue: number
}

export async function fetchAssignmentProgress(): Promise<AssignmentProgress[]> {
  const { data, error } = await supabase.rpc('get_assignment_progress')
  if (error) throw error
  return (data ?? []).map((row) => ({
    assigneeId: row.assignee_id,
    displayName: row.display_name,
    total: row.total ?? 0,
    done: row.done ?? 0,
    overdue: row.overdue ?? 0,
  }))
}

/** 배정 관리 화면에서 담당자 이름을 눌렀을 때, 그 사람이 완료한 문항을 본다. */
export async function fetchCompletedAssignmentQuestionIds(
  assigneeId: string,
): Promise<{ questionId: string; completedAt: string | null }[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('question_id, completed_at')
    .eq('assignee_id', assigneeId)
    .eq('status', 'done')
    .order('completed_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => ({ questionId: row.question_id, completedAt: row.completed_at }))
}

/** 이미 누군가에게 배정된 문항 id 전체. 한 문항은 한 명에게만 배정되므로
 * 이 목록에 있는 문항은 배정 화면에서 선택 대상으로 보여주지 않는다. */
export async function fetchAssignedQuestionIds(): Promise<Set<string>> {
  // 배정은 문항 수만큼 늘어난다. 한 번에 다 받으면 PostgREST 반환 상한에
  // 걸려 조용히 잘리고, 이미 배정된 문항이 '배정 가능' 으로 보이게 된다.
  // 나눠 받아 전체 개수와 맞을 때까지 돈다.
  const PAGE = 500
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase
      .from('assignments')
      .select('question_id', { count: 'exact' })
      .order('question_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error

    const page = data ?? []
    ids.push(...page.map((row) => row.question_id))
    if (page.length === 0 || (count !== null && ids.length >= count)) break
  }
  return new Set(ids)
}

/** 문항 일괄 배정. 이미 다른 사람에게 배정된 문항(레이스 컨디션 등)은 건너뛴다. */
export async function assignQuestions(params: {
  questionIds: string[]
  assigneeId: string
  assignedBy: string
  dueDate: string | null
  /** 이 배정이 매일 스터디 공개범위. null 이면 특정 스터디에 매이지 않는다. */
  requiredPermission: string | null
}): Promise<number> {
  if (params.questionIds.length === 0) return 0

  const rows = params.questionIds.map((questionId) => ({
    question_id: questionId,
    assignee_id: params.assigneeId,
    assigned_by: params.assignedBy,
    due_date: params.dueDate,
    required_permission: params.requiredPermission,
  }))

  const { data, error } = await supabase
    .from('assignments')
    .upsert(rows, { onConflict: 'question_id', ignoreDuplicates: true })
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

export async function updateAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
): Promise<void> {
  const { error } = await supabase
    .from('assignments')
    .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', assignmentId)
  if (error) throw error
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', assignmentId)
  if (error) throw error
}
