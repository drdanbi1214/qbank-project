import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { fetchAllNotes, type AllUsersNote } from '@/lib/queries/notes'
import { richTextToPlain } from '@/types/richtext'

/**
 * 관리자 전용. 이 문항(또는 그룹)에 대해 사람들이 적어둔 개인 메모를 전부 본다.
 * 내 노트 탭은 본인 것만 보여주는 게 원칙이라, 이건 별도 영역으로 커뮤니티
 * Q&A 아래에 둔다.
 */
export function AllNotesPanel({
  questionId,
  groupId,
}: {
  questionId: string
  groupId: string | null
}) {
  const [loaded, setLoaded] = useState<{ key: string; notes: AllUsersNote[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = groupId ?? questionId

  useEffect(() => {
    let active = true
    void fetchAllNotes({ questionId, groupId })
      .then((notes) => {
        if (active) setLoaded({ key, notes })
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '메모를 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [questionId, groupId, key])

  if (error) {
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        {error}
      </p>
    )
  }

  if (loaded?.key !== key) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
      <h3 className="mb-2 text-sm font-bold text-amber-900 dark:text-amber-200">
        모두의 개인 메모 ({loaded.notes.length}) — 관리자만 보입니다
      </h3>

      {loaded.notes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">아직 메모가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {loaded.notes.map((note) => (
            <li key={note.userId} className="text-sm leading-6">
              <span className="font-semibold">({note.displayName})</span>{' '}
              <span className="whitespace-pre-wrap">{richTextToPlain(note.content)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
