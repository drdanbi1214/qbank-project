import { Link } from 'react-router-dom'
import { useSignedUrl } from '@/lib/storage'
import { cn } from '@/utils/cn'

export type LecturePageAttrs = {
  src: string
  lectureId: string
  page: number
  title: string
  professor: string | null
}

type Props = {
  src: string | null
  lectureId: string | null
  page: number | null
  title: string | null
  professor: string | null
  selected?: boolean
  onRemove?: () => void
}

/**
 * 글에 박힌 강의록 한 쪽.
 *
 * 이미지가 본문이고, 그 아래 줄이 어디서 온 것인지 밝힌다. "강의록" 을 누르면
 * 원본의 그 쪽으로 간다 — 앞뒤 맥락이 필요할 때 PDF 를 다시 찾지 않아도 된다.
 */
export function LecturePageCard({
  src,
  lectureId,
  page,
  title,
  professor,
  selected = false,
  onRemove,
}: Props) {
  const imageUrl = useSignedUrl(src)

  const caption = [title ?? '강의록', professor, page ? `${page}쪽` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <figure
      className={cn(
        'overflow-hidden rounded-xl border bg-white dark:bg-slate-900',
        selected ? 'border-brand-500 ring-2 ring-brand-400/60' : 'border-slate-200 dark:border-slate-700',
      )}
    >
      <div className="relative">
        {imageUrl ? (
          <img src={imageUrl} alt={caption} className="block w-full" />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            강의록 쪽을 불러오는 중…
          </div>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="이 쪽 지우기"
            className="absolute right-2 top-2 rounded-md bg-slate-900/70 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900"
          >
            삭제
          </button>
        )}
      </div>

      <figcaption className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
        <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
          📄 {caption}
        </span>
        {lectureId && (
          <Link
            to={`/lectures/${lectureId}${page ? `?page=${page}` : ''}`}
            className="shrink-0 rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700 hover:underline dark:bg-brand-900/40 dark:text-brand-200"
          >
            강의록 보기 →
          </Link>
        )}
      </figcaption>
    </figure>
  )
}
