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

/** 문항 일괄 배정. 이미 같은 담당자에게 배정된 문항은 건너뛴다. */
export async function assignQuestions(params: {
  questionIds: string[]
  assigneeId: string
  assignedBy: string
  dueDate: string | null
}): Promise<number> {
  if (params.questionIds.length === 0) return 0

  const rows = params.questionIds.map((questionId) => ({
    question_id: questionId,
    assignee_id: params.assigneeId,
    assigned_by: params.assignedBy,
    due_date: params.dueDate,
  }))

  const { data, error } = await supabase
    .from('assignments')
    .upsert(rows, { onConflict: 'question_id,assignee_id', ignoreDuplicates: true })
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
