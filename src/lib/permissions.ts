export const PERMISSION_KEYS = ['study_hapbon3', 'ai_solution_view'] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  study_hapbon3: '합본3 스터디',
  ai_solution_view: 'AI 풀이 탭',
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value)
}
