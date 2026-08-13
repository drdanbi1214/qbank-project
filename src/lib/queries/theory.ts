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
