import { supabase } from '@/lib/supabase'
import { toPermissionKind, type AccessPermission } from '@/lib/permissions'

/**
 * 권한 목록.
 *
 * RLS 때문에 관리자는 전체를, 일반 사용자는 자기가 가진 권한만 받는다.
 * 그래서 일반 사용자 화면에서는 "내가 고를 수 있는 공개범위" 목록으로
 * 그대로 쓸 수 있다.
 */
export async function fetchAccessPermissions(): Promise<AccessPermission[]> {
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
