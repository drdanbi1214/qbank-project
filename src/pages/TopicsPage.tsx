import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import {
  createTopic,
  deleteTopic,
  fetchTopics,
  findSimilarTopics,
  syncTopicQuestions,
  updateTopic,
  type Topic,
} from '@/lib/queries/topics'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { TopicScopeProvider } from '@/components/question/TopicContext'
import { TheoryPicker } from '@/components/question/TheoryPicker'
import { uploadTopicImage } from '@/lib/uploads'
import { formatShortDate } from '@/utils/date'
import type { RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

/**
 * 테마 — 주제별 이론 정리.
 *
 * 왼쪽에 과목의 테마 목록, 오른쪽에 본문을 둔다. 위키식이라 볼 수 있는 사람은
 * 바로 고칠 수 있고, 되돌리기는 편집 이력(revisions)으로 한다.
 */
export function TopicsPage() {
  const { subjectId, topicId } = useParams()
  const navigate = useNavigate()
  const { taxonomy } = useData()
  const { session, isAdmin, hasPermission } = useAuth()
  const userId = session?.user.id ?? ''
  const canUse = isAdmin || hasPermission('study_legendob')

  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const editedContent = useRef<RichDoc | null>(null)

  const subject = subjectId ? taxonomy?.subjectById.get(subjectId) : undefined

  const load = useCallback(() => {
    if (!subjectId) return
    void fetchTopics(subjectId)
      .then(setTopics)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '테마를 불러오지 못했습니다.')
        setTopics([])
      })
  }, [subjectId])

  useEffect(load, [load])

  const selected = useMemo(
    () => (topics ?? []).find((row) => row.id === topicId) ?? null,
    [topics, topicId],
  )

  const unitNameOf = useCallback(
    (id: string | null) => (id ? (taxonomy?.unitById.get(id)?.name ?? '미분류') : '미분류'),
    [taxonomy],
  )

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const name = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, name)
    },
    [taxonomy],
  )

  // 편집기 도구 모음의 "야마" 버튼이 이 함수를 부른다. 고르기 화면을 띄우고,
  // 사용자가 고르면 문제 id 로 약속을 갚는다. 편집기가 그 자리에 노드를 꽂는다.
  const [picking, setPicking] = useState(false)
  const resolvePick = useRef<((id: string | null) => void) | null>(null)

  const requestYama = useCallback(() => {
    setPicking(true)
    return new Promise<string | null>((resolve) => {
      resolvePick.current = resolve
    })
  }, [])

  const finishPick = useCallback((id: string | null) => {
    setPicking(false)
    resolvePick.current?.(id)
    resolvePick.current = null
  }, [])

  // 이론 넣기도 같은 방식이다. 이미 올라와 있는 이론 문서를 찾아 본문에 꽂는다.
  const [pickingTheory, setPickingTheory] = useState(false)
  const resolveTheory = useRef<((id: string | null) => void) | null>(null)

  const requestTheory = useCallback(() => {
    setPickingTheory(true)
    return new Promise<string | null>((resolve) => {
      resolveTheory.current = resolve
    })
  }, [])

  const finishTheory = useCallback((id: string | null) => {
    setPickingTheory(false)
    resolveTheory.current?.(id)
    resolveTheory.current = null
  }, [])

  const save = useCallback(() => {
    if (!selected || !editedContent.current) {
      setEditing(false)
      return
    }
    const content = editedContent.current
    setBusy(true)
    void updateTopic({ id: selected.id, userId, content })
      // 본문이 정본이고 topic_questions 는 거기서 뽑아낸 역인덱스다.
      // 본문 저장이 끝난 뒤에 맞춘다.
      .then(() => syncTopicQuestions(selected.id, content))
      .then(() => {
        setEditing(false)
        editedContent.current = null
        load()
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [selected, userId, load])

  const remove = useCallback(() => {
    if (!selected) return
    if (!window.confirm(`"${selected.title}" 테마를 지웁니다. 되돌릴 수 없습니다.`)) return
    setBusy(true)
    void deleteTopic(selected.id)
      .then(() => {
        // 목록을 다시 읽어야 왼쪽에서 사라진다. 주소만 바꾸면 subjectId 가 그대로라
        // 조회 이펙트가 다시 돌지 않아 지운 테마가 남아 있는다.
        load()
        navigate(`/topics/${subjectId}`, { replace: true })
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '지우지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [selected, subjectId, navigate, load])

  if (!canUse) return <Navigate to="/study" replace />
  if (!subjectId) return <Navigate to="/study" replace />
  if (taxonomy && !subject) return <Navigate to="/study" replace />

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          to="/topics"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
        >
          레옵스
        </Link>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <h1 className="text-xl font-bold">{subject?.name ?? ''}</h1>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          새 테마
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {creating && (
        <CreateForm
          subjectId={subjectId}
          userId={userId}
          units={(taxonomy?.units ?? []).filter((unit) => unit.subjectId === subjectId)}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            load()
            navigate(`/topics/${subjectId}/${id}`)
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <nav className="space-y-1">
          {topics === null ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : topics.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              아직 테마가 없습니다.
            </p>
          ) : (
            topics.map((row) => (
              <Link
                key={row.id}
                to={`/topics/${subjectId}/${row.id}`}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                  row.id === topicId
                    ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <span className="block truncate">{row.title}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {unitNameOf(row.unitId)} · {formatShortDate(row.updatedAt)}
                </span>
              </Link>
            ))
          )}
        </nav>

        <article className="min-w-0">
          {!selected ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              왼쪽에서 테마를 고르거나 새로 만드세요.
            </p>
          ) : (
            <div className="rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">{selected.title}</h2>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {unitNameOf(selected.unitId)}
                </span>
                <div className="ml-auto flex gap-2">
                  {editing ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        취소
                      </Button>
                      <Button size="sm" onClick={save} disabled={busy}>
                        저장
                      </Button>
                    </>
                  ) : (
                    <>
                      {(isAdmin || selected.createdBy === userId) && (
                        <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
                          삭제
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                        편집
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {selected.author && (
                  <>
                    <Avatar
                      path={selected.author.avatarUrl}
                      name={selected.author.displayName}
                      size={22}
                    />
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {selected.author.displayName}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                  </>
                )}
                <span>최종 수정 {formatShortDate(selected.updatedAt)}</span>
              </div>

              <TopicScopeProvider
                authorId={selected.createdBy}
                requiredPermission={selected.requiredPermission}
                editing={editing}
              >
              {editing && session ? (
                <LazyRichTextEditor
                  key={selected.id}
                  initialValue={selected.content}
                  onChange={(content) => {
                    editedContent.current = content
                  }}
                  userId={userId}
                  uploadImageFile={uploadTopicImage}
                  placeholder="이 주제의 이론을 정리하세요. 캡처는 붙여넣으면 바로 들어갑니다."
                  minHeight="30rem"
                  onUploadError={setError}
                  onRequestYama={requestYama}
                  onRequestTheory={requestTheory}
                />
              ) : (
                <RichTextViewer doc={selected.content} />
              )}
              </TopicScopeProvider>
            </div>
          )}
        </article>
      </div>

      {pickingTheory && (
        <TheoryPicker subjectId={subjectId} onPick={finishTheory} onCancel={() => finishTheory(null)} />
      )}

      {picking && taxonomy && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-3 text-sm font-semibold">본문에 넣을 야마 고르기</h3>
            <QuestionLookup
              exams={taxonomy.exams}
              subjectId={subjectId}
              examLabelOf={examLabelOf}
              confirmLabel="본문에 넣기"
              onCancel={() => finishPick(null)}
              onPick={(found) => finishPick(found.id)}
            />
          </div>
        </div>
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------

type Unit = { id: string; name: string; subjectId: string }

/**
 * 새 테마 만들기.
 *
 * 두 사람이 같은 주제를 각각 만들면 이론이 갈라진다. 비슷한 제목이 있으면
 * 경고하되 막지는 않는다 — 정말 다른 주제인데 제목만 닮은 경우가 있다.
 */
function CreateForm({
  subjectId,
  userId,
  units,
  onCancel,
  onCreated,
}: {
  subjectId: string
  userId: string
  units: Unit[]
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [unitId, setUnitId] = useState<string>('')
  const [similar, setSimilar] = useState<{ id: string; title: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 입력이 멎으면 비슷한 제목을 찾아본다. 두 글자가 안 되면 조회하지 않고,
  // 이전 결과는 아래 keyword 검사로 화면에서 걸러진다.
  const keyword = title.trim()
  useEffect(() => {
    if (keyword.length < 2) return
    const timer = window.setTimeout(() => {
      void findSimilarTopics(subjectId, keyword)
        .then(setSimilar)
        .catch(() => setSimilar([]))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [keyword, subjectId])

  const submit = useCallback(() => {
    const trimmed = title.trim()
    if (trimmed === '') {
      setError('제목을 입력해 주세요.')
      return
    }
    setBusy(true)
    void createTopic({ subjectId, unitId: unitId || null, title: trimmed, userId })
      .then(onCreated)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '만들지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [title, unitId, subjectId, userId, onCreated])

  return (
    <div className="mb-4 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={unitId}
          onChange={(event) => setUnitId(event.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">대표 단원 없음</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="테마 제목 (예: 심부전의 약물치료)"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <Button size="sm" onClick={submit} disabled={busy}>
          만들기
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {keyword.length >= 2 && similar.length > 0 && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          비슷한 테마가 이미 있습니다 — {similar.map((row) => row.title).join(', ')}. 같은 주제라면
          기존 것에 이어서 쓰는 편이 낫습니다.
        </p>
      )}
    </div>
  )
}
