import { supabase } from '@/lib/supabase'

export type TheoryMemo = {
  id: string
  documentId: string
  from: number
  to: number
  selectedText: string
  body: string
  imagePaths: string[]
}

function fromRow(row: {
  id: string
  document_id: string
  anchor_from: number
  anchor_to: number
  selected_text: string
  body: string
  image_paths: string[]
}): TheoryMemo {
  return {
    id: row.id,
    documentId: row.document_id,
    from: row.anchor_from,
    to: row.anchor_to,
    selectedText: row.selected_text,
    body: row.body,
    imagePaths: row.image_paths,
  }
}

export async function fetchTheoryMemos(documentId: string): Promise<TheoryMemo[]> {
  const { data, error } = await supabase
    .from('theory_memos')
    .select('id, document_id, anchor_from, anchor_to, selected_text, body, image_paths')
    .eq('document_id', documentId)
    .order('anchor_from')
    .order('created_at')

  if (error) throw error
  return (data ?? []).map(fromRow)
}

export async function createTheoryMemo(params: {
  userId: string
  documentId: string
  from: number
  to: number
  selectedText: string
}): Promise<TheoryMemo> {
  const { data, error } = await supabase
    .from('theory_memos')
    .insert({
      user_id: params.userId,
      document_id: params.documentId,
      anchor_from: params.from,
      anchor_to: params.to,
      selected_text: params.selectedText.slice(0, 500),
      body: '',
      image_paths: [],
    })
    .select('id, document_id, anchor_from, anchor_to, selected_text, body, image_paths')
    .single()

  if (error) throw error
  return fromRow(data)
}

export async function updateTheoryMemo(
  id: string,
  patch: { body?: string; imagePaths?: string[] },
): Promise<void> {
  const values: { body?: string; image_paths?: string[] } = {}
  if (patch.body !== undefined) values.body = patch.body
  if (patch.imagePaths !== undefined) values.image_paths = patch.imagePaths
  const { error } = await supabase.from('theory_memos').update(values).eq('id', id)
  if (error) throw error
}

export async function deleteTheoryMemo(id: string): Promise<void> {
  const { error } = await supabase.from('theory_memos').delete().eq('id', id)
  if (error) throw error
}
