import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { MathBlock, MathInline } from '@/components/editor/extensions/math'
import { StoredImage } from '@/components/editor/extensions/storedImage'
import { YamaEmbed } from '@/components/editor/extensions/yamaEmbed'
import { imageFilesFrom, imageFilesFromHtml, uploadImage } from '@/lib/uploads'
import type { RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

type Props = {
  /**
   * 최초 내용. 이 컴포넌트는 비제어(uncontrolled) 다.
   * 밖에서 내용을 갈아끼워야 하면 부모가 key 로 다시 마운트한다.
   */
  initialValue: RichDoc
  onChange: (doc: RichDoc) => void
  /** 이미지 저장 경로에 쓰이는 작성자 id */
  userId: string
  placeholder?: string
  /** 댓글 입력처럼 좁은 자리에서는 도구 모음을 줄인다 */
  compact?: boolean
  minHeight?: string
  className?: string
  /** 도구 모음 우측에 붙일 요소 (등록 버튼 등) */
  toolbarExtra?: ReactNode
  onUploadError?: (message: string) => void
  /** 본문 종류별 Storage 버킷을 선택할 수 있게 한다. */
  uploadImageFile?: (file: File, userId: string) => Promise<string>
  /**
   * 야마 삽입 버튼을 보여주고, 누르면 이 함수를 부른다.
   * 부모가 문제 고르기 화면을 띄우고 고른 문제 id 를 돌려주면 본문에 꽂는다.
   * 넘기지 않으면 버튼 자체가 없다 — 테마 편집에서만 쓴다.
   */
  onRequestYama?: () => Promise<string | null>
}

export function RichTextEditor({
  initialValue,
  onChange,
  userId,
  placeholder = '내용을 입력하세요',
  compact = false,
  minHeight = '12rem',
  className,
  toolbarExtra,
  onUploadError,
  uploadImageFile = uploadImage,
  onRequestYama,
}: Props) {
  // 붙여넣기 핸들러는 에디터 생성 시점의 값을 붙잡으므로 ref 로 최신 값을 넘긴다.
  const userIdRef = useRef(userId)
  const errorRef = useRef(onUploadError)
  const uploadImageRef = useRef(uploadImageFile)
  useEffect(() => {
    userIdRef.current = userId
    errorRef.current = onUploadError
    uploadImageRef.current = uploadImageFile
  }, [userId, onUploadError, uploadImageFile])

  const insertImages = useCallback((view: EditorView, files: File[], at?: number) => {
    for (const file of files) {
      const uploadId = crypto.randomUUID()
      const { state } = view
      const node = state.schema.nodes.image.create({ uploadId })
      const pos = at ?? state.selection.from
      view.dispatch(state.tr.insert(pos, node).scrollIntoView())

      void uploadImageRef.current(file, userIdRef.current)
        .then((path) => replacePlaceholder(view, uploadId, path))
        .catch((caught: unknown) => {
          removePlaceholder(view, uploadId)
          errorRef.current?.(
            caught instanceof Error ? caught.message : '이미지를 올리지 못했습니다.',
          )
        })
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true },
      }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      TableKit.configure({ table: { resizable: false } }),
      StoredImage,
      YamaEmbed,
      MathInline,
      MathBlock,
      Placeholder.configure({ placeholder }),
    ],
    content: initialValue,
    editorProps: {
      attributes: {
        class: cn('rich-text focus:outline-none', compact ? 'min-h-24' : ''),
        style: compact ? '' : `min-height:${minHeight}`,
      },
      handlePaste(view, event) {
        const files = imageFilesFrom(event.clipboardData)
        if (files.length > 0) {
          event.preventDefault()
          insertImages(view, files)
          return true
        }

        // 웹페이지나 슬라이드에서 복사한 이미지는 파일이 아니라 HTML 의 img 로 온다.
        // 그대로 두면 남의 서버 주소가 본문에 박혀 나중에 깨지므로 우리 버킷으로 올린다.
        // DataTransfer 는 핸들러가 끝나면 못 읽으니 지금 꺼내둔다.
        const html = event.clipboardData?.getData('text/html') ?? ''
        const text = event.clipboardData?.getData('text/plain') ?? ''
        // 글과 섞여 온 붙여넣기는 건드리지 않는다. 텍스트까지 사라진다.
        if (!/<img\b/i.test(html) || text.trim() !== '') return false

        event.preventDefault()
        void imageFilesFromHtml(html).then((converted) => {
          if (converted.length === 0) {
            errorRef.current?.(
              '클립보드 이미지를 읽지 못했습니다. 이미지를 파일로 저장한 뒤 올려주세요.',
            )
            return
          }
          insertImages(view, converted)
        })
        return true
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = imageFilesFrom(event.dataTransfer)
        if (files.length === 0) return false
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        insertImages(view, files, coords?.pos)
        return true
      },
    },
    onUpdate({ editor: instance }) {
      onChange(instance.getJSON() as RichDoc)
    },
  })

  if (!editor) return null

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-300 bg-white focus-within:border-brand-500 dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
    >
      <Toolbar
        editor={editor}
        compact={compact}
        onPickImage={insertImages}
        extra={toolbarExtra}
        onRequestYama={onRequestYama}
      />
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

/** 업로드가 끝난 자리표시자를 실제 경로로 교체한다. */
function replacePlaceholder(view: EditorView, uploadId: string, src: string) {
  const found = findPlaceholder(view, uploadId)
  if (!found) return
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.attrs,
      src,
      uploadId: null,
    }),
  )
}

function removePlaceholder(view: EditorView, uploadId: string) {
  const found = findPlaceholder(view, uploadId)
  if (!found) return
  view.dispatch(view.state.tr.delete(found.pos, found.pos + 1))
}

function findPlaceholder(
  view: EditorView,
  uploadId: string,
): { pos: number; attrs: Record<string, unknown> } | null {
  let result: { pos: number; attrs: Record<string, unknown> } | null = null
  view.state.doc.descendants((node, pos) => {
    if (result) return false
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
      result = { pos, attrs: node.attrs }
      return false
    }
    return true
  })
  return result
}

// -----------------------------------------------------------------------------
// 도구 모음
// -----------------------------------------------------------------------------

function Toolbar({
  editor,
  compact,
  onPickImage,
  extra,
  onRequestYama,
}: {
  editor: Editor
  compact: boolean
  onPickImage: (view: EditorView, files: File[]) => void
  extra?: ReactNode
  onRequestYama?: () => Promise<string | null>
}) {
  // 서식 버튼의 활성 상태는 선택 영역이 바뀔 때마다 달라진다.
  const [, forceRender] = useState(0)
  useEffect(() => {
    const rerender = () => forceRender((value) => value + 1)
    editor.on('selectionUpdate', rerender)
    editor.on('transaction', rerender)
    return () => {
      editor.off('selectionUpdate', rerender)
      editor.off('transaction', rerender)
    }
  }, [editor])

  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
      {onRequestYama && (
        <ToolButton
          label="야마 넣기"
          active={false}
          onClick={() => {
            void onRequestYama().then((questionId) => {
              if (questionId) editor.chain().focus().insertYama(questionId).run()
            })
          }}
        >
          <span className="px-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">야마</span>
        </ToolButton>
      )}
      <ToolButton
        label="굵게"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </ToolButton>
      <ToolButton
        label="기울임"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="font-serif italic">I</span>
      </ToolButton>
      {NOTE_HIGHLIGHTS.map(({ label, color, className }) => (
        <ToolButton
          key={color}
          label={label}
          active={editor.isActive('highlight', { color })}
          onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
        >
          <span className={cn('h-4 w-4 rounded border border-black/10', className)} />
        </ToolButton>
      ))}
      <ToolButton
        label="빨간 글씨"
        active={editor.isActive('textStyle', { color: NOTE_TEXT_RED })}
        onClick={() => {
          if (editor.isActive('textStyle', { color: NOTE_TEXT_RED })) {
            editor.chain().focus().unsetColor().run()
          } else {
            editor.chain().focus().setColor(NOTE_TEXT_RED).run()
          }
        }}
      >
        <span className="font-semibold text-marker-red">A</span>
      </ToolButton>

      {!compact && (
        <>
          <Divider />
          <ToolButton
            label="소제목"
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            H3
          </ToolButton>
          <ToolButton
            label="글머리 목록"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </ToolButton>
          <ToolButton
            label="번호 목록"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </ToolButton>
          <ToolButton
            label="인용"
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            ❝
          </ToolButton>
          <ToolButton
            label="코드블록"
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <span className="font-mono text-xs">{'</>'}</span>
          </ToolButton>

          <Divider />
          <ToolButton
            label="표 삽입"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            표
          </ToolButton>
          {editor.isActive('table') && (
            <>
              <ToolButton
                label="열 추가"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                +열
              </ToolButton>
              <ToolButton
                label="행 추가"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                +행
              </ToolButton>
              <ToolButton
                label="표 삭제"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                표삭제
              </ToolButton>
            </>
          )}
        </>
      )}

      <Divider />
      <ToolButton label="이미지" onClick={() => fileInput.current?.click()}>
        🖼
      </ToolButton>
      <ToolButton
        label="인라인 수식"
        onClick={() => editor.chain().focus().setMathInline('').run()}
      >
        <span className="font-serif italic">x</span>
      </ToolButton>
      {!compact && (
        <ToolButton
          label="블록 수식"
          onClick={() => editor.chain().focus().setMathBlock('').run()}
        >
          <span className="font-serif italic">Σ</span>
        </ToolButton>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onPickImage(editor.view, files)
          event.target.value = ''
        }}
      />

      {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  )
}

const NOTE_TEXT_RED = '#cc1616'

const NOTE_HIGHLIGHTS = [
  { label: '노랑 형광펜', color: 'rgba(253, 224, 71, 0.55)', className: 'bg-amber-300' },
  { label: '초록 형광펜', color: 'rgba(110, 231, 183, 0.55)', className: 'bg-emerald-300' },
  { label: '하늘 형광펜', color: 'rgba(125, 211, 252, 0.55)', className: 'bg-sky-300' },
  { label: '분홍 형광펜', color: 'rgba(249, 168, 212, 0.55)', className: 'bg-pink-300' },
] as const

function Divider() {
  return <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors',
        active
          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
