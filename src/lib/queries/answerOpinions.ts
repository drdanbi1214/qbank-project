import { supabase } from '@/lib/supabase'

export type AnswerOpinion = {
  id: string
  questionId: string
  authorId: string
  authorName: string
  answer: number[]
  permissionKeys: string[]
  updatedAt: string
}

type OpinionRow = {
  id: string
  question_id: string
  author_id: string
  answer: number[]
  permission_keys: string[]
  updated_at: string
  profiles: { display_name: string | null } | null
}

export async function fetchAnswerOpinions(questionId: string): Promise<AnswerOpinion[]> {
  const { data, error } = await supabase
    .from('question_answer_opinions')
    .select(
      'id, question_id, author_id, answer, permission_keys, updated_at, profiles!question_answer_opinions_author_id_fkey(display_name)',
    )
    .eq('question_id', questionId)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return ((data ?? []) as unknown as OpinionRow[]).map((row) => ({
    id: row.id,
    questionId: row.question_id,
    authorId: row.author_id,
    authorName: row.profiles?.display_name?.trim() || '알 수 없음',
    answer: [...new Set(row.answer)].sort((a, b) => a - b),
    permissionKeys: row.permission_keys,
    updatedAt: row.updated_at,
  }))
}

/** 공개 범위는 인자로 받지 않고 서버가 등록자의 스터디 권한을 직접 저장한다. */
export async function saveMyAnswerOpinion(questionId: string, answer: number[]): Promise<void> {
  const { error } = await supabase.rpc('save_my_answer_opinion', {
    p_question_id: questionId,
    p_answer: [...new Set(answer)].sort((a, b) => a - b),
  })
  if (error) throw error
}
