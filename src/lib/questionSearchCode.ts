/** 과목 코드가 없는 `22Y10` 형식은 해당 학번의 모든 과목에서 같은 번호를 찾는다. */
export function parseCohortQuestionQuery(query: string): { cohort: string; questionNumber: number } | null {
  const match = query.trim().match(/^(\d{2})\s*y\s*0*(\d{1,3})$/i)
  if (!match) return null
  const questionNumber = Number(match[2])
  if (questionNumber < 1 || questionNumber > 999) return null
  return { cohort: `${match[1]}학번`, questionNumber }
}
