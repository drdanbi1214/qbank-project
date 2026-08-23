import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_TEXT_SIZE,
  isPageText,
  NOMINAL_PT_WIDTH,
  simplify,
  STROKE_COLORS,
  toPath,
  TOOL_OPACITY,
  TOOL_WIDTH,
  type MarkTool,
  type PageMark,
  type Stroke,
} from '@/components/lecture/pageMarks'
import { cn } from '@/utils/cn'

const VIEW = 1000
/** 이만큼 안 움직였으면 끌어 옮긴 게 아니라 누른 것으로 본다. */
const DRAG_SLOP = 0.006

type Editing = { index: number | null; value: string; x: number; y: number }

type Props = {
  marks: PageMark[]
  /** 이미지 세로/가로 비. 표시가 늘어지지 않게 좌표계를 이 비율로 세운다. */
  aspect: number
  /** 편집 중일 때만 온다. 없으면 그리기 없이 보여 주기만 한다. */
  onChange?: (marks: PageMark[]) => void
  tool?: MarkTool | 'erase' | null
  color?: string
  /** 새로 얹을 글자의 크기(pt). */
  textSize?: number
}

/**
 * 강의록 쪽 위에 덧그리고 글자를 얹는 층.
 *
 * 이미지 위에 겹쳐 놓되, 손대는 중이 아닐 때는 클릭이 그대로 이미지로 지나가게
 * 둔다. 그렇지 않으면 카드를 고르거나 링크를 누를 수 없다.
 *
 * 이미 얹은 글자의 색과 크기는 그대로 둔다. 펜으로 그은 자국의 색이 나중에
 * 바뀌지 않는 것과 같다. 고르개는 다음에 얹을 글자에만 걸린다.
 */
export function PageMarkLayer({
  marks,
  aspect,
  onChange,
  tool = null,
  color,
  textSize = DEFAULT_TEXT_SIZE,
}: Props) {
  const svg = useRef<SVGSVGElement | null>(null)
  const [drawing, setDrawing] = useState<Stroke | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // 끄는 동안에는 여기에만 담는다. 움직일 때마다 본문에 쓰면 되돌리기 기록이
  // 프레임 수만큼 쌓이고 글 저장이 계속 흔들린다.
  const [dragging, setDragging] = useState<{ index: number; at: [number, number] } | null>(null)
  // 글자 입력칸은 SVG 밖의 보통 요소라 실제 픽셀 크기를 알아야 눈금이 맞는다.
  const [pxWidth, setPxWidth] = useState(0)
  const height = VIEW * aspect

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPxWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function pointAt(event: React.PointerEvent): [number, number] | null {
    const box = svg.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height]
  }

  function commitText(next: Editing | null = editing) {
    if (!next || !onChange) return
    setEditing(null)
    const value = next.value.trim()
    const updated = [...marks]

    if (next.index === null) {
      if (value === '') return
      updated.push({
        tool: 'text',
        color: color ?? STROKE_COLORS[0],
        size: textSize,
        text: value,
        points: [next.x, next.y],
      })
    } else {
      const current = updated[next.index]
      if (!current || !isPageText(current)) return
      // 비우면 지운다. 글자를 없애는 가장 손에 익은 길이다.
      if (value === '') updated.splice(next.index, 1)
      else updated[next.index] = { ...current, text: value, points: [next.x, next.y] }
    }
    onChange(updated)
  }

  function start(event: React.PointerEvent) {
    if (!onChange || !tool || tool === 'erase') return
    const at = pointAt(event)
    if (!at) return
    event.preventDefault()

    if (tool === 'text') {
      // 쓰던 것이 있으면 먼저 갈무리하고 새 자리를 연다.
      if (editing) commitText()
      setEditing({ index: null, value: '', x: at[0], y: at[1] })
      return
    }

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
    onChange?.([...marks, simplified])
  }

  /** 이미 얹은 글자를 누르면 옮기거나(끌면) 고친다(그냥 놓으면). */
  function grabText(event: React.PointerEvent<SVGTextElement>, index: number) {
    if (!onChange) return
    event.stopPropagation()
    if (tool === 'erase') {
      onChange(marks.filter((_, i) => i !== index))
      return
    }
    if (tool !== 'text') return

    const mark = marks[index]
    if (!isPageText(mark)) return
    const from = pointAt(event)
    if (!from) return
    event.preventDefault()
    let at: [number, number] = [mark.points[0], mark.points[1]]
    let moved = false

    const onMove = (moving: PointerEvent) => {
      const box = svg.current?.getBoundingClientRect()
      if (!box || box.width === 0) return
      const nowX = (moving.clientX - box.left) / box.width
      const nowY = (moving.clientY - box.top) / box.height
      if (!moved && Math.hypot(nowX - from[0], nowY - from[1]) <= DRAG_SLOP) return
      moved = true
      at = [
        Math.min(Math.max(mark.points[0] + nowX - from[0], 0), 1),
        Math.min(Math.max(mark.points[1] + nowY - from[1], 0), 1),
      ]
      setDragging({ index, at })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setDragging(null)
      if (!moved) {
        setEditing({ index, value: mark.text, x: at[0], y: at[1] })
        return
      }
      const next = [...marks]
      next[index] = { ...mark, points: at }
      onChange(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const active = Boolean(onChange && tool)
  const shown = drawing ? [...marks, drawing] : marks
  // 고치는 중인 글자는 제 색과 크기를 지킨다. 새로 얹는 것만 고르개를 따른다.
  const beingEdited = editing && editing.index !== null ? marks[editing.index] : null
  const editStyle =
    beingEdited && isPageText(beingEdited)
      ? { size: beingEdited.size, color: beingEdited.color }
      : { size: textSize, color: color ?? STROKE_COLORS[0] }

  return (
    <>
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
        {shown.map((mark, index) => {
          const grabbable = Boolean(onChange) && (tool === 'text' || tool === 'erase')
          if (isPageText(mark)) {
            const size = (mark.size / NOMINAL_PT_WIDTH) * VIEW
            const at = dragging?.index === index ? dragging.at : mark.points
            return (
              <text
                key={index}
                x={at[0] * VIEW}
                y={at[1] * height}
                fill={mark.color}
                fontSize={size}
                fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                fontWeight={600}
                dominantBaseline="hanging"
                // 강의록 바탕이 어두울 때도 읽히도록 얇은 흰 테를 두른다.
                stroke="#ffffff"
                strokeWidth={size * 0.16}
                strokeLinejoin="round"
                paintOrder="stroke"
                className={cn(
                  editing?.index === index && 'opacity-0',
                  grabbable && (tool === 'erase' ? 'cursor-pointer' : 'cursor-move'),
                )}
                style={{ pointerEvents: grabbable ? 'auto' : 'none', userSelect: 'none' }}
                onPointerDown={grabbable ? (event) => grabText(event, index) : undefined}
              >
                {mark.text}
              </text>
            )
          }
          return (
            <path
              key={index}
              d={toPath(mark.points, VIEW, height)}
              fill="none"
              stroke={mark.color}
              strokeWidth={mark.width * VIEW}
              strokeOpacity={TOOL_OPACITY[mark.tool]}
              strokeLinecap="round"
              strokeLinejoin="round"
              // 지우개일 때만 획을 눌러 지울 수 있게 한다.
              className={tool === 'erase' && onChange ? 'cursor-pointer' : ''}
              style={{ pointerEvents: tool === 'erase' && onChange ? 'stroke' : 'none' }}
              onPointerDown={
                tool === 'erase' && onChange
                  ? (event) => {
                      event.stopPropagation()
                      onChange(marks.filter((_, i) => i !== index))
                    }
                  : undefined
              }
            />
          )
        })}
      </svg>

      {editing && onChange && (
        <input
          autoFocus
          value={editing.value}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitText()
            if (event.key === 'Escape') setEditing(null)
          }}
          onBlur={(event) => {
            // 크기 고르개를 누른 것뿐이면 쓰던 글자를 버리지 않는다.
            const moved = event.relatedTarget
            if (moved instanceof HTMLElement && moved.closest('[data-page-tools]')) return
            commitText()
          }}
          placeholder="글자 입력 후 Enter"
          style={{
            left: `${editing.x * 100}%`,
            top: `${editing.y * 100}%`,
            color: editStyle.color,
            fontSize: pxWidth > 0 ? (editStyle.size / NOMINAL_PT_WIDTH) * pxWidth : editStyle.size,
            maxWidth: `${Math.max(100 - editing.x * 100, 20)}%`,
          }}
          className="absolute w-40 rounded border border-brand-500 bg-white/95 px-1 font-semibold leading-tight outline-none dark:bg-slate-900/95"
        />
      )}
    </>
  )
}
