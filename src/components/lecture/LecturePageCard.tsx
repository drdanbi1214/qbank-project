import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSignedUrl } from '@/lib/storage'
import { imageWidthOf, MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH } from '@/types/richtext'
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
  /** 사람이 조절한 폭(px). 없으면 글 폭에 맞춘다. */
  width?: number | null
  /** 편집 중일 때만 온다. 있으면 크기 조절 도구를 낸다. */
  onResize?: (width: number | null) => void
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
  width = null,
  onResize,
}: Props) {
  const imageUrl = useSignedUrl(src)
  const frame = useRef<HTMLDivElement | null>(null)
  const [dragged, setDragged] = useState<number | null>(null)
  const shownWidth = dragged ?? imageWidthOf(width)

  function maxWidth() {
    const outer = frame.current?.getBoundingClientRect().width ?? MAX_IMAGE_WIDTH
    return Math.max(MIN_IMAGE_WIDTH, Math.min(Math.round(outer), MAX_IMAGE_WIDTH))
  }

  function startDrag(event: React.PointerEvent) {
    if (!onResize) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = frame.current?.querySelector('img')?.getBoundingClientRect().width ?? MIN_IMAGE_WIDTH
    const limit = maxWidth()
    let next = Math.round(startWidth)

    const move = (moved: PointerEvent) => {
      next = Math.min(
        Math.max(Math.round(startWidth + moved.clientX - startX), MIN_IMAGE_WIDTH),
        limit,
      )
      setDragged(next)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      onResize(next)
      setDragged(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const caption = [title ?? '강의록', professor, page ? `${page}쪽` : null]
    .filter(Boolean)
    .join(' · ')

  const showTools = Boolean(onResize) && (selected || dragged !== null)

  return (
    <figure
      ref={frame}
      className={cn(
        'overflow-hidden rounded-xl border bg-white dark:bg-slate-900',
        selected ? 'border-brand-500 ring-2 ring-brand-400/60' : 'border-slate-200 dark:border-slate-700',
      )}
      style={shownWidth ? { width: shownWidth, maxWidth: '100%' } : undefined}
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

        {showTools && (
          <>
            <div
              contentEditable={false}
              className="absolute left-1 top-1 flex items-center gap-1 rounded-md bg-slate-900/80 px-1 py-0.5 text-[11px] text-white"
            >
              <SizeButton onClick={() => onResize?.(Math.round(maxWidth() * 0.35))}>작게</SizeButton>
              <SizeButton onClick={() => onResize?.(Math.round(maxWidth() * 0.6))}>중간</SizeButton>
              {/* 폭을 지우면 글 폭에 맞춘다. 그게 기본 모습이다. */}
              <SizeButton onClick={() => onResize?.(null)}>꽉 차게</SizeButton>
              {shownWidth && <span className="pl-1 tabular-nums opacity-70">{shownWidth}px</span>}
            </div>

            <span
              role="presentation"
              onPointerDown={startDrag}
              className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-500 shadow dark:border-slate-900"
            />
          </>
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

function SizeButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      // 버튼을 누르는 순간 선택이 풀리면 도구가 사라져 버린다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="rounded px-1 py-0.5 hover:bg-white/20"
    >
      {children}
    </button>
  )
}
