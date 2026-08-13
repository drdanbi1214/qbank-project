import { useEffect, useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { fetchSolutionRevisions, type SolutionRevision } from '@/lib/queries/solutions'
import { formatDateTime } from '@/utils/date'
import { cn } from '@/utils/cn'

/**
 * 풀이 버전 히스토리.
 * 트리거가 남긴 revisions.diff 의 before 본문을 그대로 보여준다.
 */
export function SolutionHistoryModal({
  solutionId,
  onClose,
}: {
  solutionId: string
  onClose: () => void
}) {
  const [revisions, setRevisions] = useState<SolutionRevision[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchSolutionRevisions(solutionId)
      .then((rows) => {
        if (active) setRevisions(rows)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '이력을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [solutionId])

  const selected = revisions?.find((item) => item.id === selectedId) ?? null

  return (
    <Modal title="풀이 수정 이력" onClose={onClose} wide>
      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !revisions ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : revisions.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          아직 수정된 적이 없습니다.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <ul className="space-y-1">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(revision.id)}
                  className={cn(
                    'w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    selectedId === revision.id
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="block font-medium">
                    {formatDateTime(revision.createdAt)}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {revision.editor.displayName}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0">
            {selected ? (
              selected.before ? (
                <>
                  <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                    이 시점 직전의 본문입니다.
                  </p>
                  <RichTextViewer doc={selected.before} className="solution-rich-text" />
                </>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  본문 변경이 아닌 수정입니다. {selected.summary}
                </p>
              )
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                왼쪽에서 시점을 선택해주세요.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
