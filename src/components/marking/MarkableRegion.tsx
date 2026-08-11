import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MarkToolbar } from '@/components/marking/MarkToolbar'
import {
  readSelectionRange,
  type MarkStyle,
  type SelectionRange,
} from '@/components/marking/marks'

type Props = {
  children: ReactNode
  onApply: (range: SelectionRange, style: MarkStyle) => void
  onErase: (range: SelectionRange) => void
  /** 값이 있으면 툴바에 Q 버튼이 붙는다 */
  onAsk?: (range: SelectionRange) => void
  className?: string
}

/**
 * 안쪽 텍스트를 드래그하면 서식 툴바를 띄우는 영역.
 *
 * 웹의 드래그와 모바일의 길게 눌러 선택은 둘 다 selection 이 확정되는 시점이
 * 같아서 mouseup 과 touchend 를 함께 듣는다.
 */
export function MarkableRegion({ children, onApply, onErase, onAsk, className }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ range: SelectionRange; rect: DOMRect } | null>(null)

  const capture = useCallback(() => {
    const node = container.current
    if (!node) return

    // 브라우저가 선택을 확정한 뒤에 읽어야 한다.
    window.setTimeout(() => {
      const range = readSelectionRange(node)
      if (!range) {
        setPending(null)
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      setPending({ range, rect: selection.getRangeAt(0).getBoundingClientRect() })
    }, 0)
  }, [])

  const dismiss = useCallback(() => {
    setPending(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  // 스크롤하면 툴바 위치가 어긋나므로 닫는다.
  useEffect(() => {
    if (!pending) return
    const close = () => setPending(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pending])

  return (
    <>
      <div ref={container} onMouseUp={capture} onTouchEnd={capture} className={className}>
        {children}
      </div>

      {pending && (
        <MarkToolbar
          rect={pending.rect}
          onPick={(style) => {
            onApply(pending.range, style)
            dismiss()
          }}
          onErase={() => {
            onErase(pending.range)
            dismiss()
          }}
          onAsk={
            onAsk
              ? () => {
                  onAsk(pending.range)
                  dismiss()
                }
              : undefined
          }
        />
      )}
    </>
  )
}
