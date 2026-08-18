import { supabase } from '@/lib/supabase'
import { toPermissionKind, type AccessPermission } from '@/lib/permissions'

/**
 * 권한 목록.
 *
 * RLS 때문에 관리자는 전체를, 일반 사용자는 자기가 가진 권한만 받는다.
 * 그래서 일반 사용자 화면에서는 "내가 고를 수 있는 공개범위" 목록으로
 * 그대로 쓸 수 있다.
 */
/**
 * 세션 동안 한 번만 받아 나눠 쓴다. 문제를 열 때마다 부르는 자리가 있는데
 * 15행짜리 표라 매번 왕복할 이유가 없다.
 */
let cached: Promise<AccessPermission[]> | null = null

export function fetchAccessPermissions(): Promise<AccessPermission[]> {
  if (!cached) {
    cached = loadAccessPermissions().catch((caught: unknown) => {
      // 실패한 약속을 캐시에 남기면 새로고침 전까지 계속 실패한다.
      cached = null
      throw caught
    })
  }
  return cached
}

async function loadAccessPermissions(): Promise<AccessPermission[]> {
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
