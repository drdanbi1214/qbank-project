import type { QuestionDraft } from '@/lib/queries/admin'

/**
 * 새 문항의 기본값.
 *
 * 보기 5개로 시작하지만 개수는 고정이 아니다. 복기 자료에 4개짜리와 6개짜리가
 * 섞여 있어 폼에서 늘리고 줄일 수 있고, 화면은 항상 배열 길이를 따라간다.
 */
export function emptyDraft(examId: string): QuestionDraft {
  return {
    examId,
    unitId: null,
    questionNumber: 1,
    questionType: 'A',
    setId: null,
    stemBlocks: [{ type: 'text', content: '' }],
    choices: [1, 2, 3, 4, 5].map((no) => ({ no, text: '', imageUrl: null })),
    answerCount: 1,
    editorAnswer: [],
    yamaAnswer: null,
    answerStatus: 'unconfirmed',
    answerNote: null,
    officialExplanation: null,
    modelAnswer: null,
    gradingPoints: null,
    professor: null,
    restorerNote: null,
    sourceTags: [],
    variantType: 'original',
    groupId: null,
    completeness: 'complete',
    status: 'published',
  }
}
