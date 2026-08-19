import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Spinner } from '@/components/ui/Spinner'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import { richTextToPlain } from '@/types/richtext'
import { cn } from '@/utils/cn'

type Props = {
  documentId: string | null
  /** 편집기에서 노드가 선택된 상태 */
  selected?: boolean
  /** 편집기에서만 넘어온다. 있으면 빼기 버튼을 보여준다. */
  onRemove?: () => void
}

/**
 * 테마 본문 안에 끼워 넣은 이론 문서.
 *
 * 접힌 채로 시작해 제목과 앞 몇 줄만 보여준다. 이론 본문은 캡처를 포함해 길어서
 * 그대로 펼쳐 두면 테마 글의 흐름이 끊긴다.
 *
 * 내용을 복사해 오지 않고 원본을 그때그때 읽는다. 이론이 고쳐지면 테마에서도
 * 고쳐진 내용이 보인다.
 */
export function TheoryCard({ documentId, selected = false, onRemove }: Props) {
  const [document, setDocument] = useState<TheoryDocument | null | 'missing'>(
    documentId ? null : 'missing',
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!documentId) return
    let active = true
    // 이론은 과목 단위로 받아 오는 API 뿐이라 전체에서 골라낸다. 495건 수준이라
    // 감당할 만하고, 결과는 브라우저 캐시를 탄다.
    void fetchTheoryDocuments()
      .then((rows) => {
        if (!active) return
        setDocument(rows.find((row) => row.id === documentId) ?? 'missing')
      })
      .catch(() => {
        if (active) setDocument('missing')
      })
    return () => {
      active = false
    }
  }, [documentId])

  if (document === null) {
    return (
      <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }

  if (document === 'missing') {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
          selected && 'ring-2 ring-brand-500',
        )}
      >
        이 이론은 지금 볼 수 없습니다. 문서가 지워졌거나 열람 권한이 없습니다.
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 text-xs underline hover:text-rose-600 dark:hover:text-rose-400"
          >
            본문에서 빼기
          </button>
        )}
      </div>
    )
  }

  const preview = richTextToPlain(document.content).slice(0, 160)

  return (
    <div
      className={cn(
        'rounded-lg border border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span
          data-drag-handle={onRemove ? '' : undefined}
          className={cn(
            'rounded bg-sky-600 px-1.5 py-0.5 font-semibold text-white',
            onRemove && 'cursor-grab active:cursor-grabbing',
          )}
        >
          이론
        </span>
        <span className="font-medium text-slate-800 dark:text-slate-100">{document.title}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-sky-700 hover:underline dark:text-sky-300"
          >
            {open ? '접기' : '펼치기'}
          </button>
          <Link
            to={`/theory/${document.subjectId}/${document.id}`}
            className="text-slate-500 hover:underline dark:text-slate-400"
          >
            전체 보기
          </Link>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
            >
              빼기
            </button>
          )}
        </span>
      </div>

      {!open && preview !== '' && (
        <p className="line-clamp-2 px-3 pb-2 text-sm text-slate-600 dark:text-slate-300">
          {preview}
        </p>
      )}

      {open && (
        <div className="border-t border-sky-300 px-3 py-3 dark:border-sky-800">
          <RichTextViewer doc={document.content} hierarchicalIndent />
        </div>
      )}
    </div>
  )
}
