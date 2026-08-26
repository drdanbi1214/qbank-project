import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { useDraft } from '@/components/editor/useDraft'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
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
import { LecturePicker } from '@/components/lecture/LecturePicker'
import { TheoryPicker } from '@/components/question/TheoryPicker'
import type { LecturePageAttrs } from '@/components/lecture/LecturePageCard'
import { TopicSidebar } from '@/components/question/TopicSidebar'
import { uploadTopicImage } from '@/lib/uploads'
import { formatDateTime, formatShortDate } from '@/utils/date'
import { emptyDoc, type RichDoc } from '@/types/richtext'
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
  // 새 글은 오른쪽 편집창에서 제목까지 함께 쓴다. 값이 있으면 초안을 쓰는 중이고,
  // unitId 는 목차에서 ＋ 를 누른 줄이다.
  // 글을 쓰는 동안에는 목차를 접어 본문을 넓게 쓰고 싶어 한다. 접은 채로
  // 새로고침해도 그대로이도록 브라우저에 남긴다.
  const [outlineOpen, setOutlineOpen] = useState(() => {
    try {
      return window.localStorage.getItem('topics.outline') !== 'closed'
    } catch {
      return true
    }
  })

  const toggleOutline = useCallback((open: boolean) => {
    setOutlineOpen(open)
    try {
      window.localStorage.setItem('topics.outline', open ? 'open' : 'closed')
    } catch {
      // 사생활 보호 모드처럼 저장이 막힌 곳에서도 접고 펴는 것 자체는 되어야 한다.
    }
  }, [])

  const [draft, setDraft] = useState<{ unitId: string | null } | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [editorSeed, setEditorSeed] = useState(() => ({ doc: emptyDoc(), version: 0 }))
  const [draftDismissed, setDraftDismissed] = useState(false)
  const [similar, setSimilar] = useState<{ id: string; title: string }[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const editedContent = useRef<RichDoc | null>(null)
  // 목록이 대표 단원으로 묶이므로 나중에 옮길 길이 있어야 한다.
  const [editedUnitId, setEditedUnitId] = useState<string | null>(null)

  const subject = subjectId ? taxonomy?.subjectById.get(subjectId) : undefined

  const load = useCallback(() => {
    if (!subjectId) return
    void fetchTopics(subjectId)
      .then(setTopics)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '주제를 불러오지 못했습니다.')
        setTopics([])
      })
  }, [subjectId])

  useEffect(load, [load])

  const selected = useMemo(
    () => (topics ?? []).find((row) => row.id === topicId) ?? null,
    [topics, topicId],
  )

  const topicDraftKey = draft
    ? `new:${subjectId ?? ''}`
    : editing && selected
      ? `edit:${selected.id}`
      : null
  const {
    savedDraft: savedTopicDraft,
    status: topicDraftStatus,
    schedule: scheduleTopicDraft,
    flush: flushTopicDraft,
    discard: discardTopicDraft,
  } = useDraft({
    userId,
    targetType: 'topic',
    targetKey: topicDraftKey,
    enabled: userId !== '' && topicDraftKey !== null,
  })

  // 레옵스는 게시판이라 목차 줄이 곧 글을 걸어 두는 제목이다. 문제의 단원
  // 목록과는 쓰임이 달라, 목차에 내기로 표시한 줄만 가져온다.
  const subjectUnits = useMemo(
    () =>
      (taxonomy?.units ?? []).filter(
        (unit) => unit.subjectId === subjectId && unit.topicOutline,
      ),
    [taxonomy, subjectId],
  )

  // 두 사람이 같은 주제를 각각 만들면 정리가 갈라진다. 비슷한 제목이 있으면
  // 알려 주되 막지는 않는다 — 정말 다른 주제인데 제목만 닮은 경우가 있다.
  const draftKeyword = draftTitle.trim()
  useEffect(() => {
    if (!draft || draftKeyword.length < 2 || !subjectId) return
    const timer = window.setTimeout(() => {
      void findSimilarTopics(subjectId, draftKeyword)
        .then(setSimilar)
        .catch(() => setSimilar([]))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [draft, draftKeyword, subjectId])
  // 두 글자가 안 되면 이전 결과를 내보내지 않는다. 지우는 동안 옛 경고가 남는다.
  const shownSimilar = draftKeyword.length >= 2 ? similar : []

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

  // 강의록 쪽 넣기도 같은 배선이다.
  const [pickingLecture, setPickingLecture] = useState(false)
  const resolveLecture = useRef<((picks: LecturePageAttrs[] | null) => void) | null>(null)

  const requestLecture = useCallback(() => {
    setPickingLecture(true)
    return new Promise<LecturePageAttrs[] | null>((resolve) => {
      resolveLecture.current = resolve
    })
  }, [])

  const finishLecture = useCallback((picks: LecturePageAttrs[] | null) => {
    setPickingLecture(false)
    resolveLecture.current?.(picks)
    resolveLecture.current = null
  }, [])

  const save = useCallback(() => {
    if (!selected || !editedContent.current) {
      setEditing(false)
      return
    }
    const content = editedContent.current
    setBusy(true)
    void updateTopic({ id: selected.id, userId, content, unitId: editedUnitId })
      // 본문이 정본이고 topic_questions 는 거기서 뽑아낸 역인덱스다.
      // 본문 저장이 끝난 뒤에 맞춘다.
      .then(() => syncTopicQuestions(selected.id, content))
      .then(() => discardTopicDraft())
      .then(() => {
        setEditing(false)
        editedContent.current = null
        load()
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [selected, userId, editedUnitId, discardTopicDraft, load])

  const saveDraft = useCallback(() => {
    if (!draft || !subjectId) return
    const title = draftTitle.trim()
    if (title === '') {
      setError('제목을 입력해 주세요.')
      return
    }
    const content = editedContent.current
    setBusy(true)
    setError(null)
    void createTopic({ subjectId, unitId: draft.unitId, title, userId })
      .then(async (id) => {
        // 본문을 쓴 채로 저장했으면 만들자마자 이어서 넣는다. 빈 채로 만들었다가
        // 다시 저장하게 하면 목록에 빈 글이 잠깐 남는다.
        if (content) {
          await updateTopic({ id, userId, content })
          await syncTopicQuestions(id, content)
        }
        await discardTopicDraft()
        setDraft(null)
        setDraftTitle('')
        editedContent.current = null
        load()
        navigate(`/topics/${subjectId}/${id}`)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '만들지 못했습니다.')
      })
      .finally(() => setBusy(false))
  }, [draft, draftTitle, subjectId, userId, discardTopicDraft, load, navigate])

  const cancelDraft = useCallback(() => {
    void flushTopicDraft()
    setDraft(null)
    setDraftTitle('')
    setSimilar([])
    editedContent.current = null
  }, [flushTopicDraft])

  const startDraft = useCallback((unitId: string | null) => {
    setEditing(false)
    const doc = emptyDoc()
    editedContent.current = doc
    setEditorSeed((previous) => ({ doc, version: previous.version + 1 }))
    setDraftTitle('')
    setSimilar([])
    setDraftDismissed(false)
    setDraft({ unitId })
  }, [])

  const scheduleNewTopicDraft = useCallback(
    (content: RichDoc, title = draftTitle, unitId = draft?.unitId ?? null) => {
      editedContent.current = content
      scheduleTopicDraft(content, { title, unitId })
    },
    [draft, draftTitle, scheduleTopicDraft],
  )

  const scheduleEditedTopicDraft = useCallback(
    (content: RichDoc, unitId = editedUnitId) => {
      editedContent.current = content
      scheduleTopicDraft(content, { unitId })
    },
    [editedUnitId, scheduleTopicDraft],
  )

  const saveTemporary = useCallback(() => {
    const content = editedContent.current ?? editorSeed.doc
    if (draft) scheduleNewTopicDraft(content)
    else scheduleEditedTopicDraft(content)
    void flushTopicDraft()
  }, [draft, editorSeed.doc, scheduleNewTopicDraft, scheduleEditedTopicDraft, flushTopicDraft])

  const restoreTopicDraft = useCallback(() => {
    if (!savedTopicDraft) return
    const metadata = savedTopicDraft.metadata
    const storedUnitId = typeof metadata.unitId === 'string' ? metadata.unitId : null

    if (draft) {
      setDraftTitle(typeof metadata.title === 'string' ? metadata.title : '')
      setDraft({ unitId: storedUnitId })
    } else if (editing) {
      setEditedUnitId(storedUnitId)
    }

    editedContent.current = savedTopicDraft.content
    setEditorSeed((previous) => ({
      doc: savedTopicDraft.content,
      version: previous.version + 1,
    }))
    setDraftDismissed(true)
  }, [savedTopicDraft, draft, editing])

  const dismissTopicDraft = useCallback(() => {
    setDraftDismissed(true)
    void discardTopicDraft()
  }, [discardTopicDraft])

  const cancelEditing = useCallback(() => {
    void flushTopicDraft()
    setEditing(false)
    editedContent.current = null
  }, [flushTopicDraft])

  const remove = useCallback(() => {
    if (!selected) return
    if (!window.confirm(`"${selected.title}" 주제를 지웁니다. 되돌릴 수 없습니다.`)) return
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
        <Button size="sm" className="ml-auto" onClick={() => startDraft(null)}>
          새 주제
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      <div
        className={cn(
          'grid gap-4',
          outlineOpen ? 'md:grid-cols-[16rem_1fr]' : 'md:grid-cols-[2rem_1fr]',
        )}
      >
        {outlineOpen ? (
          <TopicSidebar
            topics={topics}
            subjectId={subjectId}
            topicId={topicId}
            units={subjectUnits}
            onNewTopic={startDraft}
            onCollapse={() => toggleOutline(false)}
          />
        ) : (
          // 접은 자리에는 책갈피만 남긴다. 목차가 사라진 게 아니라 접혀 있다는
          // 것이 보여야 다시 펼 생각을 한다.
          <button
            type="button"
            onClick={() => toggleOutline(true)}
            aria-label="목차 펴기"
            title="목차 펴기"
            className="h-fit w-fit rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-500 shadow-sm hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 md:sticky md:top-20 md:px-1 md:py-3"
          >
            {/* 좁은 화면에서는 목차가 본문 위에 놓이므로 가로로, 넓은 화면에서는
                옆에 붙는 책갈피라 세로로 세운다. */}
            <span className="flex items-center gap-1.5 md:flex-col">
              <span aria-hidden>⟩</span>
              <span className="tracking-widest md:[writing-mode:vertical-rl]">목차</span>
            </span>
          </button>
        )}

        <article className="min-w-0">
          {draft ? (
            <div className="rounded-xl border border-brand-400 bg-white p-4 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => {
                    const title = event.target.value
                    setDraftTitle(title)
                    scheduleNewTopicDraft(editedContent.current ?? editorSeed.doc, title)
                  }}
                  placeholder="주제 제목 (예: 심부전의 약물치료)"
                  className="min-w-0 flex-1 border-0 border-b border-slate-200 bg-transparent px-0 py-1 text-2xl font-bold tracking-tight outline-none focus:border-brand-500 dark:border-slate-700"
                />
                <select
                  aria-label="목차 줄"
                  value={draft.unitId ?? ''}
                  onChange={(event) => {
                    const unitId = event.target.value || null
                    setDraft({ unitId })
                    scheduleNewTopicDraft(
                      editedContent.current ?? editorSeed.doc,
                      draftTitle,
                      unitId,
                    )
                  }}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                >
                  <option value="">목차 줄 없음</option>
                  {subjectUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
                <div className="ml-auto flex gap-2">
                  <DraftStatus status={topicDraftStatus} />
                  <Button size="sm" variant="secondary" onClick={saveTemporary} disabled={busy}>
                    임시저장
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelDraft}>
                    취소
                  </Button>
                  <Button size="sm" onClick={saveDraft} disabled={busy}>
                    저장
                  </Button>
                </div>
              </div>

              {savedTopicDraft && !draftDismissed && (
                <DraftRestoreNotice
                  updatedAt={savedTopicDraft.updatedAt}
                  onRestore={restoreTopicDraft}
                  onDiscard={dismissTopicDraft}
                />
              )}

              {shownSimilar.length > 0 && (
                <p className="mb-3 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  비슷한 주제가 이미 있습니다 — {shownSimilar.map((row) => row.title).join(', ')}. 같은
                  주제라면 기존 것에 이어서 쓰는 편이 낫습니다.
                </p>
              )}

              <TopicScopeProvider authorId={userId} requiredPermission="study_legendob" editing>
                <LazyRichTextEditor
                  key={`new-${editorSeed.version}`}
                  initialValue={editorSeed.doc}
                  onChange={scheduleNewTopicDraft}
                  userId={userId}
                  uploadImageFile={uploadTopicImage}
                  placeholder="내용을 적어보세요. 캡처는 붙여넣으면 바로 들어갑니다."
                  minHeight="30rem"
                  onUploadError={setError}
                  onRequestYama={requestYama}
                  onRequestTheory={requestTheory}
                  onRequestLecture={userId ? requestLecture : undefined}
                />
              </TopicScopeProvider>
            </div>
          ) : !selected ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              왼쪽에서 주제를 고르거나 새로 만드세요.
            </p>
          ) : (
            <div className="rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight">{selected.title}</h2>
                {editing ? (
                  <select
                    aria-label="대표 단원"
                    value={editedUnitId ?? ''}
                    onChange={(event) => {
                      const unitId = event.target.value || null
                      setEditedUnitId(unitId)
                      scheduleEditedTopicDraft(
                        editedContent.current ?? editorSeed.doc,
                        unitId,
                      )
                    }}
                    className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">단원 없음</option>
                    {subjectUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {unitNameOf(selected.unitId)}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  {editing ? (
                    <>
                      <DraftStatus status={topicDraftStatus} />
                      <Button size="sm" variant="secondary" onClick={saveTemporary} disabled={busy}>
                        임시저장
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEditing}>
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
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditedUnitId(selected.unitId)
                          editedContent.current = selected.content
                          setEditorSeed((previous) => ({
                            doc: selected.content,
                            version: previous.version + 1,
                          }))
                          setDraftDismissed(false)
                          setEditing(true)
                        }}
                      >
                        편집
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {editing && savedTopicDraft && !draftDismissed && (
                <DraftRestoreNotice
                  updatedAt={savedTopicDraft.updatedAt}
                  onRestore={restoreTopicDraft}
                  onDiscard={dismissTopicDraft}
                />
              )}

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
                  key={`${selected.id}-${editorSeed.version}`}
                  initialValue={editorSeed.doc}
                  onChange={scheduleEditedTopicDraft}
                  userId={userId}
                  uploadImageFile={uploadTopicImage}
                  placeholder="이 주제의 이론을 정리하세요. 캡처는 붙여넣으면 바로 들어갑니다."
                  minHeight="30rem"
                  onUploadError={setError}
                  onRequestYama={requestYama}
                  onRequestTheory={requestTheory}
                  onRequestLecture={userId ? requestLecture : undefined}
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

      {pickingLecture && userId && (
        <LecturePicker userId={userId} onPick={finishLecture} onCancel={() => finishLecture(null)} />
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

function DraftStatus({ status }: { status: 'idle' | 'saving' | 'saved' | 'failed' }) {
  return (
    <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">
      {status === 'saving'
        ? '임시저장 중'
        : status === 'saved'
          ? '임시저장됨'
          : status === 'failed'
            ? '임시저장 실패'
            : '5초마다 자동저장'}
    </span>
  )
}

function DraftRestoreNotice({
  updatedAt,
  onRestore,
  onDiscard,
}: {
  updatedAt: string
  onRestore: () => void
  onDiscard: () => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      <span>{formatDateTime(updatedAt)}에 임시저장한 글이 있습니다.</span>
      <div className="ml-auto flex gap-1">
        <Button size="sm" variant="secondary" onClick={onRestore}>
          불러오기
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          버리기
        </Button>
      </div>
    </div>
  )
}
