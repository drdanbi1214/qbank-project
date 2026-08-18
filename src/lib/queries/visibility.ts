import { supabase } from '@/lib/supabase'
import { toPermissionKind, type AccessPermission, type PermissionKind } from '@/lib/permissions'

// =============================================================================
// 공개 범위 관리 (관리자 전용)
//
// 시험의 required_permission 이 null 이면 전체공개다. 값이 있으면 그 권한을
// 가진 사람만 그 시험의 문제를 볼 수 있다.
// =============================================================================

export type AdminExam = {
  id: string
  cohort: string
  examName: string
  subjectName: string
  questionCount: number
  requiredPermission: string | null
  status: 'draft' | 'published'
}

export async function fetchAdminExams(): Promise<AdminExam[]> {
  // 문제 수는 집계 임베드 대신 이미 쓰고 있는 RPC 에서 가져온다.
  // 관리자에게는 숨긴 학번까지 전부 세어 돌려준다.
  const [examResult, progressResult] = await Promise.all([
    supabase.from('exams').select('id, cohort, exam_name, status, required_permission, subjects (name)'),
    supabase.rpc('get_progress_by_exam'),
  ])

  if (examResult.error) throw examResult.error
  if (progressResult.error) throw progressResult.error

  const countByExam = new Map(
    (progressResult.data ?? []).map((row) => [row.exam_id, row.total_questions ?? 0]),
  )

  type Row = {
    id: string
    cohort: string
    exam_name: string
    status: string
    required_permission: string | null
    subjects: { name: string } | null
  }

  return ((examResult.data ?? []) as unknown as Row[])
    .map((row) => ({
      id: row.id,
      cohort: row.cohort,
      examName: row.exam_name,
      subjectName: row.subjects?.name ?? '(과목 없음)',
      questionCount: countByExam.get(row.id) ?? 0,
      requiredPermission: row.required_permission,
      status: row.status === 'published' ? ('published' as const) : ('draft' as const),
    }))
    .sort(
      (a, b) =>
        a.cohort.localeCompare(b.cohort) ||
        a.subjectName.localeCompare(b.subjectName) ||
        a.examName.localeCompare(b.examName),
    )
}

/** null 을 주면 전체공개로 되돌린다. 관리자가 아니면 DB 트리거가 막는다. */
export async function setExamPermission(
  examId: string,
  permissionKey: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('exams')
    .update({ required_permission: permissionKey })
    .eq('id', examId)
  if (error) throw error
}

/** 시험 단위 공개 상태. draft 시험은 권한이 있어도 학생 목록에 나타나지 않는다. */
export async function setExamStatus(examId: string, status: 'draft' | 'published'): Promise<void> {
  const { error } = await supabase.from('exams').update({ status }).eq('id', examId)
  if (error) throw error
}

/** 같은 학번의 시험을 한 번에 바꾼다. */
export async function setCohortPermission(
  cohort: string,
  permissionKey: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('exams')
    .update({ required_permission: permissionKey })
    .eq('cohort', cohort)
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 권한(스터디 그룹) 관리
// -----------------------------------------------------------------------------

export async function createPermission(params: {
  key: string
  name: string
  description: string | null
  kind: PermissionKind
  sortOrder: number
}): Promise<void> {
  const { error } = await supabase.from('access_permissions').insert({
    key: params.key,
    name: params.name,
    description: params.description,
    kind: params.kind,
    sort_order: params.sortOrder,
  })
  if (error) throw error
}

export async function updatePermission(
  key: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  const { error } = await supabase.from('access_permissions').update(patch).eq('key', key)
  if (error) throw error
}

/** 관리자용 전체 목록. 일반 사용자는 RLS 때문에 자기 권한만 받는다. */
export async function fetchAllPermissions(): Promise<AccessPermission[]> {
  const { data, error } = await supabase
    .from('access_permissions')
    .select('key, name, description, kind, sort_order')
    .order('sort_order')

  if (error) throw error
  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    kind: toPermissionKind(row.kind),
    sortOrder: row.sort_order,
  }))
}
