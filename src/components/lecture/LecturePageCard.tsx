import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LecturePageCropDialog } from '@/components/lecture/LecturePageCropDialog'
import { PageMarkLayer } from '@/components/lecture/PageMarkLayer'
import { pageCropOf, type PageCrop } from '@/components/lecture/pageCrop'
import {
  DEFAULT_TEXT_SIZE,
  STROKE_COLORS,
  TEXT_SIZES,
  type MarkTool,
  type PageMark,
} from '@/components/lecture/pageMarks'
import { useSignedUrl } from '@/lib/storage'
import { imageWidthOf, MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH } from '@/types/richtext'
import { cn } from '@/utils/cn'

export type LecturePageAttrs = {
  src: string
  lectureId: string
  page: number
  title: string
  professor: string | null
  crop?: PageCrop | null
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
  /** 원본 페이지에서 보일 영역. 없으면 전체 페이지다. */
  crop?: PageCrop | null
  /** 편집 중일 때만 온다. null로 바꾸면 원본 전체로 복구한다. */
  onCropChange?: (crop: PageCrop | null) => void
  /** 쪽 위에 남긴 자국과 글자. 이미지에 굽지 않고 좌표로 담는다. */
  marks?: PageMark[]
  onMarksChange?: (marks: PageMark[]) => void
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
  crop = null,
  onCropChange,
  marks = [],
  onMarksChange,
}: Props) {
  const imageUrl = useSignedUrl(src)
  const frame = useRef<HTMLDivElement | null>(null)
  const [tool, setTool] = useState<MarkTool | 'erase' | null>(null)
  const [color, setColor] = useState<string>(STROKE_COLORS[0])
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE)
  // 자국이 늘어지지 않으려면 이미지 비율이 필요하다. 불러온 뒤에 알 수 있다.
  const [aspect, setAspect] = useState(1.414)
  const [dragged, setDragged] = useState<number | null>(null)
  const [cropping, setCropping] = useState(false)
  const shownWidth = dragged ?? imageWidthOf(width)
  const activeCrop = pageCropOf(crop)

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

  const showTools = Boolean(onResize || onCropChange) && (selected || dragged !== null)

  return (
    <>
      <figure
        ref={frame}
        className={cn(
          'overflow-hidden rounded-xl border bg-white dark:bg-slate-900',
          selected ? 'border-brand-500 ring-2 ring-brand-400/60' : 'border-slate-200 dark:border-slate-700',
        )}
        style={shownWidth ? { width: shownWidth, maxWidth: '100%' } : undefined}
      >
        <div
          className="relative overflow-hidden"
          style={
            imageUrl && activeCrop
              ? { aspectRatio: activeCrop.width / (activeCrop.height * aspect) }
              : undefined
          }
        >
          {imageUrl ? (
            <div
              className="relative"
              style={
                activeCrop
                  ? {
                      position: 'absolute',
                      left: `${-(activeCrop.x / activeCrop.width) * 100}%`,
                      top: `${-(activeCrop.y / activeCrop.height) * 100}%`,
                      width: `${100 / activeCrop.width}%`,
                    }
                  : undefined
              }
            >
              <img
                src={imageUrl}
                alt={caption}
                className="block w-full"
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth > 0) setAspect(image.naturalHeight / image.naturalWidth)
                }}
              />
              <PageMarkLayer
                marks={marks}
                aspect={aspect}
                onChange={onMarksChange}
                tool={tool}
                color={color}
                textSize={textSize}
              />
            </div>
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
                className="absolute left-1 top-1 flex max-w-[calc(100%-3.5rem)] flex-wrap items-center gap-1 rounded-md bg-slate-900/80 px-1 py-0.5 text-[11px] text-white"
              >
                {onResize && (
                  <>
                    <SizeButton onClick={() => onResize(Math.round(maxWidth() * 0.35))}>작게</SizeButton>
                    <SizeButton onClick={() => onResize(Math.round(maxWidth() * 0.6))}>중간</SizeButton>
                    {/* 폭을 지우면 글 폭에 맞춘다. 그게 기본 모습이다. */}
                    <SizeButton onClick={() => onResize(null)}>꽉 차게</SizeButton>
                  </>
                )}
                {onCropChange && imageUrl && (
                  <SizeButton onClick={() => setCropping(true)}>자르기</SizeButton>
                )}
                {onCropChange && activeCrop && (
                  <SizeButton onClick={() => onCropChange(null)}>자르기 해제</SizeButton>
                )}
                {shownWidth && <span className="pl-1 tabular-nums opacity-70">{shownWidth}px</span>}
              </div>

              {onResize && (
                <span
                  role="presentation"
                  onPointerDown={startDrag}
                  className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-500 shadow dark:border-slate-900"
                />
              )}
            </>
          )}

          {onMarksChange && (selected || tool) && (
            <div
              contentEditable={false}
              data-page-tools=""
              className="absolute inset-x-1 bottom-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-md bg-slate-900/85 px-1 py-1 text-[11px] text-white shadow-sm backdrop-blur-sm"
            >
              <ToolButton active={tool === 'pen'} onClick={() => setTool(tool === 'pen' ? null : 'pen')}>
                펜
              </ToolButton>
              <ToolButton
                active={tool === 'highlight'}
                onClick={() => setTool(tool === 'highlight' ? null : 'highlight')}
              >
                형광펜
              </ToolButton>
              <ToolButton active={tool === 'text'} onClick={() => setTool(tool === 'text' ? null : 'text')}>
                글자
              </ToolButton>
              <ToolButton
                active={tool === 'rectangle'}
                onClick={() => setTool(tool === 'rectangle' ? null : 'rectangle')}
              >
                네모
              </ToolButton>
              <ToolButton active={tool === 'star'} onClick={() => setTool(tool === 'star' ? null : 'star')}>
                별표
              </ToolButton>
              <ToolButton
                active={tool === 'erase'}
                onClick={() => setTool(tool === 'erase' ? null : 'erase')}
              >
                지우개
              </ToolButton>

              {tool && tool !== 'erase' && (
                <span className="flex shrink-0 items-center gap-0.5 pl-1">
                  {STROKE_COLORS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={`색 ${value}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setColor(value)}
                      style={{ background: value }}
                      className={cn(
                        'h-3.5 w-3.5 rounded-full',
                        color === value ? 'ring-2 ring-white' : 'opacity-70',
                      )}
                    />
                  ))}
                </span>
              )}

              {tool === 'text' && (
                <select
                  value={textSize}
                  onChange={(event) => setTextSize(Number(event.target.value))}
                  aria-label="글자 크기"
                  className="rounded bg-white/20 px-0.5 py-0.5 text-[11px] text-white outline-none"
                >
                  {TEXT_SIZES.map((value) => (
                    <option key={value} value={value} className="text-slate-900">
                      {value}pt
                    </option>
                  ))}
                </select>
              )}

              {marks.length > 0 && (
                <>
                  <ToolButton onClick={() => onMarksChange(marks.slice(0, -1))}>되돌리기</ToolButton>
                  <ToolButton onClick={() => onMarksChange([])}>모두 지우기</ToolButton>
                </>
              )}
            </div>
          )}
        </div>

        <figcaption className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
            📄 {caption}
          </span>
          {lectureId && (
            <Link
              to={`/lectures/${lectureId}${page ? `?page=${page}` : ''}`}
              // 읽거나 쓰던 글을 잃지 않도록 새 탭에서 연다.
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700 hover:underline dark:bg-brand-900/40 dark:text-brand-200"
            >
              강의록 보기 ↗
            </Link>
          )}
        </figcaption>
      </figure>

      {cropping && imageUrl && onCropChange && (
        <LecturePageCropDialog
          src={imageUrl}
          initialCrop={activeCrop}
          onClose={() => setCropping(false)}
          onApply={(next) => {
            onCropChange(next)
            setCropping(false)
          }}
        />
      )}
    </>
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

function ToolButton({
  active = false,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      // 누르는 순간 선택이 풀리면 도구가 사라져 버린다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn('shrink-0 rounded px-1 py-0.5', active ? 'bg-white text-slate-900' : 'hover:bg-white/20')}
    >
      {children}
    </button>
  )
}
