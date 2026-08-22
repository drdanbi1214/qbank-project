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

export async function hasSeniorSolution(questionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('senior_solutions')
    .select('id')
    .eq('question_id', questionId)
    .limit(1)
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/**
 * 인쇄용. 여러 문제의 선배해설을 한 번에 받아 문제 id 별로 묶는다.
 * 권한이 없으면 RLS가 걸러 빈 Map 이 온다.
 */
export async function fetchSeniorSolutionsForQuestions(
  questionIds: string[],
): Promise<Map<string, SeniorSolution>> {
  if (questionIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('senior_solutions')
    .select('id, question_id, content, created_at, updated_at')
    .in('question_id', questionIds)
  if (error) throw error

  const result = new Map<string, SeniorSolution>()
  for (const row of (data ?? []) as SeniorSolutionRow[]) {
    result.set(row.question_id, {
      id: row.id,
      questionId: row.question_id,
      content: parseRichDoc(row.content),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  }
  return result
}
