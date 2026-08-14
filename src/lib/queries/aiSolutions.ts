import { supabase } from '@/lib/supabase'
import { parseRichDoc, type RichDoc } from '@/types/richtext'

export type AiSolution = {
  id: string
  questionId: string
  content: RichDoc
  createdAt: string
  updatedAt: string
}

type AiSolutionRow = {
  id: string
  question_id: string
  content: unknown
  created_at: string
  updated_at: string
}

/**
 * AI 풀이 탭 권한이 있는 사용자에게만 보인다. select RLS가 같은 권한으로
 * 막혀 있어 권한 없는 사용자가 호출하면 빈 결과(null)가 온다. 등록/수정은
 * 웹 화면에 없고 scripts/import_ai_solutions.py로 CSV 일괄 입력한다.
 */
export async function fetchAiSolution(questionId: string): Promise<AiSolution | null> {
  const { data, error } = await supabase
    .from('ai_solutions')
    .select('id, question_id, content, created_at, updated_at')
    .eq('question_id', questionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as AiSolutionRow
  return {
    id: row.id,
    questionId: row.question_id,
    content: parseRichDoc(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function hasAiSolution(questionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ai_solutions')
    .select('id')
    .eq('question_id', questionId)
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}
