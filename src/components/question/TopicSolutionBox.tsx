import { useCallback, useEffect, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useTopicScope } from '@/components/question/TopicContext'
import {
  createSolution,
  fetchSolutions,
  updateSolution,
  type Solution,
} from '@/lib/queries/solutions'
import { uploadTopicImage } from '@/lib/uploads'
import { solutionTemplateDoc, type RichDoc } from '@/types/richtext'

type Props = {
  questionId: string
  /** 있으면 해설이 그룹에 붙어 묶인 판본 전체에서 보인다. */
  groupId: string | null
  /** 새 해설을 열 때 배정 풀이와 같은 선지별 기본 서식을 만든다. */
  choiceCount: number
}

/**
 * 테마 본문의 야마 카드에 붙는 해설.
 *
 * 문제 풀이 화면의 풀이 목록과 달리 껍데기가 없다 — 정렬, 작성자, 스터디 배지,
 * 추천, 수정·삭제 버튼이 모두 빠지고 본문만 남는다. 이 자리의 해설은 게시물을
 * 쓴 사람이 글을 쓰면서 붙이는 것이라, 여러 사람의 풀이를 견주어 보는 화면과는
 * 성격이 다르다.
 *
 * 그래서 테마 작성자가 쓴 것 하나만 고른다. 고칠 수 있는 사람도 그 사람뿐이다
 * (solutions_update 정책이 author_id = auth.uid() 를 요구한다).
 */
export function TopicSolutionBox({ questionId, groupId, choiceCount }: Props) {
  const scope = useTopicScope()
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''

  const embed = useEmbedPickers({ subjectId: null, theory: true, lectureUserId: userId })
  const [solution, setSolution] = useState<Solution | null | 'loading'>('loading')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const draftRef = useRef<RichDoc>(solutionTemplateDoc(choiceCount))

  // 테마가 편집 중일 때만, 그리고 작성자 본인만 고칠 수 있다. 저장된 글을 읽는
  // 중에 해설 입력칸이 보이면 게시물이 아직 작성 중인 것처럼 보인다.
  // 남의 풀이는 정책이 막는다 (solutions_update 가 author_id = auth.uid()).
  const canEdit =
    Boolean(scope?.editing) && Boolean(scope?.authorId) && (scope?.authorId === userId || isAdmin)

  const load = useCallback(() => {
    void fetchSolutions({ questionId, groupId })
      .then((rows) => {
        const mine = rows.find((row) => row.author.id === scope?.authorId) ?? null
        setSolution(mine)
        draftRef.current = mine?.content ?? solutionTemplateDoc(choiceCount)
      })
      .catch(() => setSolution(null))
  }, [questionId, groupId, scope?.authorId, choiceCount])

  useEffect(load, [load])

  const save = useCallback(() => {
    setBusy(true)
    const done = () => {
      setEditing(false)
      load()
    }
    const failed = (caught: unknown) => {
      window.alert(caught instanceof Error ? caught.message : '해설을 저장하지 못했습니다.')
    }

    if (solution && solution !== 'loading') {
      void updateSolution({
        id: solution.id,
        content: draftRef.current,
        references: solution.references,
        requiredPermission: solution.requiredPermission,
      })
        .then(done)
        .catch(failed)
        .finally(() => setBusy(false))
      return
    }

    void createSolution({
      target: { questionId, groupId },
      authorId: userId,
      content: draftRef.current,
      references: [],
      requiredPermission: scope?.requiredPermission ?? null,
    })
      .then(done)
      .catch(failed)
      .finally(() => setBusy(false))
  }, [solution, questionId, groupId, userId, scope?.requiredPermission, load])

  if (solution === 'loading') {
    return (
      <div className="mt-2.5 flex justify-center py-3">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }

  if (editing && session) {
    return (
      <div className="mt-2.5">
        <LazyRichTextEditor
          initialValue={solution?.content ?? solutionTemplateDoc(choiceCount)}
          onChange={(doc) => {
            draftRef.current = doc
          }}
          userId={userId}
          uploadImageFile={uploadTopicImage}
          placeholder="이 문제의 해설을 적어보세요."
          minHeight="7rem"
          compact
          contentClassName="topic-solution-rich-text"
          onRequestTheory={embed.onRequestTheory}
          onRequestLecture={embed.onRequestLecture}
        />
        {embed.pickers}
        <div className="mt-1.5 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            취소
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            저장
          </Button>
        </div>
      </div>
    )
  }

  if (!solution) {
    if (!canEdit) return null
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2.5 w-full rounded-r-md border-l-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs text-slate-400 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-800/50"
      >
        해설을 적어보세요
      </button>
    )
  }

  return (
    <div className="group relative mt-2.5 rounded-r-md border-l-2 border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/50">
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute right-2 top-1.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-400 opacity-0 transition-opacity hover:text-slate-700 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900"
        >
          ✎ 고치기
        </button>
      )}
      <RichTextViewer doc={solution.content} className="topic-solution-rich-text" />
    </div>
  )
}
