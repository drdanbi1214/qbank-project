import { supabase } from '@/lib/supabase'
import { parseRichDoc, type RichDoc } from '@/types/richtext'

export type SeniorSolution = {
  id: string
  questionId: string
  content: RichDoc
  createdAt: string
  updatedAt: string
}

type SeniorSolutionRow = {
  id: string
  question_id: string
  content: unknown
  created_at: string
  updated_at: string
}

/** RLS도 선배해설 권한으로 막혀 있어 권한 없이는 데이터 존재조차 조회할 수 없다. */
export async function fetchSeniorSolution(questionId: string): Promise<SeniorSolution | null> {
  const { data, error } = await supabase
    .from('senior_solutions')
    .select('id, question_id, content, created_at, updated_at')
    .eq('question_id', questionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as SeniorSolutionRow
  return {
    id: row.id,
    questionId: row.question_id,
    content: parseRichDoc(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
