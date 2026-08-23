import { useRef, useState } from 'react'
import {
  simplify,
  STROKE_COLORS,
  toPath,
  TOOL_OPACITY,
  TOOL_WIDTH,
  type Stroke,
  type StrokeTool,
} from '@/components/lecture/pageStrokes'
import { cn } from '@/utils/cn'

const VIEW = 1000

type Props = {
  strokes: Stroke[]
  /** 이미지 세로/가로 비. 자국이 늘어지지 않게 좌표계를 이 비율로 세운다. */
  aspect: number
  /** 편집 중일 때만 온다. 없으면 그리기 없이 보여 주기만 한다. */
  onChange?: (strokes: Stroke[]) => void
  tool?: StrokeTool | 'erase' | null
  color?: string
}

/**
 * 강의록 쪽 위에 덧그리는 층.
 *
 * 이미지 위에 겹쳐 놓되, 그리는 중이 아닐 때는 클릭이 그대로 이미지로 지나가게
 * 둔다. 그렇지 않으면 카드를 고르거나 링크를 누를 수 없다.
 */
export function PageStrokeLayer({ strokes, aspect, onChange, tool = null, color }: Props) {
  const svg = useRef<SVGSVGElement | null>(null)
  const [drawing, setDrawing] = useState<Stroke | null>(null)
  const height = VIEW * aspect

  function pointAt(event: React.PointerEvent): [number, number] | null {
    const box = svg.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
  }

  function start(event: React.PointerEvent) {
    if (!onChange || !tool || tool === 'erase') return
    const at = pointAt(event)
    if (!at) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawing({
      tool,
      color: color ?? STROKE_COLORS[0],
      width: TOOL_WIDTH[tool],
      points: [at[0], at[1]],
    })
  }

  function move(event: React.PointerEvent) {
    if (!drawing) return
    const at = pointAt(event)
    if (!at) return
    setDrawing({ ...drawing, points: [...drawing.points, at[0], at[1]] })
  }

  function finish() {
    if (!drawing) return
    // 화면에 보이는 모양은 그대로면서 점 수만 줄여 본문을 가볍게 둔다.
    const simplified = { ...drawing, points: simplify(drawing.points) }
    setDrawing(null)
    onChange?.([...strokes, simplified])
  }

  const active = Boolean(onChange && tool)
  const shown = drawing ? [...strokes, drawing] : strokes

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${VIEW} ${height}`}
      preserveAspectRatio="none"
      className={cn(
        'absolute inset-0 h-full w-full',
        active ? 'cursor-crosshair touch-none' : 'pointer-events-none',
      )}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {shown.map((stroke, index) => (
        <path
          key={index}
          d={toPath(stroke.points, VIEW, height)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width * VIEW}
          strokeOpacity={TOOL_OPACITY[stroke.tool]}
          strokeLinecap="round"
          strokeLinejoin="round"
          // 지우개일 때만 획을 눌러 지울 수 있게 한다.
          className={tool === 'erase' && onChange ? 'cursor-pointer' : ''}
          style={{ pointerEvents: tool === 'erase' && onChange ? 'stroke' : 'none' }}
          onPointerDown={
            tool === 'erase' && onChange
              ? (event) => {
                  event.stopPropagation()
                  onChange(strokes.filter((_, i) => i !== index))
                }
              : undefined
          }
        />
      ))}
    </svg>
  )
}
