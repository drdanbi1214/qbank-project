import { supabase } from '@/lib/supabase'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

/** 개인노트도 풀이와 같은 연결 규칙을 따른다. 그룹이 있으면 그룹, 없으면 문제. */
export type NoteTarget = {
  questionId: string
  groupId: string | null
}

export type PersonalNote = {
  id: string
  content: RichDoc
  updatedAt: string
}

export async function fetchNote(target: NoteTarget): Promise<PersonalNote | null> {
  let query = supabase.from('personal_notes').select('id, content, updated_at')

  query = target.groupId
    ? query.eq('group_id', target.groupId)
    : query.eq('question_id', target.questionId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null

  return { id: data.id, content: parseRichDoc(data.content), updatedAt: data.updated_at }
}

export async function saveNote(params: {
  target: NoteTarget
  userId: string
  content: RichDoc
}): Promise<void> {
  // UNIQUE(user_id, coalesce(group_id, question_id)) 라 부분 인덱스 기반 upsert 를
  // 쓸 수 없다. 기존 행을 먼저 찾아 update 하거나 새로 넣는다.
  const existing = await fetchNote(params.target)

  if (existing) {
    const { error } = await supabase
      .from('personal_notes')
      .update({ content: toJson(params.content) })
      .eq('id', existing.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('personal_notes').insert({
    group_id: params.target.groupId,
    question_id: params.target.groupId ? null : params.target.questionId,
    user_id: params.userId,
    content: toJson(params.content),
  })
  if (error) throw error
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('personal_notes').delete().eq('id', id)
  if (error) throw error
}
