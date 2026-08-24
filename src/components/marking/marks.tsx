import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

// =============================================================================
// 형광펜 및 글자 강조 렌더링
//
// 문제 본문(stem_blocks)과 풀이(Tiptap JSON)는 자료 구조가 완전히 다르지만,
// 표시를 입히는 규칙은 같아야 한다. 그래서 "텍스트 한 조각 + 그 조각의 시작
// 위치 + 표시 목록" 을 받아 잘라 그리는 부분만 여기에 모아둔다.
//
// 각 조각은 data-pos 로 시작 위치를 달고 나간다. 드래그로 선택한 영역을 다시
// 숫자 위치로 되돌릴 때 이 값을 기준점으로 쓴다.
// =============================================================================

export type MarkStyle = 'yellow' | 'green' | 'sky' | 'pink' | 'red' | 'bold'

/** 화면에 그릴 표시 하나. 인라인 코멘트도 같은 통로로 그린다. */
export type RenderMark = {
  id: string
  from: number
  to: number
  style: MarkStyle | 'comment'
  /** 인라인 코멘트가 해결 처리된 경우 흐리게 */
  resolved?: boolean
}

/**
 * 배경색은 반드시 한 벌만 내보낸다.
 * bg-transparent 같은 기본값을 함께 붙이면 Tailwind 는 클래스를 쓴 순서가 아니라
 * 스타일시트에 정의된 순서로 승자를 정하기 때문에 형광색이 먹지 않는다.
 */
const BACKGROUND_CLASS: Record<string, string> = {
  yellow: 'bg-amber-200 dark:bg-amber-400/40',
  green: 'bg-emerald-200 dark:bg-emerald-400/40',
  sky: 'bg-sky-200 dark:bg-sky-400/40',
  pink: 'bg-pink-200 dark:bg-pink-400/40',
  comment: 'bg-amber-100 dark:bg-amber-500/30',
}

const RESOLVED_CLASS = 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'

export const HIGHLIGHT_STYLES: MarkStyle[] = ['yellow', 'green', 'sky', 'pink']

/** 배경을 칠하는 표시인지 (빨간 글씨, 굵게는 배경을 건드리지 않는다) */
function isBackgroundStyle(style: MarkStyle | 'comment'): boolean {
  return style !== 'red' && style !== 'bold'
}

type Segment = { from: number; to: number; marks: RenderMark[] }

/**
 * 텍스트 한 조각을 표시 경계로 잘라낸다.
 * 표시끼리 겹칠 수 있으므로 조각마다 걸린 표시를 모두 들고 간다.
 * (배경색과 글자색, 굵기는 함께 적용될 수 있다.)
 */
export function splitByMarks(start: number, end: number, marks: RenderMark[]): Segment[] {
  if (end <= start) return []

  const overlapping = marks.filter((mark) => mark.from < end && mark.to > start)
  if (overlapping.length === 0) return [{ from: start, to: end, marks: [] }]

  const points = new Set<number>([start, end])
  for (const mark of overlapping) {
    if (mark.from > start && mark.from < end) points.add(mark.from)
    if (mark.to > start && mark.to < end) points.add(mark.to)
  }

  const sorted = [...points].sort((a, b) => a - b)
  const segments: Segment[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index]
    const to = sorted[index + 1]
    segments.push({
      from,
      to,
      marks: overlapping.filter((mark) => mark.from <= from && mark.to >= to),
    })
  }
  return segments
}

/**
 * 표시가 입혀진 텍스트를 그린다.
 * onMarkClick 이 있으면 표시된 부분을 눌러 코멘트로 이동하거나 지울 수 있다.
 */
export function renderMarkedText(
  text: string,
  start: number,
  marks: RenderMark[],
  options?: {
    activeMarkId?: string | null
    onMarkClick?: (id: string) => void
    /** 검색어 강조처럼 표시 안쪽의 글자를 한 번 더 꾸밀 때 사용한다. */
    renderText?: (text: string) => ReactNode
  },
): ReactNode[] {
  return splitByMarks(start, start + text.length, marks).map((segment) => {
    const slice = text.slice(segment.from - start, segment.to - start)
    const key = segment.from

    if (segment.marks.length === 0) {
      return (
        <span key={key} data-pos={segment.from}>
          {slice}
        </span>
      )
    }

    const active = segment.marks.some((mark) => mark.id === options?.activeMarkId)

    // 겹친 표시 중 배경은 마지막 것, 글자색과 굵기는 있으면 적용한다.
    const background = segment.marks.filter((mark) => isBackgroundStyle(mark.style)).at(-1)
    const hasRed = segment.marks.some((mark) => mark.style === 'red')
    const hasBold = segment.marks.some((mark) => mark.style === 'bold')

    // 표시된 구간을 누르면 첫 번째 표시를 대상으로 삼는다.
    const target = segment.marks[0]
    const content = options?.renderText ? options.renderText(slice) : slice

    // mark 요소는 브라우저 기본 배경(노랑)이 있어 span 으로 그린다.
    return (
      <span
        key={key}
        data-pos={segment.from}
        onClick={options?.onMarkClick ? () => options.onMarkClick?.(target.id) : undefined}
        className={cn(
          'rounded-sm',
          background?.resolved
            ? RESOLVED_CLASS
            : background && BACKGROUND_CLASS[background.style],
          hasRed && 'text-marker-red',
          hasBold && 'font-bold',
          active && 'ring-2 ring-brand-400',
          options?.onMarkClick && 'cursor-pointer',
        )}
      >
        {content}
      </span>
    )
  })
}

// -----------------------------------------------------------------------------
// 드래그 선택 → 숫자 위치
// -----------------------------------------------------------------------------

export type SelectionRange = { from: number; to: number; text: string }

/**
 * 영역 안에서 드래그한 부분을 위치 숫자로 되돌린다.
 * 각 텍스트 조각에 남겨둔 data-pos 를 기준점으로 삼는다.
 */
export function readSelectionRange(container: HTMLElement): SelectionRange | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const from = positionOf(range.startContainer, range.startOffset)
  const to = positionOf(range.endContainer, range.endOffset)
  if (from === null || to === null || from >= to) return null

  const text = selection.toString().trim()
  if (text === '') return null

  return { from, to, text }
}

function positionOf(node: Node, offset: number): number | null {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  const holder = element?.closest('[data-pos]')
  if (!holder) return null

  const base = Number(holder.getAttribute('data-pos'))
  if (!Number.isFinite(base)) return null

  const within = charactersBefore(holder, node, offset)
  return within === null ? null : base + within
}

/**
 * holder 안에서 (node, offset) 지점 앞에 놓인 글자 수.
 *
 * 선택 끝점은 텍스트 노드가 아니라 요소 경계에 걸릴 수 있다. 더블클릭으로 단어를
 * 고르거나 모바일에서 문단째 선택하면 그렇게 된다. 그 경우 offset 은 글자 수가
 * 아니라 자식 번호라서 그대로 더하면 엉뚱한 위치가 나온다.
 * Range 로 실제 문자열 길이를 재면 두 경우를 한 번에 처리할 수 있다.
 */
function charactersBefore(holder: Element, node: Node, offset: number): number | null {
  try {
    const probe = document.createRange()
    probe.selectNodeContents(holder)
    probe.setEnd(node, offset)
    return probe.toString().length
  } catch {
    // node 가 holder 밖에 있는 등 범위를 만들 수 없는 경우
    return null
  }
}
