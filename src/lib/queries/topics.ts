import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { emptyDoc, parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

/**
 * 테마 — 주제 하나를 이론으로 정리한 글.
 *
 * theory_documents 와는 별개다. 그쪽은 Notion 에서 임포트한 미러라 폴더 계층을
 * 그대로 들고 있고, 이쪽은 스터디원이 손으로 쓰는 편집물이다.
 *
 * 위키식이라 열람할 수 있으면 편집도 할 수 있다. 되돌리기는 revisions 에
 * 쌓이는 이력으로 한다(트리거가 자동으로 남긴다).
 */

export type Topic = {
  id: string
  subjectId: string
  /** 대표 단원. 목록에서 어디에 놓일지 정한다. */
  unitId: string | null
  /** 대표 단원 말고 더 걸치는 단원들 */
  extraUnitIds: string[]
  title: string
  content: RichDoc
  requiredPermission: string
  createdBy: string | null
  updatedBy: string | null
  updatedAt: string
}

type TopicRow = {
  id: string
  subject_id: string
  unit_id: string | null
  title: string
  content: unknown
  required_permission: string
  created_by: string | null
  updated_by: string | null
  updated_at: string
  topic_units?: { unit_id: string }[] | null
}

const TOPIC_SELECT =
  'id, subject_id, unit_id, title, content, required_permission, created_by, updated_by, updated_at, topic_units (unit_id)'

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    subjectId: row.subject_id,
    unitId: row.unit_id,
    extraUnitIds: (row.topic_units ?? []).map((item) => item.unit_id),
    title: row.title,
    content: parseRichDoc(row.content),
    requiredPermission: row.required_permission,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

/**
 * 목록. 본문까지 함께 받는다.
 *
 * 본문이 큰 편이지만 한 과목의 테마가 수백 개가 될 일은 없고, 목록에서 미리보기
 * 몇 줄을 보여주려면 어차피 필요하다. 무거워지면 그때 나눈다.
 */
export async function fetchTopics(subjectId: string): Promise<Topic[]> {
  const { data, error } = await supabase
    .from('topics')
    .select(TOPIC_SELECT)
    .eq('subject_id', subjectId)
    .order('title')

  if (error) throw error
  return ((data ?? []) as TopicRow[]).map(toTopic)
}

/**
 * 과목별 테마 개수. 첫 화면의 카드에 쓴다.
 *
 * 본문까지 받으면 무거우므로 subject_id 만 받아 센다. RLS 가 권한 없는 테마를
 * 걸러 주므로 여기서 따로 필터하지 않는다.
 */
export async function fetchAllTopicCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('topics').select('subject_id')
  if (error) throw error

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.subject_id, (counts.get(row.subject_id) ?? 0) + 1)
  }
  return counts
}

export async function fetchTopic(id: string): Promise<Topic | null> {
  const { data, error } = await supabase
    .from('topics')
    .select(TOPIC_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? toTopic(data as TopicRow) : null
}

export async function createTopic(params: {
  subjectId: string
  unitId: string | null
  title: string
  userId: string
}): Promise<string> {
  const { data, error } = await supabase
    .from('topics')
    .insert({
      subject_id: params.subjectId,
      unit_id: params.unitId,
      title: params.title.trim(),
      content: toJson(emptyDoc()),
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function updateTopic(params: {
  id: string
  userId: string
  title?: string
  unitId?: string | null
  content?: RichDoc
}): Promise<void> {
  const patch: Database['public']['Tables']['topics']['Update'] = {
    updated_by: params.userId,
  }
  if (params.title !== undefined) patch.title = params.title.trim()
  if (params.unitId !== undefined) patch.unit_id = params.unitId
  if (params.content !== undefined) patch.content = toJson(params.content)

  const { error } = await supabase.from('topics').update(patch).eq('id', params.id)
  if (error) throw error
}

export async function deleteTopic(id: string): Promise<void> {
  const { error } = await supabase.from('topics').delete().eq('id', id)
  if (error) throw error
}

/** 대표 단원 말고 더 걸치는 단원을 통째로 갈아끼운다. */
export async function setExtraUnits(topicId: string, unitIds: string[]): Promise<void> {
  const { error: clearError } = await supabase
    .from('topic_units')
    .delete()
    .eq('topic_id', topicId)
  if (clearError) throw clearError

  if (unitIds.length === 0) return

  const { error } = await supabase
    .from('topic_units')
    .insert(unitIds.map((unitId) => ({ topic_id: topicId, unit_id: unitId })))
  if (error) throw error
}

/**
 * 비슷한 제목의 테마를 찾는다.
 *
 * 두 사람이 "심부전 약물치료" 를 각각 만들면 이론이 갈라진다. 만들기 전에
 * 경고만 하고 막지는 않는다 — 정말 다른 주제인데 제목만 닮은 경우가 있다.
 */
export async function findSimilarTopics(
  subjectId: string,
  title: string,
): Promise<{ id: string; title: string }[]> {
  const keyword = title.trim()
  if (keyword.length < 2) return []

  const { data, error } = await supabase
    .from('topics')
    .select('id, title')
    .eq('subject_id', subjectId)
    .ilike('title', `%${keyword}%`)
    .limit(5)

  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, title: row.title }))
}
