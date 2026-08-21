/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Image from '@tiptap/extension-image'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Spinner } from '@/components/ui/Spinner'
import { useSignedUrl } from '@/lib/storage'
import { imageWidthOf, MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH } from '@/types/richtext'
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
function StoredImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null
  const caption = typeof node.attrs.alt === 'string' ? node.attrs.alt : null
  const url = useSignedUrl(src)

  const frameRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  // 끄는 동안에는 문서를 건드리지 않고 화면만 따라오게 한다.
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null)

  const savedWidth = imageWidthOf(node.attrs.width)
  const width = draggedWidth ?? savedWidth
  const canResize = editor.isEditable && Boolean(src)

  /** 편집기 폭을 넘겨 봐야 화면에서 잘리므로 거기까지만 늘린다. */
  function maxWidth(): number {
    const frame = frameRef.current?.getBoundingClientRect().width ?? MAX_IMAGE_WIDTH
    return Math.max(MIN_IMAGE_WIDTH, Math.min(Math.round(frame), MAX_IMAGE_WIDTH))
  }

  function startResize(event: ReactPointerEvent<HTMLElement>) {
    // 이미지 노드는 draggable 이라 이걸 막지 않으면 끌기가 이동으로 넘어간다.
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = imageRef.current?.getBoundingClientRect().width ?? MIN_IMAGE_WIDTH
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
    <NodeViewWrapper as="div" className="my-2">
      <div ref={frameRef} className="relative">
        {!src ? (
          <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <Spinner className="h-4 w-4" />
            이미지를 올리는 중입니다
          </div>
        ) : !url ? (
          <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
        ) : (
          <div className="relative inline-block max-w-full align-top">
            <img
              ref={imageRef}
              src={url}
              alt={caption ?? ''}
              draggable={false}
              style={width ? { width } : undefined}
              className={cn(
                // 폭을 정하지 않았으면 원본 크기로 두고, 편집기보다 넓을 때만 줄인다.
                'h-auto max-w-full rounded-lg',
                selected
                  ? 'ring-2 ring-brand-500'
                  : 'border border-slate-200 dark:border-slate-700',
              )}
            />

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
                className="absolute left-1 top-1 flex items-center gap-1 rounded-md bg-slate-900/80 px-1 py-0.5 text-[11px] text-white"
              >
                <SizeButton onClick={() => setFraction(0.35)}>작게</SizeButton>
                <SizeButton onClick={() => setFraction(0.6)}>중간</SizeButton>
                <SizeButton onClick={() => setFraction(1)}>꽉 차게</SizeButton>
                <SizeButton onClick={resetToNatural}>원본</SizeButton>
                {width && <span className="pl-1 tabular-nums opacity-70">{width}px</span>}
              </div>
            )}
          </div>
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
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(StoredImageView)
  },
})
