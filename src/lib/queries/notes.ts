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

/**
 * 문제집 PDF 내보내기용. 여러 문항(그룹 포함)에 대한 내 메모를 한 번에 받는다.
 * personal_notes 는 RLS 로 본인 행만 보이므로 user_id 조건은 필요 없다.
 * 반환 키는 그룹이 있으면 group_id, 없으면 question_id (NoteTarget 규칙과 동일).
 */
export async function fetchNotesForTargets(targets: NoteTarget[]): Promise<Map<string, RichDoc>> {
  const questionIds = targets.filter((t) => !t.groupId).map((t) => t.questionId)
  const groupIds = [...new Set(targets.filter((t) => t.groupId).map((t) => t.groupId as string))]
  if (questionIds.length === 0 && groupIds.length === 0) return new Map()

  const clauses: string[] = []
  if (questionIds.length > 0) clauses.push(`question_id.in.(${questionIds.join(',')})`)
  if (groupIds.length > 0) clauses.push(`group_id.in.(${groupIds.join(',')})`)

  const { data, error } = await supabase
    .from('personal_notes')
    .select('question_id, group_id, content')
    .or(clauses.join(','))
  if (error) throw error

  const map = new Map<string, RichDoc>()
  for (const row of data ?? []) {
    const key = row.group_id ?? row.question_id
    if (key) map.set(key, parseRichDoc(row.content))
  }
  return map
}

export type AllUsersNote = {
  userId: string
  displayName: string
  content: RichDoc
  updatedAt: string
}

/**
 * 관리자 전용. 문항(또는 그룹) 하나에 달린 모든 사람의 개인 메모를 본다.
 * RLS 의 personal_notes_admin_select 정책이 관리자에게만 전체 행을 열어준다.
 */
export async function fetchAllNotes(target: NoteTarget): Promise<AllUsersNote[]> {
  let query = supabase
    .from('personal_notes')
    .select('user_id, content, updated_at')

  query = target.groupId
    ? query.eq('group_id', target.groupId)
    : query.eq('question_id', target.questionId)

  const { data, error } = await query.order('updated_at', { ascending: false })
  if (error) throw error
  if (!data || data.length === 0) return []

  const ids = [...new Set(data.map((row) => row.user_id))]
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', ids)
  if (profileError) throw profileError

  const nameById = new Map((profiles ?? []).map((row) => [row.id, row.display_name]))

  return data.map((row) => ({
    userId: row.user_id,
    displayName: nameById.get(row.user_id) ?? '알 수 없음',
    content: parseRichDoc(row.content),
    updatedAt: row.updated_at,
  }))
}
