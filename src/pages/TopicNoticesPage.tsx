import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
  type Announcement,
} from '@/lib/queries/notifications'
import { uploadTopicImage, uploadTopicVideo } from '@/lib/uploads'
import { formatShortDate } from '@/utils/date'
import { emptyDoc, type RichDoc } from '@/types/richtext'

/** 레옵스 공지는 이 권한을 가진 사람만 읽고 쓴다. DB 정책도 같은 조건이다. */
const SCOPE = 'study_legendob'

/**
 * 레옵스 공지사항.
 *
 * 전체 공지(/announcements)와 같은 표를 쓰되 required_permission 으로 갈라
 * 놓는다. 스터디원끼리만 보이고, 스터디원이면 누구나 올릴 수 있다 — 자기
 * 스터디 공지를 쓰려고 관리자를 부를 일은 없어야 한다.
 */
export function TopicNoticesPage() {
  const { session, isAdmin, hasPermission } = useAuth()
  const userId = session?.user.id ?? ''
  // 글 쓰는 곳이면 알렌·강의록을 똑같이 넣을 수 있어야 한다.
  const embed = useEmbedPickers({ subjectId: null, theory: true, lectureUserId: userId || null })
  const canUse = isAdmin || hasPermission(SCOPE)
  const canWrite = hasPermission(SCOPE) || isAdmin

  const [rows, setRows] = useState<Announcement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [title, setTitle] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const draft = useRef<RichDoc>(emptyDoc())
  const activeUploads = useRef(0)

  /** 큰 영상을 올리는 도중 공지를 먼저 저장해 빈 영상 노드가 남지 않게 한다. */
  const trackUpload = useCallback(async <T,>(task: () => Promise<T>): Promise<T> => {
    activeUploads.current += 1
    setUploading(true)
    try {
      return await task()
    } finally {
      activeUploads.current -= 1
      setUploading(activeUploads.current > 0)
    }
  }, [])

  const uploadNoticeImage = useCallback(
    (file: File, ownerId: string) => trackUpload(() => uploadTopicImage(file, ownerId)),
    [trackUpload],
  )
  const uploadNoticeVideo = useCallback(
    (file: File, ownerId: string) => trackUpload(() => uploadTopicVideo(file, ownerId)),
    [trackUpload],
  )

  const load = useCallback(() => {
    if (!canUse) return
    void fetchAnnouncements(SCOPE)
      .then(setRows)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '공지를 불러오지 못했습니다.')
        setRows([])
      })
  }, [canUse])

  useEffect(load, [load])

  const closeEditor = useCallback(() => {
    setWriting(false)
    setEditing(null)
    setTitle('')
    setPinned(false)
    draft.current = emptyDoc()
  }, [])

  const startWriting = useCallback(() => {
    setEditing(null)
    setTitle('')
    setPinned(false)
    draft.current = emptyDoc()
    setError(null)
    setWriting(true)
  }, [])

  const startEditing = useCallback((row: Announcement) => {
    setWriting(false)
    setEditing(row)
    setTitle(row.title)
    setPinned(row.isPinned)
    draft.current = row.content
    setError(null)
  }, [])

  const submit = useCallback(() => {
    if (uploading) {
      setError('첨부 파일이 모두 올라갈 때까지 잠시 기다려 주세요.')
      return
    }
    const trimmed = title.trim()
    if (trimmed === '') {
      setError('제목을 입력해 주세요.')
      return
    }
    setBusy(true)
    const request = editing
      ? updateAnnouncement({
          id: editing.id,
          title: trimmed,
          content: draft.current,
          isPinned: pinned,
        })
      : createAnnouncement({
          authorId: userId,
          title: trimmed,
          content: draft.current,
          isPinned: pinned,
          requiredPermission: SCOPE,
        })

    void request
      .then(() => {
        closeEditor()
        setError(null)
        load()
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : editing
              ? '수정하지 못했습니다.'
              : '올리지 못했습니다.',
        )
      })
      .finally(() => setBusy(false))
  }, [title, editing, pinned, userId, closeEditor, load, uploading])

  const remove = useCallback(
    (id: string, subject: string) => {
      if (!window.confirm(`"${subject}" 공지를 지웁니다.`)) return
      void deleteAnnouncement(id)
        .then(load)
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : '지우지 못했습니다.')
        })
    },
    [load],
  )

  if (!canUse) return <Navigate to="/study" replace />

  const renderEditor = (className = '') => (
    <div className={`rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900 ${className}`}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="공지 제목"
        className="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
      />
      <LazyRichTextEditor
        key={editing?.id ?? 'new-announcement'}
        initialValue={editing?.content ?? emptyDoc()}
        onChange={(doc) => {
          draft.current = doc
        }}
        userId={userId}
        uploadImageFile={uploadNoticeImage}
        uploadVideoFile={uploadNoticeVideo}
        onRequestTheory={embed.onRequestTheory}
        onRequestLecture={embed.onRequestLecture}
        placeholder="공지 내용을 입력하세요."
        minHeight="12rem"
        onUploadError={setError}
      />
      {embed.pickers}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          위에 고정
        </label>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={closeEditor} disabled={busy}>
            취소
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || uploading}>
            {uploading ? '첨부 파일 업로드 중' : editing ? '수정 완료' : '올리기'}
          </Button>
        </span>
      </div>
    </div>
  )

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
        <h1 className="text-xl font-bold">공지사항</h1>
        {canWrite && !writing && !editing && (
          <Button size="sm" className="ml-auto" onClick={startWriting}>
            공지 올리기
          </Button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {writing && session && renderEditor('mb-4')}

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          아직 공지가 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            if (editing?.id === row.id) return <li key={row.id}>{renderEditor()}</li>
            const canManage = isAdmin || row.author?.id === userId
            return (
              <li
                key={row.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {row.isPinned && (
                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    고정
                  </span>
                )}
                <h2 className="font-semibold">{row.title}</h2>
                <span className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                  {row.author && (
                    <>
                      <Avatar
                        path={row.author.avatarUrl}
                        name={row.author.displayName}
                        size={20}
                      />
                      {row.author.displayName}
                    </>
                  )}
                  {formatShortDate(row.createdAt)}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEditing(row)}
                        className="underline hover:text-brand-600 dark:hover:text-brand-300"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row.id, row.title)}
                        className="underline hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </span>
              </div>
              <RichTextViewer doc={row.content} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
