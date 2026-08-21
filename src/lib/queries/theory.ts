import { supabase } from '@/lib/supabase'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

export type TheoryDocument = {
  id: string
  subjectId: string
  unitId: string | null
  parentId: string | null
  sourceKey: string | null
  hasContent: boolean
  title: string
  content: RichDoc
  sortOrder: number
  updatedAt: string
}

type TheoryRow = {
  id: string
  subject_id: string
  unit_id: string | null
  parent_id: string | null
  source_key: string | null
  has_content: boolean
  title: string
  content: unknown
  sort_order: number
  updated_at: string
}

export async function fetchTheoryDocuments(subjectId?: string): Promise<TheoryDocument[]> {
  let query = supabase
    .from('theory_documents')
    .select('id, subject_id, unit_id, parent_id, source_key, has_content, title, content, sort_order, updated_at')
    .order('sort_order')
    .order('title')

  if (subjectId) query = query.eq('subject_id', subjectId)

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as TheoryRow[]).map((row) => ({
    id: row.id,
    subjectId: row.subject_id,
    unitId: row.unit_id,
    parentId: row.parent_id,
    sourceKey: row.source_key,
    hasContent: row.has_content,
    title: row.title,
    content: parseRichDoc(row.content),
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }))
}

export async function updateTheoryDocumentContent(id: string, content: RichDoc): Promise<string> {
  const { data, error } = await supabase
    .from('theory_documents')
    .update({ content: toJson(content) })
    .eq('id', id)
    .select('updated_at')
    .single()

  if (error) throw error
  return data.updated_at
}

/**
 * 목차에서 형제끼리 자리를 맞바꾼다.
 *
 * sort_order 는 지금 중분류가 100·200, 소단원이 1·2·3 처럼 자릿수가 섞여
 * 있다. 전체를 다시 매기면 그 규칙이 깨지므로 두 문서의 값만 교환한다.
 * 값이 같으면(가져올 때 제목으로 2차 정렬되는 경우) 교환이 뜻이 없으므로
 * 아래쪽에 +1 을 준다.
 */
export async function swapTheoryOrder(
  a: { id: string; sortOrder: number },
  b: { id: string; sortOrder: number },
): Promise<void> {
  const [first, second] =
    a.sortOrder === b.sortOrder
      ? [a.sortOrder, a.sortOrder + 1]
      : [b.sortOrder, a.sortOrder]

  const results = await Promise.all([
    supabase.from('theory_documents').update({ sort_order: first }).eq('id', a.id),
    supabase.from('theory_documents').update({ sort_order: second }).eq('id', b.id),
  ])
  const failed = results.find((result) => result.error)
  if (failed?.error) throw failed.error
}

/**
 * 문서를 다른 상위 항목 아래로 옮긴다.
 *
 * 옮긴 자리에서 맨 뒤에 서도록 형제들의 최대 sort_order 다음 값을 준다.
 * 자기 자신이나 자기 자손 밑으로는 옮길 수 없다 — 목차가 고리를 이루면
 * 화면을 그리다 무한히 돈다. 그 검사는 부르는 쪽에서 한다.
 */
export async function moveTheoryDocument(id: string, parentId: string | null): Promise<void> {
  let query = supabase.from('theory_documents').select('sort_order')
  query = parentId === null ? query.is('parent_id', null) : query.eq('parent_id', parentId)

  const { data, error } = await query.order('sort_order', { ascending: false }).limit(1)
  if (error) throw error

  const last = (data ?? [])[0]?.sort_order ?? 0
  const { error: moveError } = await supabase
    .from('theory_documents')
    .update({ parent_id: parentId, sort_order: last + 1 })
    .eq('id', id)
  if (moveError) throw moveError
}
