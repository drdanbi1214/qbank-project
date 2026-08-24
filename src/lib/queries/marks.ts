import { supabase } from '@/lib/supabase'
import type { MarkStyle } from '@/components/marking/marks'

export type MarkTargetType =
  | 'question'
  | 'explanation'
  | 'solution'
  | 'ai_solution'
  | 'senior_solution'
  | 'theory'

export type TextMarkRow = {
  id: string
  targetType: MarkTargetType
  targetId: string
  from: number
  to: number
  style: MarkStyle
  selectedText: string | null
}

/**
 * 한 문제 화면에서 쓰는 표시를 한 번에 받아온다.
 * 문제 본문, 원본 해설, 그 문제에 달린 풀이들이 모두 대상이라 id 목록으로 조회한다.
 */
export async function fetchMarks(targetIds: string[]): Promise<TextMarkRow[]> {
  const unique = [...new Set(targetIds)].filter(Boolean)
  if (unique.length === 0) return []

  const { data, error } = await supabase
    .from('text_marks')
    .select('id, target_type, target_id, anchor_from, anchor_to, style, selected_text')
    .in('target_id', unique)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    targetType: row.target_type as MarkTargetType,
    targetId: row.target_id,
    from: row.anchor_from,
    to: row.anchor_to,
    style: row.style as MarkStyle,
    selectedText: row.selected_text,
  }))
}

export async function createMark(params: {
  userId: string
  targetType: MarkTargetType
  targetId: string
  from: number
  to: number
  style: MarkStyle
  selectedText: string
}): Promise<TextMarkRow> {
  const { data, error } = await supabase
    .from('text_marks')
    .insert({
      user_id: params.userId,
      target_type: params.targetType,
      target_id: params.targetId,
      anchor_from: params.from,
      anchor_to: params.to,
      style: params.style,
      selected_text: params.selectedText.slice(0, 300),
    })
    .select('id')
    .single()

  if (error) throw error

  return {
    id: data.id,
    targetType: params.targetType,
    targetId: params.targetId,
    from: params.from,
    to: params.to,
    style: params.style,
    selectedText: params.selectedText,
  }
}

export async function deleteMark(id: string): Promise<void> {
  const { error } = await supabase.from('text_marks').delete().eq('id', id)
  if (error) throw error
}

/** 선택 영역과 겹치는 표시를 모두 지운다 (지우개 버튼). */
export async function deleteMarksInRange(params: {
  targetType: MarkTargetType
  targetId: string
  from: number
  to: number
}): Promise<string[]> {
  const { data, error } = await supabase
    .from('text_marks')
    .delete()
    .eq('target_type', params.targetType)
    .eq('target_id', params.targetId)
    .lt('anchor_from', params.to)
    .gt('anchor_to', params.from)
    .select('id')

  if (error) throw error
  return (data ?? []).map((row) => row.id)
}
