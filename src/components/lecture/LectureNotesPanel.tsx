import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { includesLectureSearchTerms, splitLectureSearchText } from '@/lib/lectureSearch'
import type { LectureStudentNote } from '@/lib/queries/lectures'

type Props = {
  notes: LectureStudentNote[]
  initialQuery?: string
  activeNoteId?: string | null
}

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

function markdownComponents(query: string): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mb-3 mt-6 text-xl font-bold leading-snug first:mt-0">
        {markedChildren(children, query)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-6 border-b border-slate-200 pb-1 text-lg font-bold dark:border-slate-700">
        {markedChildren(children, query)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-4 text-base font-semibold">
        {markedChildren(children, query)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-3 text-sm font-semibold">{markedChildren(children, query)}</h4>
    ),
    p: ({ children }) => (
      <p className="my-2 text-sm leading-7 text-slate-700 dark:text-slate-200">
        {markedChildren(children, query)}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 text-sm leading-7">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-sm leading-7">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="pl-0.5 text-slate-700 marker:text-slate-400 dark:text-slate-200">
        {markedChildren(children, query)}
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-bold text-slate-950 dark:text-white">
        {markedChildren(children, query)}
      </strong>
    ),
    em: ({ children }) => <em>{markedChildren(children, query)}</em>,
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
      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-rose-700 dark:bg-slate-800 dark:text-rose-300">
        {markedChildren(children, query)}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-100">
        {children}
      </pre>
    ),
    hr: () => <hr className="my-6 border-slate-200 dark:border-slate-700" />,
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

/** 메디프렙 권한자에게만 부모 페이지가 마운트하는 학생 정리본 패널. */
export function LectureNotesPanel({ notes, initialQuery = '', activeNoteId }: Props) {
  const [searchInput, setSearchInput] = useState(initialQuery)
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
  const components = useMemo(() => markdownComponents(query), [query])

  useEffect(() => {
    if (!activeNoteId) return
    const timer = window.setTimeout(() => {
      noteNodes.current.get(activeNoteId)?.scrollIntoView({ block: 'start' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeNoteId, notes])

  return (
    <div className="min-w-0">
      <div className="sticky top-[6.75rem] z-10 mb-3 rounded-xl border border-emerald-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-emerald-900 dark:bg-slate-900/95 xl:top-0">
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
            2026 학생 정리본
          </h2>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            메디프렙
          </span>
          <span className="ml-auto text-xs text-slate-400">
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
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            이 정리본에서 검색어를 찾지 못했습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((note) => {
            const meta = [note.sourceCourse, dateLabel(note.lectureDate)].filter(Boolean)
            return (
              <article
                key={note.id}
                ref={(node) => {
                  if (node) noteNodes.current.set(note.id, node)
                  else noteNodes.current.delete(note.id)
                }}
                className={`scroll-mt-32 rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900 xl:scroll-mt-3 ${
                  note.id === activeNoteId
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
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {note.contentMd}
                </ReactMarkdown>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
