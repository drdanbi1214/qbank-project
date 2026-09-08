import { supabase } from '@/lib/supabase'
import {
  type PersonalMemo,
  type TheoryMemoColor,
  THEORY_MEMO_COLORS,
} from '@/lib/queries/theoryMemos'
import { emptyDoc, parseRichDoc, richTextToPlain, toJson, type RichDoc } from '@/types/richtext'

type TopicMemoRow = {
  id: string
  topic_id: string
  anchor_from: number
  anchor_to: number
  selected_text: string
  content: unknown
  color: string
}

function safeColor(value: unknown): TheoryMemoColor {
  return typeof value === 'string' && THEORY_MEMO_COLORS.includes(value as TheoryMemoColor)
    ? value as TheoryMemoColor
    : 'yellow'
}

function fromRow(row: TopicMemoRow): PersonalMemo {
  return {
    id: row.id,
    // 공용 메모 작업공간에서는 대상 문서 ID라는 의미로 사용한다.
    documentId: row.topic_id,
    from: row.anchor_from,
    to: row.anchor_to,
    selectedText: row.selected_text,
    content: parseRichDoc(row.content),
    color: safeColor(row.color),
  }
}

export async function fetchTopicMemos(topicId: string): Promise<PersonalMemo[]> {
  const { data, error } = await supabase
    .from('topic_memos')
    .select('id, topic_id, anchor_from, anchor_to, selected_text, content, color')
    .eq('topic_id', topicId)
    .order('anchor_from')
    .order('created_at')

  if (error) throw error
  return (data ?? []).map(fromRow)
}

export async function createTopicMemo(params: {
  userId: string
  topicId: string
  from: number
  to: number
  selectedText: string
}): Promise<PersonalMemo> {
  const { data, error } = await supabase
    .from('topic_memos')
    .insert({
      user_id: params.userId,
      topic_id: params.topicId,
      anchor_from: params.from,
      anchor_to: params.to,
      selected_text: params.selectedText.slice(0, 500),
      content: toJson(emptyDoc()),
      color: 'yellow',
    })
    .select('id, topic_id, anchor_from, anchor_to, selected_text, content, color')
    .single()

  if (error) throw error
  return fromRow(data)
}

export async function updateTopicMemo(id: string, content: RichDoc): Promise<void> {
  const { error } = await supabase
    .from('topic_memos')
    .update({
      content: toJson(content),
      plain_text: richTextToPlain(content).slice(0, 10_000),
    })
    .eq('id', id)

  if (error) throw error
}

export async function updateTopicMemoColor(id: string, color: TheoryMemoColor): Promise<void> {
  const { error } = await supabase.from('topic_memos').update({ color }).eq('id', id)
  if (error) throw error
}

export async function deleteTopicMemo(id: string): Promise<void> {
  const { error } = await supabase.from('topic_memos').delete().eq('id', id)
  if (error) throw error
}
