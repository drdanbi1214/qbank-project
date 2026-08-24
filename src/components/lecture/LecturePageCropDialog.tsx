import { useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  FULL_PAGE_CROP,
  MIN_CROP_SIZE,
  roundedPageCrop,
  type PageCrop,
} from '@/components/lecture/pageCrop'
import { cn } from '@/utils/cn'

type Props = {
  src: string
  initialCrop: PageCrop | null
  onApply: (crop: PageCrop | null) => void
  onClose: () => void
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se'

/** 원본 페이지 위에서 보존할 영역을 고르는 비파괴 자르기 창. */
export function LecturePageCropDialog({ src, initialCrop, onApply, onClose }: Props) {
  const image = useRef<HTMLImageElement | null>(null)
  const [crop, setCrop] = useState<PageCrop>(initialCrop ?? FULL_PAGE_CROP)

  function startDrag(event: React.PointerEvent, mode: DragMode) {
    const box = image.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const start = crop

    const move = (moved: PointerEvent) => {
      const dx = (moved.clientX - startX) / box.width
      const dy = (moved.clientY - startY) / box.height

      if (mode === 'move') {
        setCrop({
          ...start,
          x: clamp(start.x + dx, 0, 1 - start.width),
          y: clamp(start.y + dy, 0, 1 - start.height),
        })
        return
      }

      let left = start.x
      let top = start.y
      let right = start.x + start.width
      let bottom = start.y + start.height

      if (mode.includes('w')) left = clamp(start.x + dx, 0, right - MIN_CROP_SIZE)
      if (mode.includes('e')) right = clamp(right + dx, left + MIN_CROP_SIZE, 1)
      if (mode.includes('n')) top = clamp(start.y + dy, 0, bottom - MIN_CROP_SIZE)
      if (mode.includes('s')) bottom = clamp(bottom + dy, top + MIN_CROP_SIZE, 1)

      setCrop({ x: left, y: top, width: right - left, height: bottom - top })
    }

    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <Modal
      title="강의록 이미지 자르기"
      wide
      onClose={onClose}
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCrop(FULL_PAGE_CROP)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            전체 페이지 선택
          </button>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => onApply(roundedPageCrop(crop))}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              적용
            </button>
          </span>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        밝은 테두리의 안쪽만 본문에 표시됩니다. 영역 안을 끌어 옮기거나 네 모서리를 조절하세요.
      </p>
      <div className="flex min-h-48 items-center justify-center overflow-auto rounded-xl bg-slate-100 p-2 dark:bg-slate-950">
        <div className="relative mx-auto w-fit max-w-full overflow-hidden select-none">
          <img
            ref={image}
            src={src}
            alt="자를 강의록 페이지"
            draggable={false}
            className="block max-h-[58dvh] max-w-full"
          />
          <div
            role="presentation"
            onPointerDown={(event) => startDrag(event, 'move')}
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
              boxShadow: '0 0 0 9999px rgb(15 23 42 / 0.58)',
            }}
            className="absolute cursor-move touch-none border-2 border-white ring-1 ring-brand-500"
          >
            <span className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-dashed border-white/50" />
            <span className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-dashed border-white/50" />
            <span className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-dashed border-white/50" />
            <span className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-dashed border-white/50" />
            {(['nw', 'ne', 'sw', 'se'] as const).map((mode) => (
              <span
                key={mode}
                role="presentation"
                onPointerDown={(event) => startDrag(event, mode)}
                className={cn(
                  'absolute h-5 w-5 touch-none rounded-full border-2 border-white bg-brand-500 shadow',
                  mode === 'nw' && '-left-2.5 -top-2.5 cursor-nwse-resize',
                  mode === 'ne' && '-right-2.5 -top-2.5 cursor-nesw-resize',
                  mode === 'sw' && '-bottom-2.5 -left-2.5 cursor-nesw-resize',
                  mode === 'se' && '-bottom-2.5 -right-2.5 cursor-nwse-resize',
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
