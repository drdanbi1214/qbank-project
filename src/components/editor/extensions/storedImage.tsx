/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Image from '@tiptap/extension-image'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { LecturePageCropDialog } from '@/components/lecture/LecturePageCropDialog'
import { PageMarkLayer } from '@/components/lecture/PageMarkLayer'
import { pageCropOf } from '@/components/lecture/pageCrop'
import {
  DEFAULT_TEXT_SIZE,
  parsePageMarks,
  STROKE_COLORS,
  TEXT_SIZES,
  type MarkTool,
} from '@/components/lecture/pageMarks'
import { Spinner } from '@/components/ui/Spinner'
import { useSignedUrl } from '@/lib/storage'
import {
  imageLayoutOf,
  imageWidthOf,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
} from '@/types/richtext'
import { cn } from '@/utils/cn'

/**
 * 본문 이미지.
 *
 * src 에는 서명 URL 이 아니라 `<bucket>/<path>` 경로를 저장한다. 서명 URL 은
 * 만료되기 때문에 본문에 박아두면 나중에 깨진다. 표시할 때마다 새로 발급한다.
 *
 * 업로드가 끝나기 전에는 uploadId 만 가진 자리표시자 노드로 먼저 삽입하고,
 * 완료되면 같은 uploadId 를 가진 노드를 찾아 src 로 바꿔치기한다.
 *
 * width 는 사람이 조절한 폭(px)이다. 값이 없으면 예전 문서와 같게 그린다.
 */
function StoredImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null
  const caption = typeof node.attrs.alt === 'string' ? node.attrs.alt : null
  const url = useSignedUrl(src)

  const frameRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  // 끄는 동안에는 문서를 건드리지 않고 화면만 따라오게 한다.
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null)
  const [cropping, setCropping] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ width: number; aspect: number } | null>(null)
  const [markTool, setMarkTool] = useState<MarkTool | 'erase' | null>(null)
  const [markColor, setMarkColor] = useState<string>(STROKE_COLORS[0])
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE)

  const savedWidth = imageWidthOf(node.attrs.width)
  const width = draggedWidth ?? savedWidth
  const layout = imageLayoutOf(node.attrs.layout)
  const activeCrop = pageCropOf(node.attrs.crop)
  const cropAspectRatio =
    activeCrop && naturalSize
      ? activeCrop.width / (activeCrop.height * naturalSize.aspect)
      : null
  const cropReady = cropAspectRatio !== null ? activeCrop : null
  const marks = parsePageMarks(node.attrs.strokes)
  // 폭이 따로 없는 예전 이미지도 자른 뒤 0px로 접히지 않도록 원본 폭을 쓴다.
  const displayWidth = width ?? (activeCrop ? imageWidthOf(naturalSize?.width) : null)
  const canResize = editor.isEditable && Boolean(src)

  function selectThisImage(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editor.isEditable || event.button !== 0) return
    const position = getPos()
    if (typeof position !== 'number') return

    // 이미지 자체는 편집 불가능한 원자 노드다. 클릭이 주변 문단의 텍스트 커서로
    // 넘어가지 않게 대상을 명시적으로 선택한다.
    if (!selected) editor.commands.setNodeSelection(position)
    event.stopPropagation()
  }

  /** 편집기 폭을 넘겨 봐야 화면에서 잘리므로 거기까지만 늘린다. */
  function maxWidth(): number {
    // 나란히 놓인 반쪽 프레임 자체를 기준으로 삼으면 다시 전체 폭으로 키울 수 없다.
    const editorWidth = frameRef.current?.closest<HTMLElement>('.rich-text')
      ?.getBoundingClientRect().width
    const frameWidth = frameRef.current?.getBoundingClientRect().width
    const limit = editorWidth ?? frameWidth ?? MAX_IMAGE_WIDTH
    return Math.max(MIN_IMAGE_WIDTH, Math.min(Math.round(limit), MAX_IMAGE_WIDTH))
  }

  function startResize(event: ReactPointerEvent<HTMLElement>) {
    // 이미지 노드는 draggable 이라 이걸 막지 않으면 끌기가 이동으로 넘어간다.
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    // 자른 이미지는 원본 img가 프레임보다 크게 확대되어 있으므로 보이는 프레임을 잰다.
    const startWidth = displayRef.current?.getBoundingClientRect().width ?? MIN_IMAGE_WIDTH
    const limit = maxWidth()
    let next = Math.round(startWidth)

    const move = (moved: PointerEvent) => {
      next = Math.min(Math.max(Math.round(startWidth + moved.clientX - startX), MIN_IMAGE_WIDTH), limit)
      setDraggedWidth(next)
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      updateAttributes({ width: next })
      setDraggedWidth(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  function setFraction(fraction: number) {
    updateAttributes({ width: Math.max(MIN_IMAGE_WIDTH, Math.round(maxWidth() * fraction)) })
  }

  /**
   * 원본 픽셀 크기로 되돌린다.
   *
   * 폭을 null 로 지우면 "폭 미지정" 취급이라 max-h-96 으로 눌린다. 그건 원본이
   * 아니라 오히려 축소다. 실제 이미지의 naturalWidth 를 넣어야 원본이 된다.
   */
  function resetToNatural() {
    const natural = imageWidthOf(imageRef.current?.naturalWidth)
    updateAttributes({ width: natural })
  }

  return (
    <NodeViewWrapper
      as="div"
      data-stored-image=""
      data-side-by-side-item=""
      data-image-layout={layout ?? 'full'}
      className="block w-full align-top"
      contentEditable={false}
      onPointerDown={selectThisImage}
    >
      <div ref={frameRef} className="relative">
        {!src ? (
          <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <Spinner className="h-4 w-4" />
            이미지를 올리는 중입니다
          </div>
        ) : !url ? (
          <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
        ) : (
          <>
            <div
              ref={displayRef}
              // Tiptap의 React NodeView는 이 표시가 있는 영역에서 mousedown이
              // 시작되어야 노드 이동으로 전환한다. 바깥 노드가 draggable이어도
              // 이 표시가 없으면 dragstart를 막아 이미지가 전혀 움직이지 않는다.
              data-drag-handle={canResize && !markTool ? '' : undefined}
              draggable={canResize && !markTool ? true : undefined}
              title={canResize && !markTool ? '이미지를 끌어서 이동' : undefined}
              style={displayWidth ? { width: displayWidth } : undefined}
              className={cn(
                'relative inline-block max-w-full align-top',
                canResize && !markTool && 'touch-none select-none cursor-grab active:cursor-grabbing',
              )}
            >
              <div
                style={
                  cropAspectRatio !== null
                    ? { aspectRatio: cropAspectRatio }
                    : undefined
                }
                className={cn(
                  'relative overflow-hidden rounded-lg',
                  selected
                    ? 'ring-2 ring-brand-500'
                    : 'border border-slate-200 dark:border-slate-700',
                )}
              >
                <div
                  style={
                    cropReady
                      ? {
                          position: 'absolute',
                          left: `${-(cropReady.x / cropReady.width) * 100}%`,
                          top: `${-(cropReady.y / cropReady.height) * 100}%`,
                          width: `${100 / cropReady.width}%`,
                        }
                      : undefined
                  }
                  className="relative"
                >
                  <img
                    ref={imageRef}
                    src={url}
                    alt={caption ?? ''}
                    draggable={false}
                    onLoad={(event) => {
                      const image = event.currentTarget
                      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
                      setNaturalSize({
                        width: image.naturalWidth,
                        aspect: image.naturalHeight / image.naturalWidth,
                      })
                    }}
                    style={displayWidth ? { width: '100%' } : undefined}
                    className="block h-auto max-w-full"
                  />
                  <PageMarkLayer
                    marks={marks}
                    aspect={naturalSize?.aspect ?? 1}
                    onChange={canResize ? (next) => updateAttributes({ strokes: next }) : undefined}
                    tool={markTool}
                    color={markColor}
                    textSize={textSize}
                  />
                </div>
              </div>

              {canResize && (
                <span
                  role="presentation"
                  contentEditable={false}
                  onPointerDown={startResize}
                  title="끌어서 크기 조절"
                  className={cn(
                    'absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-500 shadow transition-opacity dark:border-slate-900',
                    // 예전에는 완전히 투명해서 크기를 조절할 수 있다는 걸 몰랐다.
                    selected ? 'opacity-100' : 'opacity-40 hover:opacity-100',
                  )}
                />
              )}

              {canResize && (selected || draggedWidth !== null) && (
                <div
                  contentEditable={false}
                  className="absolute left-1 top-1 flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1 rounded-md bg-slate-900/80 px-1 py-0.5 text-[11px] text-white"
                >
                  <SizeButton onClick={() => setFraction(0.35)}>작게</SizeButton>
                  <SizeButton onClick={() => setFraction(0.6)}>중간</SizeButton>
                  <SizeButton onClick={() => setFraction(1)}>꽉 차게</SizeButton>
                  <SizeButton onClick={resetToNatural}>원본</SizeButton>
                  <SizeButton onClick={() => setCropping(true)}>자르기</SizeButton>
                  {activeCrop && (
                    <SizeButton onClick={() => updateAttributes({ crop: null })}>
                      자르기 해제
                    </SizeButton>
                  )}
                  {layout === 'half' && (
                    <SizeButton onClick={() => updateAttributes({ layout: null })}>한 줄</SizeButton>
                  )}
                  {width && <span className="pl-1 tabular-nums opacity-70">{width}px</span>}
                </div>
              )}

              {canResize && selected && draggedWidth === null && (
                <span
                  contentEditable={false}
                  className="pointer-events-none absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                >
                  끌어서 이동
                </span>
              )}

              {canResize && (selected || markTool) && (
                <div
                  contentEditable={false}
                  data-page-tools=""
                  className="absolute inset-x-1 bottom-1 flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-md bg-slate-900/85 px-1 py-1 text-[11px] text-white shadow-sm backdrop-blur-sm"
                >
                  <MarkToolButton
                    active={markTool === 'pen'}
                    onClick={() => setMarkTool(markTool === 'pen' ? null : 'pen')}
                  >
                    펜
                  </MarkToolButton>
                  <MarkToolButton
                    active={markTool === 'highlight'}
                    onClick={() => setMarkTool(markTool === 'highlight' ? null : 'highlight')}
                  >
                    형광펜
                  </MarkToolButton>
                  <MarkToolButton
                    active={markTool === 'text'}
                    onClick={() => setMarkTool(markTool === 'text' ? null : 'text')}
                  >
                    글자
                  </MarkToolButton>
                  <MarkToolButton
                    active={markTool === 'rectangle'}
                    onClick={() => setMarkTool(markTool === 'rectangle' ? null : 'rectangle')}
                  >
                    네모
                  </MarkToolButton>
                  <MarkToolButton
                    active={markTool === 'star'}
                    onClick={() => setMarkTool(markTool === 'star' ? null : 'star')}
                  >
                    별표
                  </MarkToolButton>
                  <MarkToolButton
                    active={markTool === 'erase'}
                    onClick={() => setMarkTool(markTool === 'erase' ? null : 'erase')}
                  >
                    지우개
                  </MarkToolButton>

                  {markTool && markTool !== 'erase' && (
                    <span className="flex shrink-0 items-center gap-0.5 pl-1">
                      {STROKE_COLORS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`색 ${value}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setMarkColor(value)}
                          style={{ background: value }}
                          className={cn(
                            'h-3.5 w-3.5 rounded-full',
                            markColor === value ? 'ring-2 ring-white' : 'opacity-70',
                          )}
                        />
                      ))}
                    </span>
                  )}

                  {markTool === 'text' && (
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
                      <MarkToolButton onClick={() => updateAttributes({ strokes: marks.slice(0, -1) })}>
                        되돌리기
                      </MarkToolButton>
                      <MarkToolButton onClick={() => updateAttributes({ strokes: [] })}>
                        모두 지우기
                      </MarkToolButton>
                    </>
                  )}
                </div>
              )}
            </div>

            {cropping && (
              <LecturePageCropDialog
                src={url}
                initialCrop={activeCrop}
                title="사진 자르기"
                resetLabel="전체 사진 선택"
                imageAlt="자를 사진"
                onClose={() => setCropping(false)}
                onApply={(crop) => {
                  updateAttributes({ crop })
                  setCropping(false)
                }}
              />
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
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

function MarkToolButton({
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
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded px-1 py-0.5',
        active ? 'bg-white text-slate-900' : 'hover:bg-white/20',
      )}
    >
      {children}
    </button>
  )
}

export const StoredImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        /**
         * width 속성이 없으면 폭을 정하지 않은 것으로 둔다.
         *
         * Number(null) 은 0 이고 imageWidthOf 는 최솟값 80 으로 올려버린다.
         * 그래서 폭 없이 붙여넣은 이미지가 전부 80px 로 쪼그라들었다.
         */
        parseHTML: (element) => {
          const raw = element.getAttribute('width')
          if (raw === null || raw.trim() === '') return null
          const value = Number(raw)
          return Number.isFinite(value) && value > 0 ? imageWidthOf(value) : null
        },
        renderHTML: (attributes) => {
          const width = imageWidthOf(attributes.width)
          return width ? { width: String(width) } : {}
        },
      },
      uploadId: {
        default: null,
        // 업로드 진행 추적용이라 저장할 필요가 없다.
        rendered: false,
      },
      layout: {
        default: null,
        parseHTML: (element) => imageLayoutOf(element.getAttribute('data-image-layout')),
        renderHTML: (attributes) => {
          const layout = imageLayoutOf(attributes.layout)
          return layout ? { 'data-image-layout': layout } : {}
        },
      },
      crop: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-image-crop')
          if (!raw) return null
          try {
            return pageCropOf(JSON.parse(raw))
          } catch {
            return null
          }
        },
        renderHTML: (attributes) => {
          const crop = pageCropOf(attributes.crop)
          return crop ? { 'data-image-crop': JSON.stringify(crop) } : {}
        },
      },
      // 일반 사진에도 강의록 쪽과 같은 좌표 기반 필기를 남긴다. 이미지 파일은
      // 건드리지 않고 본문 JSON에만 저장해 크기·자르기 변경에도 맞춰 따라간다.
      strokes: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-strokes')
          if (!raw) return null
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        },
        renderHTML: (attributes) =>
          Array.isArray(attributes.strokes) && attributes.strokes.length > 0
            ? { 'data-strokes': JSON.stringify(attributes.strokes) }
            : {},
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(StoredImageView, {
      // 실제 ProseMirror 노드는 React 컴포넌트보다 바깥 래퍼다. 반폭 CSS와
      // 다른 미디어의 드롭 대상 판별에 쓸 속성을 그 바깥에도 붙인다.
      attrs: ({ node }) => ({
        'data-side-by-side-item': '',
        'data-image-layout': node.attrs.layout === 'half' ? 'half' : 'full',
      }),
    })
  },
})
