import { useCallback, useEffect, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  type Announcement,
} from '@/lib/queries/notifications'
import { emptyDoc, isEmptyDoc, type RichDoc } from '@/types/richtext'
import { formatShortDate } from '@/utils/date'

export function AnnouncementsPage() {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; items: Announcement[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    let active = true
    void fetchAnnouncements()
      .then((items) => {
        if (active) {
          setLoaded({ key: reloadKey, items })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '공지를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  const ready = loaded?.key === reloadKey
  const items = ready ? loaded.items : []

  return (
    <section>
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">공지사항</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            운영 관련 안내입니다.
          </p>
        </div>
        {isAdmin && !writing && <Button onClick={() => setWriting(true)}>공지 작성</Button>}
      </header>

      {writing && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <AnnouncementComposer
            userId={userId}
            onSaved={() => {
              setWriting(false)
              reload()
            }}
            onCancel={() => setWriting(false)}
          />
        </div>
      )}

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : !ready ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 공지가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {item.isPinned && (
                  <span className="rounded bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    고정
                  </span>
                )}
                <h2 className="font-bold">{item.title}</h2>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {item.author?.displayName} {formatShortDate(item.createdAt)}
                </span>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      if (!window.confirm('공지를 삭제할까요?')) return
                      void deleteAnnouncement(item.id)
                        .then(reload)
                        .catch((caught: unknown) =>
                          console.error('공지를 삭제하지 못했습니다.', caught),
                        )
                    }}
                  >
                    삭제
                  </Button>
                )}
              </div>
              <RichTextViewer doc={item.content} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AnnouncementComposer({
  userId,
  onSaved,
  onCancel,
}: {
  userId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [isPinned, setIsPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = useRef<RichDoc>(emptyDoc())

  async function save() {
    if (title.trim() === '' || isEmptyDoc(doc.current)) {
      setError('제목과 내용을 모두 입력해주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // 등록하면 트리거가 전체 사용자에게 알림을 만든다.
      await createAnnouncement({
        authorId: userId,
        title: title.trim(),
        content: doc.current,
        isPinned,
      })
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="공지 제목"
        maxLength={120}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
      />

      <LazyRichTextEditor
        initialValue={emptyDoc()}
        onChange={(next) => {
          doc.current = next
        }}
        userId={userId}
        placeholder="공지 내용"
        minHeight="12rem"
        onUploadError={setError}
      />

      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={isPinned}
          onChange={(event) => setIsPinned(event.target.checked)}
        />
        상단 고정
      </label>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          등록
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>
      </div>
    </div>
  )
}
