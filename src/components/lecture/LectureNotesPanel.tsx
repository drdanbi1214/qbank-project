import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkableRegion } from '@/components/marking/MarkableRegion'
import { renderMarkedText, type RenderMark } from '@/components/marking/marks'
import { useTextMarks } from '@/components/marking/useTextMarks'
import { includesLectureSearchTerms, splitLectureSearchText } from '@/lib/lectureSearch'
import type { LectureStudentNote } from '@/lib/queries/lectures'

type Props = {
  notes: LectureStudentNote[]
  initialQuery?: string
  activeNoteId?: string | null
}

const TIMELINE_VISIBILITY_STORAGE_KEY = 'lecture-notes-hide-timelines'
const TIMELINE_PATTERN = /[ \t]*\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g

function HighlightedText({ text, query }: { text: string; query: string }) {
  return splitLectureSearchText(text, query).map((part, index) =>
    part.hit ? (
      <mark
        key={index}
        className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/40"
      >
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}

/** ReactMarkdown이 만든 각 태그의 직접 텍스트만 안전하게 잘라 검색어를 칠한다. */
function markedChildren(children: ReactNode, query: string) {
  return Children.map(children, (child) =>
    typeof child === 'string' ? <HighlightedText text={child} query={query} /> : child,
  )
}

/** AI 정리본 제목의 반복 안내 문구는 감추고 실제 주제만 보여 준다. */
function displayMarkdown(markdown: string): string {
  return markdown
    .replace(
      /^(#{1,6}\s+)(?:📝\s*)?시험\s*대비\s*요점\s*정리\s*[:：]\s*/gmu,
      '$1',
    )
    // 닫는 ** 바로 뒤에 한글 조사가 오면 CommonMark가 굵게로 해석하지 않는다.
    // 보이지 않는 구분 문자를 넣어 원본 문구는 유지하면서 정상 렌더링한다.
    .replace(/\*\*([^*\n]+?)\*\*(?=[가-힣])/gu, '**$1**&ZeroWidthSpace;')
    // GFM 취소선도 바로 뒤에 한글 조사가 붙으면 닫는 ~~를 놓칠 수 있다.
    .replace(/~~([^~\n]+?)~~(?=[가-힣])/gu, '~~$1~~&ZeroWidthSpace;')
}

function initialTimelineVisibility(): boolean {
  if (typeof window === 'undefined') return true
  const stored = window.localStorage.getItem(TIMELINE_VISIBILITY_STORAGE_KEY)
  return stored === null ? true : stored === 'true'
}

function renderNoteText(
  text: string,
  start: number,
  marks: RenderMark[],
  query: string,
  hideTimelines: boolean,
): ReactNode[] {
  const result: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(TIMELINE_PATTERN)) {
    const matchAt = match.index ?? 0
    if (matchAt > cursor) {
      const visible = text.slice(cursor, matchAt)
      result.push(
        ...renderMarkedText(visible, start + cursor, marks, {
          renderText: (value) => <HighlightedText text={value} query={query} />,
        }),
      )
    }

    const timeline = match[0]
    if (hideTimelines) {
      // DOM에는 남겨 개인 표시의 문자 위치를 고정하고 시각적으로만 감춘다.
      result.push(
        <span key={`timeline-${start + matchAt}`} data-pos={start + matchAt} className="hidden">
          {timeline}
        </span>,
      )
    } else {
      result.push(
        ...renderMarkedText(timeline, start + matchAt, marks, {
          renderText: (value) => <HighlightedText text={value} query={query} />,
        }),
      )
    }
    cursor = matchAt + timeline.length
  }

  if (cursor < text.length) {
    result.push(
      ...renderMarkedText(text.slice(cursor), start + cursor, marks, {
        renderText: (value) => <HighlightedText text={value} query={query} />,
      }),
    )
  }
  return result
}

type HastNode = {
  type: string
  value?: unknown
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/** Markdown의 모든 텍스트 조각에 문서 전체 기준 문자 위치를 붙인다. */
function rehypeMarkPositions() {
  return (tree: unknown) => {
    let position = 0

    const visit = (node: HastNode) => {
      if (!Array.isArray(node.children)) return
      node.children = node.children.map((child) => {
        if (child.type === 'text' && typeof child.value === 'string') {
          const start = position
          position += child.value.length
          return {
            type: 'element',
            tagName: 'span',
            properties: { dataMarkPos: start },
            children: [child],
          }
        }
        visit(child)
        return child
      })
    }

    visit(tree as HastNode)
  }
}

function markdownComponents(
  query: string,
  marks: RenderMark[],
  hideTimelines: boolean,
): Components {
  return {
    span: ({ children, node }) => {
      if (typeof children !== 'string') return <span>{children}</span>
      const start = Number(node?.properties.dataMarkPos)
      if (!Number.isFinite(start)) {
        return <span>{markedChildren(children, query)}</span>
      }
      return (
        <>{renderNoteText(children, start, marks, query, hideTimelines)}</>
      )
    },
    h1: ({ children }) => (
      <h1 className="mb-4 mt-8 text-xl font-bold leading-snug first:mt-0">
        {markedChildren(children, query)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-3 mt-8 border-b border-slate-200 pb-1.5 text-lg font-bold dark:border-slate-700">
        {markedChildren(children, query)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-6 text-base font-semibold">
        {markedChildren(children, query)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1.5 mt-5 text-sm font-semibold">
        {markedChildren(children, query)}
      </h4>
    ),
    p: ({ children }) => (
      <p className="my-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {markedChildren(children, query)}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-6">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-6">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="pl-0.5 text-slate-700 marker:text-slate-400 dark:text-slate-200">
        {markedChildren(children, query)}
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-bold text-blue-700 dark:text-blue-300">
        {markedChildren(children, query)}
      </strong>
    ),
    em: ({ children }) => <em>{markedChildren(children, query)}</em>,
    del: ({ children }) => (
      <del className="text-slate-500 line-through decoration-slate-500 decoration-1 dark:text-slate-400 dark:decoration-slate-400">
        {markedChildren(children, query)}
      </del>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-brand-300 bg-brand-50/60 py-1 pl-3 text-sm dark:border-brand-700 dark:bg-brand-950/20">
        {children}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-brand-700 underline decoration-brand-300 underline-offset-2 dark:text-brand-300"
      >
        {markedChildren(children, query)}
      </a>
    ),
    code: ({ children }) => (
      <code className="font-sans text-inherit">
        {markedChildren(children, query)}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-4 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-100 [&_code]:font-mono [&_code]:font-normal [&_code]:text-inherit">
        {children}
      </pre>
    ),
    hr: () => <hr className="my-8 border-slate-200 dark:border-slate-700" />,
    table: ({ children }) => (
      <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-slate-100 dark:bg-slate-800">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border-b border-r border-slate-200 px-2.5 py-2 font-semibold last:border-r-0 dark:border-slate-700">
        {markedChildren(children, query)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-r border-slate-100 px-2.5 py-2 align-top leading-5 last:border-r-0 dark:border-slate-800">
        {markedChildren(children, query)}
      </td>
    ),
  }
}

function dateLabel(value: string | null): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-')
  return year && month && day ? `${year}.${month}.${day}` : value
}

function MarkedLectureNote({
  note,
  query,
  active,
  hideTimelines,
  setNode,
}: {
  note: LectureStudentNote
  query: string
  active: boolean
  hideTimelines: boolean
  setNode: (node: HTMLElement | null) => void
}) {
  const textMarks = useTextMarks('lecture_note', note.id)
  const components = markdownComponents(query, textMarks.marks, hideTimelines)
  const markdown = useMemo(() => displayMarkdown(note.contentMd), [note.contentMd])
  const meta = [note.sourceCourse, dateLabel(note.lectureDate)].filter(Boolean)

  return (
    <article
      ref={setNode}
      className={`scroll-mt-32 rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900 lg:scroll-mt-3 ${
        active
          ? 'border-emerald-400 ring-2 ring-emerald-200 dark:border-emerald-600 dark:ring-emerald-900'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <header className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
        <p className="text-xs text-slate-400">{meta.join(' · ') || note.sourceKey}</p>
        <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {note.sourceKey}
        </p>
      </header>
      <MarkableRegion onApply={textMarks.apply} onErase={textMarks.erase}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeMarkPositions]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </MarkableRegion>
    </article>
  )
}

/** 요약정리노트 권한자에게만 부모 페이지가 마운트하는 학생 정리본 패널. */
export function LectureNotesPanel({ notes, initialQuery = '', activeNoteId }: Props) {
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [hideTimelines, setHideTimelines] = useState(initialTimelineVisibility)
  const noteNodes = useRef(new Map<string, HTMLElement>())

  const query = searchInput.trim()
  const visible = useMemo(
    () =>
      query === ''
        ? notes
        : notes.filter((note) =>
            includesLectureSearchTerms(`${note.title}\n${note.contentText}`, query),
          ),
    [notes, query],
  )
  useEffect(() => {
    if (!activeNoteId) return
    const timer = window.setTimeout(() => {
      noteNodes.current.get(activeNoteId)?.scrollIntoView({ block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeNoteId, notes])

  return (
    <div className="min-w-0">
      <div className="sticky top-[6.75rem] z-10 mb-3 rounded-xl border border-emerald-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-emerald-900 dark:bg-slate-900/95 lg:top-0">
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
            2026 학생 정리본
          </h2>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            요약정리본
          </span>
          <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={hideTimelines}
              onChange={(event) => {
                const next = event.target.checked
                setHideTimelines(next)
                window.localStorage.setItem(TIMELINE_VISIBILITY_STORAGE_KEY, String(next))
              }}
              className="h-3.5 w-3.5 accent-emerald-600"
            />
            타임라인 숨기기
          </label>
          <span className="text-xs text-slate-400">
            {query ? `${visible.length}/${notes.length}개` : `${notes.length}개`}
          </span>
        </div>
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="정리본 안에서 찾기"
          aria-label="정리본 안에서 찾기"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-slate-600 dark:bg-slate-800 dark:focus:ring-emerald-950"
        />
        <p className="mt-1.5 px-1 text-[11px] text-slate-400 dark:text-slate-500">
          본문을 드래그하면 개인 형광펜·빨간 글씨·굵은 글씨를 표시할 수 있습니다.
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            이 정리본에서 검색어를 찾지 못했습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((note) => (
            <MarkedLectureNote
              key={note.id}
              note={note}
              query={query}
              active={note.id === activeNoteId}
              hideTimelines={hideTimelines}
              setNode={(node) => {
                  if (node) noteNodes.current.set(note.id, node)
                  else noteNodes.current.delete(note.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
