/**
 * 권한 키는 관리자가 DB(access_permissions)에 추가할 수 있다. 스터디 그룹을
 * 하나 만들 때마다 배포하지 않으려면 목록을 코드에 고정하면 안 되므로,
 * 화면 코드에서 이름을 직접 적어 쓰는 것들만 상수로 둔다.
 */
export type PermissionKey = string

export const PERMISSION = {
  studyHapbon3: 'study_hapbon3',
  aiSolutionView: 'ai_solution_view',
  seniorSolutionView: 'senior_solution_view',
} as const

/**
 * feature: 기능 하나를 여는 권한 (AI 풀이 탭 등)
 * study  : 스터디 그룹. 이 권한으로 쓴 풀이는 같은 권한자만 읽는다.
 * cohort : 특정 학번의 문제를 볼 수 있는 권한.
 * curriculum : 특정 학년·학기 계통 시험을 볼 수 있는 권한.
 */
export type PermissionKind = 'feature' | 'study' | 'cohort' | 'curriculum'

export const PERMISSION_KIND_LABEL: Record<PermissionKind, string> = {
  feature: '기능',
  study: '스터디',
  cohort: '학번',
  curriculum: '계통',
}

export type AccessPermission = {
  key: PermissionKey
  name: string
  description: string | null
  kind: PermissionKind
  sortOrder: number
}

/** DB 값은 신뢰할 수 없으므로 모르는 값은 기능 권한으로 본다. */
export function toPermissionKind(value: string): PermissionKind {
  return value === 'study' || value === 'cohort' || value === 'curriculum' ? value : 'feature'
}
