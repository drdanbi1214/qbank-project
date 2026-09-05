import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_TEXT_BACKGROUND,
  DEFAULT_TEXT_BORDER,
  DEFAULT_TEXT_SIZE,
  isPageShape,
  isPageText,
  NOMINAL_PT_WIDTH,
  simplifyStroke,
  STROKE_COLORS,
  TEXT_BOX_BACKGROUNDS,
  TEXT_BOX_BORDERS,
  toPath,
  toPressurePenPath,
  TOOL_OPACITY,
  TOOL_WIDTH,
  type MarkTool,
  type PageMark,
  type PageShape,
  type PageText,
  type Stroke,
} from '@/components/lecture/pageMarks'
import { cn } from '@/utils/cn'

const VIEW = 1000
/** 이만큼 안 움직였으면 끌어 옮긴 게 아니라 누른 것으로 본다. */
const DRAG_SLOP = 0.006
/** 형광펜 끝에서 이 시간만큼 머물면 시작점부터 끝점까지 곧게 편다. */
const HOLD_TO_LINE_MS = 500
/** Apple Pencil의 미세한 떨림은 머무르는 중인 것으로 본다. */
const HOLD_SLOP_PX = 8
/** Pencil을 뗀 직후 따라 닿는 손바닥 입력도 필기로 보지 않는다. */
const PALM_REJECTION_GRACE_MS = 280
/** 예측 꼬리가 실제 Pencil 위치보다 멀리 튀어 나가지 않게 한다. */
const MAX_PREDICTION_DISTANCE_PX = 12
/** 보이는 선보다 넉넉하게 잡아 Pencil로 얇은 획도 쉽게 지운다. */
const ERASER_RADIUS_PX = 14
const ERASER_SAMPLE_GAP_PX = 6

type Editing = {
  index: number | null
  value: string
  x: number
  y: number
  background: string
  borderColor: string
}

type TouchScroll = {
  pointerId: number
  lastY: number
  target: HTMLElement
}

type EraserGesture = {
  pointerId: number
  last: [number, number]
  original: PageMark[]
  erased: Set<number>
  next: PageMark[]
}

type GestureBounds = {
  left: number
  top: number
  width: number
  height: number
}

type PenScrollLock = {
  target: HTMLElement
  listenerTarget: HTMLElement | Window
  scrollTop: number
  scrollLeft: number
  onScroll: () => void
}

type Props = {
  marks: PageMark[]
  /** 이미지 세로/가로 비. 표시가 늘어지지 않게 좌표계를 이 비율로 세운다. */
  aspect: number
  /** 편집 중일 때만 온다. 없으면 그리기 없이 보여 주기만 한다. */
  onChange?: (marks: PageMark[]) => void
  tool?: MarkTool | 'erase' | null
  color?: string
  /** 새로 그릴 선의 굵기. 없으면 도구 기본값을 쓴다. */
  strokeWidth?: number
  /** 새로 얹을 글자의 크기(pt). */
  textSize?: number
  /** false면 Apple Pencil/마우스만 그리고 손가락은 페이지를 스크롤한다. */
  allowTouchDrawing?: boolean
  /** 이 페이지에서 필기 입력을 시작했음을 바깥에 알린다. */
  onInteract?: () => void
  className?: string
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
  strokeWidth,
  textSize = DEFAULT_TEXT_SIZE,
  allowTouchDrawing = true,
  onInteract,
  className,
}: Props) {
  const svg = useRef<SVGSVGElement | null>(null)
  const liveStrokePath = useRef<SVGPathElement | null>(null)
  const drawingRef = useRef<Stroke | PageShape | null>(null)
  const drawingPreviewRef = useRef<Stroke | PageShape | null>(null)
  const gestureBoundsRef = useRef<GestureBounds | null>(null)
  const lineHoldTimer = useRef<number | null>(null)
  const lineHoldAnchor = useRef<{ x: number; y: number } | null>(null)
  const snappedToLine = useRef(false)
  const touchScrollRef = useRef<TouchScroll | null>(null)
  const drawingPointerId = useRef<number | null>(null)
  const drawingPointerType = useRef<string | null>(null)
  const activePenPointerId = useRef<number | null>(null)
  const ignoreTouchUntil = useRef(0)
  const activeTouchPointers = useRef(new Set<number>())
  const suppressedTouchPointers = useRef(new Set<number>())
  const penScrollLockRef = useRef<PenScrollLock | null>(null)
  const drawingFrame = useRef<number | null>(null)
  const erasingRef = useRef<EraserGesture | null>(null)
  const erasingFrame = useRef<number | null>(null)
  // 펜/형광펜 미리보기는 React 상태를 거치지 않고 아래 SVG path에 바로 그린다.
  // 매 프레임 저장된 필기까지 다시 비교하지 않아 긴 Pencil 획도 가볍게 따라온다.
  const [drawingShape, setDrawingShape] = useState<PageShape | null>(null)
  const [erasingMarks, setErasingMarks] = useState<PageMark[] | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  // 끄는 동안에는 여기에만 담는다. 움직일 때마다 본문에 쓰면 되돌리기 기록이
  // 프레임 수만큼 쌓이고 글 저장이 계속 흔들린다.
  const [dragging, setDragging] = useState<{ index: number; at: [number, number] } | null>(null)
  // 글자 입력칸은 SVG 밖의 보통 요소라 실제 픽셀 크기를 알아야 눈금이 맞는다.
  const [pxWidth, setPxWidth] = useState(0)
  const height = VIEW * aspect
  const active = Boolean(onChange && tool)

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPxWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = svg.current
    if (!element || !active) return

    // iPadOS Safari는 Pointer Event를 처리했어도 별도의 touch/gesture 이벤트로
    // 텍스트 선택 메뉴나 호환 click을 만들 때가 있다. 필기층에서 시작된 네이티브
    // 제스처의 기본 동작을 직접 막되 Pointer Event 자체는 위 핸들러에서 처리한다.
    const preventNativeGesture = (event: Event) => {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
    }
    const options: AddEventListenerOptions = { passive: false }
    element.addEventListener('touchstart', preventNativeGesture, options)
    element.addEventListener('touchmove', preventNativeGesture, options)
    element.addEventListener('touchend', preventNativeGesture, options)
    element.addEventListener('gesturestart', preventNativeGesture, options)
    element.addEventListener('gesturechange', preventNativeGesture, options)
    element.addEventListener('gestureend', preventNativeGesture, options)

    return () => {
      element.removeEventListener('touchstart', preventNativeGesture, options)
      element.removeEventListener('touchmove', preventNativeGesture, options)
      element.removeEventListener('touchend', preventNativeGesture, options)
      element.removeEventListener('gesturestart', preventNativeGesture, options)
      element.removeEventListener('gesturechange', preventNativeGesture, options)
      element.removeEventListener('gestureend', preventNativeGesture, options)
    }
  }, [active])

  useEffect(
    () => () => {
      if (lineHoldTimer.current !== null) window.clearTimeout(lineHoldTimer.current)
      if (drawingFrame.current !== null) window.cancelAnimationFrame(drawingFrame.current)
      if (erasingFrame.current !== null) window.cancelAnimationFrame(erasingFrame.current)
      const lock = penScrollLockRef.current
      if (lock) lock.listenerTarget.removeEventListener('scroll', lock.onScroll)
      penScrollLockRef.current = null
      suppressedTouchPointers.current.clear()
    },
    [],
  )

  function clearLineHold() {
    if (lineHoldTimer.current !== null) window.clearTimeout(lineHoldTimer.current)
    lineHoldTimer.current = null
    lineHoldAnchor.current = null
  }

  function discardActiveDrawing() {
    clearLineHold()
    snappedToLine.current = false
    drawingPointerId.current = null
    drawingPointerType.current = null
    drawingRef.current = null
    drawingPreviewRef.current = null
    gestureBoundsRef.current = null
    if (drawingFrame.current !== null) window.cancelAnimationFrame(drawingFrame.current)
    drawingFrame.current = null
    setDrawingShape(null)
    paintLiveStroke(null)
  }

  function showDrawingOnNextFrame() {
    if (drawingFrame.current !== null) return
    drawingFrame.current = window.requestAnimationFrame(() => {
      drawingFrame.current = null
      const preview = drawingPreviewRef.current
      if (preview && isPageShape(preview)) {
        paintLiveStroke(null)
        setDrawingShape(preview)
      } else {
        paintLiveStroke(preview)
      }
    })
  }

  function paintLiveStroke(mark: Stroke | null) {
    const path = liveStrokePath.current
    if (!path) return
    if (!mark) {
      path.style.display = 'none'
      path.setAttribute('d', '')
      return
    }

    const pressurePath = toPressurePenPath(mark, VIEW, height)
    path.style.display = ''
    path.setAttribute('d', pressurePath || toPath(mark.points, VIEW, height))
    path.setAttribute('opacity', String(TOOL_OPACITY[mark.tool]))
    if (pressurePath) {
      path.setAttribute('fill', mark.color)
      path.setAttribute('stroke', 'none')
    } else {
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', mark.color)
      path.setAttribute('stroke-width', String(mark.width * VIEW))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
    }
  }

  function pressureOf(event: { pressure: number; pointerType: string }): number {
    if (event.pointerType === 'mouse') return 0.5
    return Math.min(Math.max(event.pressure, 0), 1)
  }

  function showErasingOnNextFrame() {
    if (erasingFrame.current !== null) return
    erasingFrame.current = window.requestAnimationFrame(() => {
      erasingFrame.current = null
      setErasingMarks(erasingRef.current?.next ?? null)
    })
  }

  function eraseBetween(from: [number, number], to: [number, number]) {
    const gesture = erasingRef.current
    const box = gestureBoundsRef.current ?? measureBounds()
    if (!gesture || !box || box.width === 0 || box.height === 0) return
    const distance = Math.hypot((to[0] - from[0]) * box.width, (to[1] - from[1]) * box.height)
    const steps = Math.max(1, Math.ceil(distance / ERASER_SAMPLE_GAP_PX))
    let changed = false

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps
      const at: [number, number] = [
        from[0] + (to[0] - from[0]) * progress,
        from[1] + (to[1] - from[1]) * progress,
      ]
      gesture.original.forEach((mark, index) => {
        if (gesture.erased.has(index)) return
        if (markHitByEraser(mark, at, box.width, box.height)) {
          gesture.erased.add(index)
          changed = true
        }
      })
    }

    gesture.last = to
    if (!changed) return
    gesture.next = gesture.original.filter((_, index) => !gesture.erased.has(index))
    showErasingOnNextFrame()
  }

  function scheduleLineSnap(clientX: number, clientY: number) {
    const anchor = lineHoldAnchor.current
    if (
      anchor &&
      lineHoldTimer.current !== null &&
      Math.hypot(clientX - anchor.x, clientY - anchor.y) <= HOLD_SLOP_PX
    ) {
      return
    }

    if (lineHoldTimer.current !== null) window.clearTimeout(lineHoldTimer.current)
    lineHoldAnchor.current = { x: clientX, y: clientY }
    lineHoldTimer.current = window.setTimeout(() => {
      lineHoldTimer.current = null
      const latest = drawingRef.current
      if (!latest || latest.tool !== 'highlight' || latest.points.length < 4) return
      const end = latest.points.length - 2
      const straight: Stroke = {
        ...latest,
        points: [latest.points[0], latest.points[1], latest.points[end], latest.points[end + 1]],
      }
      snappedToLine.current = true
      drawingRef.current = straight
      drawingPreviewRef.current = straight
      showDrawingOnNextFrame()
    }, HOLD_TO_LINE_MS)
  }

  function measureBounds(): GestureBounds | null {
    const box = svg.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }

  function pointAtClient(clientX: number, clientY: number): [number, number] | null {
    // getBoundingClientRect()는 레이아웃 계산을 일으킬 수 있으므로 한 획을 시작할
    // 때 잰 값을 끝날 때까지 쓴다. 페이지는 획 도중 움직이지 않는다.
    const box = gestureBoundsRef.current ?? measureBounds()
    if (!box || box.width === 0) return null
    return [
      Math.min(Math.max((clientX - box.left) / box.width, 0), 1),
      Math.min(Math.max((clientY - box.top) / box.height, 0), 1),
    ]
  }

  function pointAt(event: React.PointerEvent): [number, number] | null {
    return pointAtClient(event.clientX, event.clientY)
  }

  function acceptsPointer(event: React.PointerEvent): boolean {
    return allowTouchDrawing || event.pointerType !== 'touch'
  }

  function closestScrollTarget(element: Element): HTMLElement {
    let current = element.parentElement
    while (current) {
      const overflowY = window.getComputedStyle(current).overflowY
      if (/(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight) return current
      current = current.parentElement
    }
    return (window.document.scrollingElement as HTMLElement | null) ?? window.document.documentElement
  }

  function releasePenScrollLock() {
    const lock = penScrollLockRef.current
    if (!lock) return
    lock.listenerTarget.removeEventListener('scroll', lock.onScroll)
    penScrollLockRef.current = null
  }

  /** Pencil 획이 이어지는 동안 손바닥이 닿아도 문서 위치가 움직이지 않게 고정한다. */
  function beginPenScrollLock(element: Element) {
    releasePenScrollLock()
    const target = closestScrollTarget(element)
    const listenerTarget = target === window.document.scrollingElement ? window : target
    const lock: PenScrollLock = {
      target,
      listenerTarget,
      scrollTop: target.scrollTop,
      scrollLeft: target.scrollLeft,
      onScroll: () => undefined,
    }
    lock.onScroll = () => {
      if (activePenPointerId.current === null) return
      if (lock.target.scrollTop !== lock.scrollTop) lock.target.scrollTop = lock.scrollTop
      if (lock.target.scrollLeft !== lock.scrollLeft) lock.target.scrollLeft = lock.scrollLeft
    }
    listenerTarget.addEventListener('scroll', lock.onScroll, { passive: true })
    penScrollLockRef.current = lock
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
        background: next.background,
        borderColor: next.borderColor,
        size: textSize,
        text: value,
        points: [next.x, next.y],
      })
    } else {
      const current = updated[next.index]
      if (!current || !isPageText(current)) return
      // 비우면 지운다. 글자를 없애는 가장 손에 익은 길이다.
      if (value === '') updated.splice(next.index, 1)
      else {
        updated[next.index] = {
          ...current,
          text: value,
          background: next.background,
          borderColor: next.borderColor,
          points: [next.x, next.y],
        }
      }
    }
    onChange(updated)
  }

  function start(event: React.PointerEvent) {
    if (!onChange || !tool) return
    if (event.pointerType === 'touch') {
      // Pencil과 동시에 닿거나 Pencil을 막 뗀 뒤 들어온 touch는 손바닥일 가능성이
      // 높다. 손가락 필기를 켰더라도 진행 중인 Pencil 획을 덮어쓰지 않는다.
      if (activePenPointerId.current !== null || event.timeStamp < ignoreTouchUntil.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressedTouchPointers.current.add(event.pointerId)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      activeTouchPointers.current.add(event.pointerId)
      if (activeTouchPointers.current.size > 1) {
        touchScrollRef.current = null
        if (drawingPointerType.current === 'touch') discardActiveDrawing()
        return
      }
    }

    if (event.pointerType === 'touch' && !allowTouchDrawing) {
      // 브라우저의 기본 pan을 허용하면 같은 층에 닿은 Apple Pencil도 스크롤로
      // 오인되어 pointercancel이 난다. 기본 pan은 막고 손가락만 직접 스크롤한다.
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      touchScrollRef.current = {
        pointerId: event.pointerId,
        lastY: event.clientY,
        target: closestScrollTarget(event.currentTarget),
      }
      return
    }
    if (!acceptsPointer(event)) return

    if (event.pointerType === 'pen') {
      activePenPointerId.current = event.pointerId
      ignoreTouchUntil.current = Number.POSITIVE_INFINITY
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      // 손바닥이 Pencil보다 아주 조금 먼저 닿아 스크롤로 분류됐더라도, Pencil이
      // 시작되는 순간부터는 그 터치를 완전히 막고 현재 문서 위치를 고정한다.
      if (touchScrollRef.current) {
        suppressedTouchPointers.current.add(touchScrollRef.current.pointerId)
      }
      touchScrollRef.current = null
      activeTouchPointers.current.clear()
      beginPenScrollLock(event.currentTarget)
      // 손가락 필기 직후 Pencil이 닿으면 Pencil 입력을 우선한다.
      if (drawingPointerType.current === 'touch') discardActiveDrawing()
    }
    if (drawingPointerId.current !== null) return

    gestureBoundsRef.current = measureBounds()
    const at = pointAt(event)
    if (!at) {
      gestureBoundsRef.current = null
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // 보기 모드에서 선택돼 있던 OCR 글자가 필기 시작 후 파란 선택 영역으로
    // 남아 Pencil 입력을 방해하지 않게 즉시 걷는다.
    window.getSelection()?.removeAllRanges()
    onInteract?.()
    if (tool === 'erase') {
      event.currentTarget.setPointerCapture(event.pointerId)
      erasingRef.current = {
        pointerId: event.pointerId,
        last: at,
        original: marks,
        erased: new Set(),
        next: marks,
      }
      eraseBetween(at, at)
      return
    }

    if (tool === 'text') {
      gestureBoundsRef.current = null
      // 쓰던 것이 있으면 먼저 갈무리하고 새 자리를 연다.
      if (editing) commitText()
      setEditing({
        index: null,
        value: '',
        x: at[0],
        y: at[1],
        background: DEFAULT_TEXT_BACKGROUND,
        borderColor: DEFAULT_TEXT_BORDER,
      })
      return
    }

    clearLineHold()
    snappedToLine.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    const next: Stroke | PageShape = {
      tool,
      color: color ?? STROKE_COLORS[0],
      width: strokeWidth ?? TOOL_WIDTH[tool],
      points: isShapeTool(tool) ? [at[0], at[1], at[0], at[1]] : [at[0], at[1]],
    }
    // 실제 압력을 주는 펜의 값만 저장한다. 마우스·손가락은
    // 고정값을 저장하지 않아 렌더러가 이동 속도로 굵기를 보완할 수 있다.
    if (next.tool === 'pen' && event.pointerType === 'pen') {
      next.pressures = [pressureOf(event)]
    }
    drawingRef.current = next
    drawingPreviewRef.current = next
    drawingPointerId.current = event.pointerId
    drawingPointerType.current = event.pointerType
    if (isPageShape(next)) setDrawingShape(next)
    else paintLiveStroke(next)
  }

  function move(event: React.PointerEvent) {
    if (suppressedTouchPointers.current.has(event.pointerId)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.pointerType === 'touch' && activePenPointerId.current !== null) {
      suppressedTouchPointers.current.add(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const touchScroll = touchScrollRef.current
    if (touchScroll?.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      touchScroll.target.scrollTop += touchScroll.lastY - event.clientY
      touchScroll.lastY = event.clientY
      return
    }

    const erasing = erasingRef.current
    if (erasing?.pointerId === event.pointerId) {
      event.preventDefault()
      event.stopPropagation()
      const at = pointAt(event)
      if (at) eraseBetween(erasing.last, at)
      return
    }

    const current = drawingRef.current
    if (!current || drawingPointerId.current !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const native = event.nativeEvent
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const samples = [...coalesced]
    const lastSample = samples[samples.length - 1]
    if (!lastSample || lastSample.clientX !== native.clientX || lastSample.clientY !== native.clientY) {
      samples.push(native)
    }
    const points = samples
      .map((sample) => pointAtClient(sample.clientX, sample.clientY))
      .filter((point): point is [number, number] => point !== null)
    const at = points[points.length - 1]
    if (!at) return
    let next: Stroke | PageShape
    if (isPageShape(current)) {
      next = { ...current, points: [current.points[0], current.points[1], at[0], at[1]] }
    } else if (current.tool === 'highlight' && snappedToLine.current) {
      // 곧게 편 뒤에는 다시 자유곡선이 되지 않고 끝점만 따라온다.
      next = { ...current, points: [current.points[0], current.points[1], at[0], at[1]] }
    } else {
      // 아직 저장되지 않은 이 획은 ref만 소유한다. 매 샘플마다 누적 배열 전체를
      // 복사하면 긴 획이 갈수록 느려지므로 여기서는 제자리에서 이어 붙인다.
      const appendedPressures = samples.map(pressureOf)
      current.points.push(...points.flat())
      if (current.tool === 'pen' && current.pressures) {
        const pressures = current.pressures
        pressures.push(...appendedPressures)
        current.pressures = pressures
      }
      next = current
    }
    drawingRef.current = next
    const predictedSamples =
      event.pointerType === 'pen' &&
      !isPageShape(next) &&
      !(next.tool === 'highlight' && snappedToLine.current) &&
      typeof native.getPredictedEvents === 'function'
        ? native
            .getPredictedEvents()
            .slice(0, 1)
            .filter(
              (sample) =>
                Math.hypot(sample.clientX - native.clientX, sample.clientY - native.clientY) <=
                MAX_PREDICTION_DISTANCE_PX,
            )
        : []
    const predictedPoints = predictedSamples
      .map((sample) => pointAtClient(sample.clientX, sample.clientY))
      .filter((point): point is [number, number] => point !== null)
    drawingPreviewRef.current =
      predictedPoints.length === 0 || isPageShape(next)
        ? next
        : {
            ...next,
            points: [...next.points, ...predictedPoints.flat()],
            ...(next.tool === 'pen' && next.pressures
              ? {
                  pressures: [
                    ...next.pressures,
                    ...predictedSamples.map(pressureOf),
                  ],
                }
              : {}),
          }
    showDrawingOnNextFrame()
    if (next.tool === 'highlight' && !snappedToLine.current && next.points.length >= 4) {
      scheduleLineSnap(event.clientX, event.clientY)
    }
  }

  function finish(event: React.PointerEvent, cancelled = false) {
    if (event.pointerType === 'touch') activeTouchPointers.current.delete(event.pointerId)
    if (suppressedTouchPointers.current.delete(event.pointerId)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (touchScrollRef.current?.pointerId === event.pointerId) {
      touchScrollRef.current = null
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (activePenPointerId.current === event.pointerId) {
      activePenPointerId.current = null
      ignoreTouchUntil.current = event.timeStamp + PALM_REJECTION_GRACE_MS
      releasePenScrollLock()
      event.preventDefault()
      event.stopPropagation()
    }
    if (erasingRef.current?.pointerId === event.pointerId) {
      const completed = erasingRef.current
      erasingRef.current = null
      if (erasingFrame.current !== null) window.cancelAnimationFrame(erasingFrame.current)
      erasingFrame.current = null
      gestureBoundsRef.current = null
      setErasingMarks(null)
      if (completed.erased.size > 0) onChange?.(completed.next)
      return
    }
    if (drawingPointerId.current !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const completed = drawingRef.current
    if (!completed) {
      discardActiveDrawing()
      return
    }
    // 마지막 pointermove 다음에 손을 빠르게 떼면 pointerup 좌표가
    // 저장되지 않아 획 끝이 짧게 끊겼다. 놓은 지점을 한 번 더 반영한다.
    const wasSnappedToLine = snappedToLine.current
    const releasedAt = !cancelled ? pointAt(event) : null
    if (releasedAt) {
      if (isPageShape(completed)) {
        completed.points[2] = releasedAt[0]
        completed.points[3] = releasedAt[1]
      } else if (completed.tool === 'highlight' && wasSnappedToLine) {
        completed.points[completed.points.length - 2] = releasedAt[0]
        completed.points[completed.points.length - 1] = releasedAt[1]
      } else {
        const last = completed.points.length - 2
        const distance = Math.hypot(
          releasedAt[0] - completed.points[last],
          releasedAt[1] - completed.points[last + 1],
        )
        if (distance > 0.0002) {
          completed.points.push(...releasedAt)
          if (completed.pressures) completed.pressures.push(pressureOf(event))
        }
      }
    }
    clearLineHold()
    snappedToLine.current = false
    drawingPointerId.current = null
    drawingPointerType.current = null
    drawingRef.current = null
    drawingPreviewRef.current = null
    gestureBoundsRef.current = null
    if (drawingFrame.current !== null) window.cancelAnimationFrame(drawingFrame.current)
    drawingFrame.current = null
    setDrawingShape(null)
    paintLiveStroke(null)
    // 시스템 제스처나 화면 회전으로 즉시 취소된 짧은 자국은 저장하지 않는다.
    if (cancelled && !isPageShape(completed) && completed.points.length < 4) return
    if (isPageShape(completed)) {
      const width = Math.abs(completed.points[2] - completed.points[0])
      const height = Math.abs(completed.points[3] - completed.points[1])
      // 손가락을 거의 움직이지 않은 실수는 보이지 않는 도형으로 남기지 않는다.
      if (width < 0.005 || height < 0.005) return
      onChange?.([...marks, completed])
      return
    }
    // 화면에 보이는 모양은 그대로면서 점 수만 줄여 본문을 가볍게 둔다.
    onChange?.([...marks, simplifyStroke(completed)])
  }

  /** 이미 얹은 글자를 누르면 옮기거나(끌면) 고친다(그냥 놓으면). */
  function grabText(event: React.PointerEvent<SVGGElement>, index: number) {
    if (!onChange || !acceptsPointer(event)) return
    event.stopPropagation()
    onInteract?.()
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
        setEditing({
          index,
          value: mark.text,
          x: at[0],
          y: at[1],
          background: mark.background,
          borderColor: mark.borderColor,
        })
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

  const visibleMarks = erasingMarks ?? marks
  const savedStrokePaths = useMemo(
    () =>
      visibleMarks.flatMap((mark, index) => {
        if (isPageText(mark) || isPageShape(mark)) return []
        return [
          <StrokeMarkPath
            key={index}
            mark={mark}
            scaleX={VIEW}
            scaleY={height}
            erase={false}
          />,
        ]
      }),
    [height, visibleMarks],
  )
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
          active ? 'lecture-page-annotation-layer cursor-crosshair' : 'pointer-events-none',
          className,
        )}
        // 필기 중 브라우저 제스처가 Pencil 포인터를 취소하지 않게 한다. 손가락
        // 스크롤은 위의 전용 처리로 유지한다.
        style={{ touchAction: active ? 'none' : undefined }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onContextMenu={active ? (event) => event.preventDefault() : undefined}
      >
        {savedStrokePaths}
        {visibleMarks.map((mark, index) => {
          const grabbable = Boolean(onChange) && tool === 'text'
          if (isPageText(mark)) {
            const size = (mark.size / NOMINAL_PT_WIDTH) * VIEW
            const at = dragging?.index === index ? dragging.at : mark.points
            return (
              <PageTextShape
                key={index}
                mark={mark}
                x={at[0] * VIEW}
                y={at[1] * height}
                size={size}
                hidden={editing?.index === index}
                grabbable={grabbable}
                erase={false}
                onPointerDown={grabbable ? (event) => grabText(event, index) : undefined}
              />
            )
          }
          if (isPageShape(mark)) {
            return (
              <PageShapeShape
                key={index}
                mark={mark}
                scaleX={VIEW}
                scaleY={height}
                erase={false}
              />
            )
          }
          return null
        })}
        {drawingShape && (
          <PageShapeShape
            mark={drawingShape}
            scaleX={VIEW}
            scaleY={height}
            erase={false}
          />
        )}
        <path ref={liveStrokePath} style={{ display: 'none', pointerEvents: 'none' }} />
      </svg>

      {editing && onChange && (
        <div
          data-text-editor=""
          onBlur={(event) => {
            const moved = event.relatedTarget
            if (moved instanceof HTMLElement && event.currentTarget.contains(moved)) return
            if (moved instanceof HTMLElement && moved.closest('[data-page-tools]')) return
            commitText()
          }}
          style={{
            left: `${editing.x * 100}%`,
            top: `${editing.y * 100}%`,
            maxWidth: `${Math.max(100 - editing.x * 100, 20)}%`,
          }}
          className="absolute z-10 w-44"
        >
          <input
            autoFocus
            value={editing.value}
            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitText()
              if (event.key === 'Escape') setEditing(null)
            }}
            placeholder="글자 입력"
            style={{
              color: editStyle.color,
              fontSize:
                pxWidth > 0 ? (editStyle.size / NOMINAL_PT_WIDTH) * pxWidth : editStyle.size,
              backgroundColor: editing.background,
              borderColor: editing.borderColor,
            }}
            className="w-full rounded border px-1 font-semibold leading-tight outline-none ring-1 ring-brand-500/70"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md bg-slate-900/90 p-1 text-[10px] text-white shadow-lg">
            <select
              value={editing.background}
              onChange={(event) => setEditing({ ...editing, background: event.target.value })}
              aria-label="글자 배경색"
              className="min-w-0 flex-1 rounded bg-white/15 px-1 py-0.5 outline-none"
            >
              {TEXT_BOX_BACKGROUNDS.map((item) => (
                <option key={item.value} value={item.value} className="text-slate-900">
                  {item.label}
                </option>
              ))}
            </select>
            <select
              value={editing.borderColor}
              onChange={(event) => setEditing({ ...editing, borderColor: event.target.value })}
              aria-label="글자 테두리색"
              className="min-w-0 flex-1 rounded bg-white/15 px-1 py-0.5 outline-none"
            >
              {TEXT_BOX_BORDERS.map((item) => (
                <option key={item.value} value={item.value} className="text-slate-900">
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitText()}
              className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-900"
            >
              적용
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const progress = Math.min(Math.max(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0), 1)
  return Math.hypot(px - (x1 + progress * dx), py - (y1 + progress * dy))
}

function markHitByEraser(
  mark: PageMark,
  at: [number, number],
  scaleX: number,
  scaleY: number,
): boolean {
  const px = at[0] * scaleX
  const py = at[1] * scaleY

  if (isPageText(mark)) {
    return Math.hypot(px - mark.points[0] * scaleX, py - mark.points[1] * scaleY) <= ERASER_RADIUS_PX * 1.4
  }

  if (isPageShape(mark)) {
    const x1 = mark.points[0] * scaleX
    const y1 = mark.points[1] * scaleY
    const x2 = mark.points[2] * scaleX
    const y2 = mark.points[3] * scaleY
    const left = Math.min(x1, x2)
    const right = Math.max(x1, x2)
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    const threshold = ERASER_RADIUS_PX + (mark.width * scaleX) / 2
    return (
      pointToSegmentDistance(px, py, left, top, right, top) <= threshold ||
      pointToSegmentDistance(px, py, right, top, right, bottom) <= threshold ||
      pointToSegmentDistance(px, py, right, bottom, left, bottom) <= threshold ||
      pointToSegmentDistance(px, py, left, bottom, left, top) <= threshold
    )
  }

  const pressureExpansion = mark.tool === 'pen' && mark.pressures ? 1.45 : 1
  const threshold = ERASER_RADIUS_PX + (mark.width * scaleX * pressureExpansion) / 2
  if (mark.points.length === 2) {
    return Math.hypot(px - mark.points[0] * scaleX, py - mark.points[1] * scaleY) <= threshold
  }
  for (let index = 2; index < mark.points.length; index += 2) {
    if (
      pointToSegmentDistance(
        px,
        py,
        mark.points[index - 2] * scaleX,
        mark.points[index - 1] * scaleY,
        mark.points[index] * scaleX,
        mark.points[index + 1] * scaleY,
      ) <= threshold
    ) {
      return true
    }
  }
  return false
}

function isShapeTool(tool: MarkTool): tool is 'rectangle' | 'star' {
  return tool === 'rectangle' || tool === 'star'
}

function StrokeMarkPath({
  mark,
  scaleX,
  scaleY,
  erase,
  onErase,
}: {
  mark: Stroke
  scaleX: number
  scaleY: number
  erase: boolean
  onErase?: (event: React.PointerEvent<SVGPathElement>) => void
}) {
  const pressurePath = toPressurePenPath(mark, scaleX, scaleY)
  if (pressurePath) {
    return (
      <path
        d={pressurePath}
        fill={mark.color}
        fillOpacity={TOOL_OPACITY[mark.tool]}
        className={erase ? 'cursor-pointer' : ''}
        style={{ pointerEvents: erase ? 'fill' : 'none' }}
        onPointerDown={erase ? onErase : undefined}
      />
    )
  }
  return (
    <path
      d={toPath(mark.points, scaleX, scaleY)}
      fill="none"
      stroke={mark.color}
      strokeWidth={mark.width * scaleX}
      strokeOpacity={TOOL_OPACITY[mark.tool]}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={erase ? 'cursor-pointer' : ''}
      style={{ pointerEvents: erase ? 'stroke' : 'none' }}
      onPointerDown={erase ? onErase : undefined}
    />
  )
}

function PageShapeShape({
  mark,
  scaleX,
  scaleY,
  erase,
  onErase,
}: {
  mark: PageShape
  scaleX: number
  scaleY: number
  erase: boolean
  onErase?: (event: React.PointerEvent<SVGElement>) => void
}) {
  const left = Math.min(mark.points[0], mark.points[2]) * scaleX
  const top = Math.min(mark.points[1], mark.points[3]) * scaleY
  const width = Math.abs(mark.points[2] - mark.points[0]) * scaleX
  const height = Math.abs(mark.points[3] - mark.points[1]) * scaleY
  const common = {
    fill: 'none',
    stroke: mark.color,
    strokeWidth: mark.width * scaleX,
    strokeOpacity: TOOL_OPACITY[mark.tool],
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: erase ? 'cursor-pointer' : '',
    style: { pointerEvents: erase ? 'stroke' as const : 'none' as const },
    onPointerDown: erase
      ? (event: React.PointerEvent<SVGElement>) => {
          onErase?.(event)
        }
      : undefined,
  }

  return mark.tool === 'rectangle' ? (
    <rect x={left} y={top} width={width} height={height} rx={4} {...common} />
  ) : (
    <path d={starPath(left, top, width, height)} {...common} />
  )
}

function starPath(left: number, top: number, width: number, height: number): string {
  const centerX = left + width / 2
  const centerY = top + height / 2
  const points: string[] = []
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const radius = index % 2 === 0 ? 1 : 0.42
    const x = centerX + Math.cos(angle) * (width / 2) * radius
    const y = centerY + Math.sin(angle) * (height / 2) * radius
    points.push(`${index === 0 ? 'M' : 'L'} ${x} ${y}`)
  }
  return `${points.join(' ')} Z`
}

/** SVG 글자 크기를 잰 뒤 그 뒤에 꼭 맞는 배경과 테두리를 그린다. */
function PageTextShape({
  mark,
  x,
  y,
  size,
  hidden,
  grabbable,
  erase,
  onPointerDown,
}: {
  mark: PageText
  x: number
  y: number
  size: number
  hidden: boolean
  grabbable: boolean
  erase: boolean
  onPointerDown?: (event: React.PointerEvent<SVGGElement>) => void
}) {
  const text = useRef<SVGTextElement | null>(null)
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    if (!text.current) return
    const measured = text.current.getBBox()
    setBox({ x: measured.x, y: measured.y, width: measured.width, height: measured.height })
  }, [mark.text, size, x, y])

  const paddingX = size * 0.32
  const paddingY = size * 0.18
  const hasBackground = mark.background !== 'transparent'
  const hasBorder = mark.borderColor !== 'transparent'

  return (
    <g
      className={cn(hidden && 'opacity-0', grabbable && (erase ? 'cursor-pointer' : 'cursor-move'))}
      style={{ pointerEvents: grabbable ? 'auto' : 'none', userSelect: 'none' }}
      onPointerDown={onPointerDown}
    >
      {box && (hasBackground || hasBorder) && (
        <rect
          x={box.x - paddingX}
          y={box.y - paddingY}
          width={box.width + paddingX * 2}
          height={box.height + paddingY * 2}
          rx={size * 0.2}
          fill={hasBackground ? mark.background : 'none'}
          stroke={hasBorder ? mark.borderColor : 'none'}
          strokeWidth={hasBorder ? Math.max(size * 0.08, 1.5) : 0}
        />
      )}
      <text
        ref={text}
        x={x}
        y={y}
        fill={mark.color}
        fontSize={size}
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontWeight={600}
        dominantBaseline="hanging"
        // 상자가 없을 때만 얇은 흰 테를 둘러 어두운 강의록에서도 읽히게 한다.
        stroke={hasBackground ? 'none' : '#ffffff'}
        strokeWidth={hasBackground ? 0 : size * 0.16}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {mark.text}
      </text>
    </g>
  )
}
