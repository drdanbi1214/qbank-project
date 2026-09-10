import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { cn } from '@/utils/cn'

export type SlashCommand = {
  id: string
  /** 슬래시 뒤에 입력해 후보를 좁히는 명령 이름 */
  label: string
  aliases?: string[]
  /** false면 슬래시 메뉴에는 숨기고 완성된 일반 단어로만 부른다. */
  slash?: boolean
  /** 공백 뒤에서 label을 그대로 입력했을 때도 후보를 띄운다. */
  plain?: boolean
  /** 버튼에는 명령 이름 대신 결과 기호를 바로 보여 줄 수 있다. */
  displayLabel?: string
  className: string
  run: () => void
}

export type SlashCommandKeyHandler = (view: EditorView, event: KeyboardEvent) => boolean

type MenuState = {
  from: number
  to: number
  query: string
  kind: 'slash' | 'plain'
  left: number
  top: number
}

type Props = {
  editor: Editor | null
  commands: SlashCommand[]
  keyHandlerRef: MutableRefObject<SlashCommandKeyHandler>
}

/**
 * 커서 바로 아래에 뜨는 작은 삽입 메뉴.
 *
 * 문단 시작 또는 공백 뒤의 `/`만 명령으로 취급해 URL은 건드리지 않는다.
 * 현재 화면에서 툴바 버튼이 제공되는 명령만 후보에 넣는다.
 */
export function SlashCommandMenu({ editor, commands, keyHandlerRef }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedIndexRef = useRef(selectedIndex)
  const dismissedRef = useRef<string | null>(null)
  const lastSignatureRef = useRef<string | null>(null)

  const matchingCommands = menu ? matchingCommandsFor(commands, menu) : []

  const selectIndex = useCallback((index: number) => {
    selectedIndexRef.current = index
    setSelectedIndex(index)
  }, [])

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed || !editor.isFocused) {
      lastSignatureRef.current = null
      setMenu(null)
      return
    }

    const match = findCommand(editor, commands)
    if (!match) {
      dismissedRef.current = null
      lastSignatureRef.current = null
      setMenu(null)
      return
    }

    const matches = matchingCommandsFor(commands, match)
    if (matches.length === 0) {
      lastSignatureRef.current = null
      setMenu(null)
      return
    }

    const signature = `${match.from}:${match.to}:${match.query}`
    if (dismissedRef.current === signature) {
      setMenu(null)
      return
    }
    dismissedRef.current = null

    if (lastSignatureRef.current !== signature) {
      lastSignatureRef.current = signature
      selectIndex(0)
    }

    const caret = editor.view.coordsAtPos(match.to)
    const left = Math.max(8, Math.min(caret.left, window.innerWidth - 220))
    const top = Math.min(caret.bottom + 6, window.innerHeight - 56)

    setMenu({ ...match, left, top })
  }, [commands, editor, selectIndex])

  const execute = useCallback((command: SlashCommand, current: Pick<MenuState, 'from' | 'to'>) => {
    if (!editor || !current) return

    setMenu(null)
    dismissedRef.current = null
    editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run()
    command.run()
  }, [editor])

  useEffect(() => {
    if (!editor) return

    editor.on('transaction', refresh)
    editor.on('selectionUpdate', refresh)
    editor.on('focus', refresh)
    const hide = () => setMenu(null)
    editor.on('blur', hide)
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    const initialFrame = window.requestAnimationFrame(refresh)

    return () => {
      window.cancelAnimationFrame(initialFrame)
      editor.off('transaction', refresh)
      editor.off('selectionUpdate', refresh)
      editor.off('focus', refresh)
      editor.off('blur', hide)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [editor, refresh])

  useEffect(() => {
    keyHandlerRef.current = (_view, event) => {
      const current = editor ? findCommand(editor, commands) : null
      const matches = current ? matchingCommandsFor(commands, current) : []
      const signature = current ? `${current.from}:${current.to}:${current.query}` : null
      if (
        !current ||
        matches.length === 0 ||
        dismissedRef.current === signature ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        return false
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectIndex((selectedIndexRef.current + 1) % matches.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectIndex((selectedIndexRef.current - 1 + matches.length) % matches.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        execute(matches[Math.min(selectedIndexRef.current, matches.length - 1)], current)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissedRef.current = `${current.from}:${current.to}:${current.query}`
        setMenu(null)
        return true
      }
      return false
    }

    return () => {
      keyHandlerRef.current = () => false
    }
  }, [commands, editor, execute, keyHandlerRef, selectIndex])

  if (!menu || matchingCommands.length === 0) return null

  return createPortal(
    <div
      role="listbox"
      aria-label="삽입 명령"
      className="fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      style={{ left: menu.left, top: menu.top }}
    >
      {matchingCommands.map((command, index) => (
        <button
          key={command.id}
          type="button"
          role="option"
          aria-label={command.label}
          aria-selected={index === selectedIndex}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-bold transition-colors',
            command.className,
            index === selectedIndex
              ? 'bg-slate-100 ring-1 ring-slate-300 dark:bg-slate-800 dark:ring-slate-600'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/70',
          )}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => selectIndex(index)}
          onClick={() => execute(command, menu)}
        >
          {command.displayLabel ?? command.label}
        </button>
      ))}
      <span className="pl-1 pr-0.5 text-[10px] text-slate-400" aria-hidden="true">↵</span>
    </div>,
    document.body,
  )
}

type CommandMatch = Pick<MenuState, 'from' | 'to' | 'query' | 'kind'>

function matchingCommandsFor(commands: SlashCommand[], match: CommandMatch) {
  if (match.kind === 'plain') {
    return commands.filter((command) => command.plain && command.label === match.query)
  }
  const query = match.query.toLocaleLowerCase()
  return commands.filter((command) => (
    command.slash !== false &&
    [command.label, ...(command.aliases ?? [])].some((keyword) => (
      keyword.toLocaleLowerCase().startsWith(query)
    ))
  ))
}

function findCommand(editor: Editor, commands: SlashCommand[]): CommandMatch | null {
  const { selection } = editor.state
  if (!selection.empty || !selection.$from.parent.isTextblock) return null

  const textBefore = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\0', '\0')
  const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/u)
  const query = match?.[1]
  if (query !== undefined) {
    return {
      from: selection.from - query.length - 1,
      to: selection.from,
      query,
      kind: 'slash',
    }
  }

  const plainCommand = commands.find((command) => (
    command.plain && new RegExp(`(?:^|\\s)${escapeRegExp(command.label)}$`, 'i').test(textBefore)
  ))
  if (!plainCommand) return null

  return {
    from: selection.from - plainCommand.label.length,
    to: selection.from,
    query: plainCommand.label,
    kind: 'plain',
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
