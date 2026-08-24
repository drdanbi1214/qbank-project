import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import {
  StyledTable,
  StyledTableCell,
  StyledTableHeader,
} from '@/components/editor/extensions/tableStyle'
import { Placeholder } from '@tiptap/extensions'
import { MathBlock, MathInline } from '@/components/editor/extensions/math'
import { StoredImage } from '@/components/editor/extensions/storedImage'
import { StoredVideo } from '@/components/editor/extensions/storedVideo'
import { YamaEmbed } from '@/components/editor/extensions/yamaEmbed'
import { LecturePageEmbed } from '@/components/editor/extensions/lecturePageEmbed'
import { TheoryEmbed } from '@/components/editor/extensions/theoryEmbed'
import type { LecturePageAttrs } from '@/components/lecture/LecturePageCard'
import { Footnote } from '@/components/editor/extensions/footnote'
import { FONT_SIZES, FontSize, safeFontSize } from '@/components/editor/extensions/fontSize'
import { LINE_HEIGHTS, LineHeight, safeLineHeight } from '@/components/editor/extensions/lineHeight'
import { BlockIndent } from '@/components/editor/extensions/indent'
import {
  imageFilesFrom,
  imageFilesFromHtml,
  uploadImage,
  videoFilesFrom,
} from '@/lib/uploads'
import { readLecturePageClipboard } from '@/lib/lectureClipboard'
import {
  NOTE_HIGHLIGHTS,
  NOTE_TEXT_COLORS,
  snapCellShade,
  snapHighlightColor,
  snapTextColor,
} from '@/components/editor/palette'
import { CELL_SHADES, imageWidthOf, type RichDoc } from '@/types/richtext'
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
  /** 넘긴 화면에만 영상 첨부 버튼을 표시한다. 현재는 레옵스 공지에서 쓴다. */
  uploadVideoFile?: (file: File, userId: string) => Promise<string>
  /**
   * 야마 삽입 버튼을 보여주고, 누르면 이 함수를 부른다.
   * 부모가 문제 고르기 화면을 띄우고 고른 문제 id 를 돌려주면 본문에 꽂는다.
   * 넘기지 않으면 버튼 자체가 없다 — 테마 편집에서만 쓴다.
   */
  onRequestYama?: () => Promise<string | null>
  /** 이론 넣기 버튼. 부모가 이론 고르기 화면을 띄우고 문서 id 를 돌려준다. */
  onRequestTheory?: () => Promise<string | null>
  /**
   * 글이 저장된 뒤 보이는 서식과 같게 맞추려고 넘긴다. 편집기가 늘 기본
   * 서식으로만 그리면 쓸 때는 널널했다가 저장하는 순간 촘촘해져 놀란다.
   */
  contentClassName?: string
  /** 강의록에서 고른 쪽들. 여러 쪽을 한 번에 넣을 수 있다. */
  onRequestLecture?: () => Promise<LecturePageAttrs[] | null>
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
  uploadVideoFile,
  onRequestYama,
  onRequestTheory,
  onRequestLecture,
  contentClassName,
}: Props) {
  // 붙여넣기 핸들러는 에디터 생성 시점의 값을 붙잡으므로 ref 로 최신 값을 넘긴다.
  const userIdRef = useRef(userId)
  const errorRef = useRef(onUploadError)
  const uploadImageRef = useRef(uploadImageFile)
  const uploadVideoRef = useRef(uploadVideoFile)
  useEffect(() => {
    userIdRef.current = userId
    errorRef.current = onUploadError
    uploadImageRef.current = uploadImageFile
    uploadVideoRef.current = uploadVideoFile
  }, [userId, onUploadError, uploadImageFile, uploadVideoFile])

  const insertImages = useCallback((view: EditorView, files: File[], at?: number) => {
    for (const file of files) {
      const uploadId = crypto.randomUUID()
      const { state } = view
      const node = state.schema.nodes.image.create({ uploadId })
      const pos = at ?? state.selection.from
      view.dispatch(state.tr.insert(pos, node).scrollIntoView())

      // 폭을 안 정해 두면 max-h-96 으로 눌려서 원본보다 작게 들어간다.
      // 원본 픽셀 폭을 같이 실어 보내고, 편집기보다 넓으면 CSS(max-w-full)가 줄인다.
      void Promise.all([
        uploadImageRef.current(file, userIdRef.current),
        naturalWidthOf(file),
      ])
        .then(([path, width]) => replacePlaceholder(view, uploadId, path, width))
        .catch((caught: unknown) => {
          removePlaceholder(view, uploadId)
          errorRef.current?.(
            caught instanceof Error ? caught.message : '이미지를 올리지 못했습니다.',
          )
        })
    }
  }, [])

  const insertVideos = useCallback((view: EditorView, files: File[], at?: number) => {
    const upload = uploadVideoRef.current
    const file = files[0]
    if (!upload || !file) return

    const uploadId = crypto.randomUUID()
    const { state } = view
    const node = state.schema.nodes.video.create({ uploadId })
    const pos = at ?? state.selection.from
    view.dispatch(state.tr.insert(pos, node).scrollIntoView())

    void upload(file, userIdRef.current)
      .then((src) => replaceVideoPlaceholder(view, uploadId, src))
      .catch((caught: unknown) => {
        removePlaceholder(view, uploadId, 'video')
        errorRef.current?.(
          caught instanceof Error ? caught.message : '영상을 올리지 못했습니다.',
        )
      })
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
      FontSize,
      LineHeight,
      BlockIndent,
      // 표 노드는 꾸미기 속성을 붙인 것으로 갈아 끼운다. 열 너비는 드래그로 정한다.
      TableKit.configure({
        table: false,
        tableCell: false,
        tableHeader: false,
      }),
      StyledTable.configure({ resizable: true }),
      StyledTableCell,
      StyledTableHeader,
      StoredImage,
      StoredVideo,
      YamaEmbed,
      TheoryEmbed,
      LecturePageEmbed,
      Footnote,
      MathInline,
      MathBlock,
      Placeholder.configure({ placeholder }),
    ],
    content: initialValue,
    editorProps: {
      attributes: {
        class: cn('rich-text focus:outline-none', contentClassName, compact ? 'min-h-24' : ''),
        style: compact ? '' : `min-height:${minHeight}`,
      },
      handlePaste(view, event) {
        const lecturePage = readLecturePageClipboard(event.clipboardData)
        if (lecturePage) {
          // DataTransfer는 이벤트가 끝난 뒤 읽을 수 없으므로 이미지와 HTML을
          // 지금 확보한다. 자리는 먼저 만들고 업로드 완료 후 같은 노드를 채운다.
          const directFiles = imageFilesFrom(event.clipboardData)
          const html = event.clipboardData?.getData('text/html') ?? ''
          const uploadId = crypto.randomUUID()
          const { state } = view
          const node = state.schema.nodes.lecturePageEmbed.create({
            ...lecturePage,
            src: null,
            uploadId,
          })

          event.preventDefault()
          view.dispatch(state.tr.insert(state.selection.from, node).scrollIntoView())

          void (async () => {
            const files = directFiles.length > 0 ? directFiles : await imageFilesFromHtml(html)
            const file = files[0]
            if (!file) throw new Error('복사한 강의록 페이지 이미지를 읽지 못했습니다.')
            const src = await uploadImageRef.current(file, userIdRef.current)
            replaceLecturePagePlaceholder(view, uploadId, src)
          })().catch((caught: unknown) => {
            removePlaceholder(view, uploadId, 'lecturePageEmbed')
            errorRef.current?.(
              caught instanceof Error ? caught.message : '강의록 페이지를 붙이지 못했습니다.',
            )
          })
          return true
        }

        const files = imageFilesFrom(event.clipboardData)
        if (files.length > 0) {
          event.preventDefault()
          insertImages(view, files)
          return true
        }

        const videos = videoFilesFrom(event.clipboardData)
        if (uploadVideoRef.current && videos.length > 0) {
          event.preventDefault()
          insertVideos(view, videos)
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
      /**
       * 밖에서 가져온 색을 우리 팔레트로 맞춘다.
       *
       * 허용 목록에 없는 색은 뷰어에서 버려지는데, 그러면 파란 글씨가 색을 잃고
       * 배경만 남아 원본에 없던 노란 형광펜이 생긴다. 파싱 전에 값 자체를
       * 팔레트 색으로 바꿔 두면 저장되는 문서도 깨끗하다.
       */
      transformPastedHTML(html) {
        if (!/style=|<font/i.test(html)) return html
        const parsed = new DOMParser().parseFromString(html, 'text/html')

        // 표 셀 배경이 먼저다. 형광펜으로 넘기면 글자 뒤에만 색이 깔려서
        // 원본처럼 칸 전체가 칠해지지 않는다.
        for (const cell of parsed.querySelectorAll<HTMLElement>('td[style], th[style]')) {
          const background = cell.style.backgroundColor
          if (!background) continue
          const shade = snapCellShade(background)
          cell.style.backgroundColor = ''
          if (shade) cell.setAttribute('data-shade', shade)
        }

        for (const element of parsed.querySelectorAll<HTMLElement>('[style]')) {
          const { color, backgroundColor } = element.style
          if (color) element.style.color = snapTextColor(color) ?? ''
          if (backgroundColor) {
            element.style.backgroundColor = snapHighlightColor(backgroundColor) ?? ''
          }
        }
        // 오래된 자료는 색을 style 이 아니라 font 태그에 담아 온다.
        for (const element of parsed.querySelectorAll<HTMLElement>('font[color]')) {
          const snapped = snapTextColor(element.getAttribute('color') ?? '')
          element.removeAttribute('color')
          if (snapped) element.style.color = snapped
        }

        return parsed.body.innerHTML
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = imageFilesFrom(event.dataTransfer)
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (files.length > 0) {
          event.preventDefault()
          insertImages(view, files, coords?.pos)
          return true
        }

        const videos = videoFilesFrom(event.dataTransfer)
        if (!uploadVideoRef.current || videos.length === 0) return false
        event.preventDefault()
        insertVideos(view, videos, coords?.pos)
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
        onPickVideo={uploadVideoFile ? insertVideos : undefined}
        extra={toolbarExtra}
        onRequestYama={onRequestYama}
        onRequestTheory={onRequestTheory}
        onRequestLecture={onRequestLecture}
      />
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}


/** 셀 배경 팔레트의 이름과 견본 색. index.css 의 data-shade 규칙과 짝이다. */
const CELL_SHADE_LABELS: Record<string, string> = {
  yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍', gray: '회색',
}
const CELL_SHADE_SWATCH: Record<string, string> = {
  yellow: 'bg-amber-200', green: 'bg-emerald-200', blue: 'bg-sky-200',
  pink: 'bg-pink-200', gray: 'bg-slate-300',
}

/**
 * 고른 셀 전체에 배경을 넣는다.
 *
 * updateAttributes 는 커서가 있는 노드 하나만 바꾸므로, 여러 칸을 고른
 * 경우까지 덮으려면 셀 범위를 직접 훑어야 한다.
 */
function setCellShade(editor: Editor, shade: string | null) {
  const { state } = editor
  const positions: number[] = []
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos)
  })
  if (positions.length === 0) return

  const tr = state.tr
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos)
    if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, shade })
  }
  editor.view.dispatch(tr)
  editor.commands.focus()
}

/** 업로드가 끝난 자리표시자를 실제 경로로 교체한다. */
/** 붙여넣은 이미지의 원본 픽셀 폭. 못 읽으면 null 이라 예전처럼 그린다. */
async function naturalWidthOf(file: File): Promise<number | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const width = bitmap.width
    bitmap.close()
    return imageWidthOf(width)
  } catch {
    return null
  }
}

function replacePlaceholder(
  view: EditorView,
  uploadId: string,
  src: string,
  width: number | null,
) {
  const found = findPlaceholder(view, uploadId)
  if (!found) return
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.attrs,
      src,
      width: width ?? found.attrs.width,
      uploadId: null,
    }),
  )
}

function replaceLecturePagePlaceholder(view: EditorView, uploadId: string, src: string) {
  const found = findPlaceholder(view, uploadId, 'lecturePageEmbed')
  if (!found) return
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.attrs,
      src,
      uploadId: null,
    }),
  )
}

function replaceVideoPlaceholder(view: EditorView, uploadId: string, src: string) {
  const found = findPlaceholder(view, uploadId, 'video')
  if (!found) return
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.attrs,
      src,
      uploadId: null,
    }),
  )
}

function removePlaceholder(view: EditorView, uploadId: string, nodeType = 'image') {
  const found = findPlaceholder(view, uploadId, nodeType)
  if (!found) return
  view.dispatch(view.state.tr.delete(found.pos, found.pos + 1))
}

function findPlaceholder(
  view: EditorView,
  uploadId: string,
  nodeType = 'image',
): { pos: number; attrs: Record<string, unknown> } | null {
  let result: { pos: number; attrs: Record<string, unknown> } | null = null
  view.state.doc.descendants((node, pos) => {
    if (result) return false
    if (node.type.name === nodeType && node.attrs.uploadId === uploadId) {
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
  onPickVideo,
  extra,
  onRequestYama,
  onRequestTheory,
  onRequestLecture,
}: {
  editor: Editor
  compact: boolean
  onPickImage: (view: EditorView, files: File[]) => void
  onPickVideo?: (view: EditorView, files: File[]) => void
  extra?: ReactNode
  onRequestYama?: () => Promise<string | null>
  onRequestTheory?: () => Promise<string | null>
  /** 강의록에서 고른 쪽들. 여러 쪽을 한 번에 넣을 수 있다. */
  onRequestLecture?: () => Promise<LecturePageAttrs[] | null>
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
  const videoInput = useRef<HTMLInputElement>(null)

  return (
    <div
      // 글이 길어지면 아래에서 쓰다가 도구를 누르러 위로 스크롤해야 했다.
      // 화면 위에 붙여 두면 어디를 쓰든 손이 닿는다.
      //
      // 바깥 상자에 overflow 를 걸면 안 된다. sticky 가 그 상자 안에 갇혀
      // 따라오지 않는다. 모서리는 여기서 직접 둥글린다. 배경도 칠해야 본문이
      // 뒤로 비쳐 지나가지 않는다.
      //
      // top 은 사이트 머리글 높이(h-14)만큼 띄운다. 0 으로 두면 z-30 인 머리글
      // 뒤로 들어가 보이지 않는다.
      className="sticky top-14 z-20 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-slate-200 bg-white/95 px-2 py-1.5 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
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
      {onRequestTheory && (
        <ToolButton
          label="알렌 넣기"
          active={false}
          onClick={() => {
            void onRequestTheory().then((documentId) => {
              if (documentId) editor.chain().focus().insertTheory(documentId).run()
            })
          }}
        >
          <span className="px-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">알렌</span>
        </ToolButton>
      )}
      {onRequestLecture && (
        <ToolButton
          label="강의록 넣기"
          active={false}
          onClick={() => {
            void onRequestLecture().then((picks) => {
              if (!picks?.length) return
              // 고른 순서가 아니라 쪽 번호 순으로 이미 정렬되어 온다.
              editor.chain().focus().insertLecturePage(picks).run()
            })
          }}
        >
          <span className="px-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">강의록</span>
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
      {NOTE_TEXT_COLORS.map(({ label, color, className }) => (
        <ToolButton
          key={color}
          label={label}
          active={editor.isActive('textStyle', { color })}
          onClick={() => {
            if (editor.isActive('textStyle', { color })) {
              editor.chain().focus().unsetColor().run()
            } else {
              editor.chain().focus().setColor(color).run()
            }
          }}
        >
          <span className={cn('font-semibold', className)}>A</span>
        </ToolButton>
      ))}

      {!compact && (
        <>
          <Divider />
          <select
            aria-label="문단 종류"
            value={
              editor.isActive('heading', { level: 2 })
                ? '2'
                : editor.isActive('heading', { level: 3 })
                  ? '3'
                  : editor.isActive('heading', { level: 4 })
                    ? '4'
                    : 'p'
            }
            onChange={(event) => {
              const value = event.target.value
              if (value === 'p') editor.chain().focus().setParagraph().run()
              else editor.chain().focus().setHeading({ level: Number(value) as 2 | 3 | 4 }).run()
            }}
            className="mx-0.5 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="p">본문</option>
            <option value="2">제목 1</option>
            <option value="3">제목 2</option>
            <option value="4">제목 3</option>
          </select>
          <select
            aria-label="글씨 크기"
            value={safeFontSize(editor.getAttributes('textStyle').fontSize) ?? ''}
            onChange={(event) => {
              const value = event.target.value
              if (value === '') editor.chain().focus().unsetFontSize().run()
              else editor.chain().focus().setFontSize(value).run()
            }}
            className="mx-0.5 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            {FONT_SIZES.map((item) => (
              <option key={item.label} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            aria-label="줄간격"
            value={
              safeLineHeight(editor.getAttributes('paragraph').lineHeight) ??
              safeLineHeight(editor.getAttributes('heading').lineHeight) ??
              ''
            }
            onChange={(event) => editor.chain().focus().setBlockLineHeight(event.target.value).run()}
            className="mx-0.5 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            {LINE_HEIGHTS.map((item) => (
              <option key={item.label} value={item.value}>
                줄간격 {item.label}
              </option>
            ))}
          </select>
          <ToolButton
            label="내어쓰기 (Shift+Tab)"
            active={false}
            onClick={() => editor.chain().focus().outdentBlock().run()}
          >
            <span className="text-xs">⇤</span>
          </ToolButton>
          <ToolButton
            label="들여쓰기 (Tab)"
            active={false}
            onClick={() => editor.chain().focus().indentBlock().run()}
          >
            <span className="text-xs">⇥</span>
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
                label="열 삭제"
                onClick={() => editor.chain().focus().deleteColumn().run()}
              >
                −열
              </ToolButton>
              <ToolButton
                label="행 삭제"
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                −행
              </ToolButton>
              <ToolButton
                label="머리글 행 켜기/끄기"
                active={editor.isActive('tableHeader')}
                onClick={() => editor.chain().focus().toggleHeaderRow().run()}
              >
                머리글
              </ToolButton>
              <ToolButton
                label="표 삭제"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                표삭제
              </ToolButton>

              <Divider />
              {/* 셀 배경. 커서가 있는 셀, 여러 칸을 고르면 고른 칸 전부에 들어간다. */}
              {CELL_SHADES.map((shade) => (
                <ToolButton
                  key={shade}
                  label={`셀 ${CELL_SHADE_LABELS[shade]}`}
                  active={
                    editor.isActive('tableCell', { shade }) ||
                    editor.isActive('tableHeader', { shade })
                  }
                  onClick={() => setCellShade(editor, shade)}
                >
                  <span
                    className={cn('block h-3.5 w-3.5 rounded-sm border border-black/20', CELL_SHADE_SWATCH[shade])}
                  />
                </ToolButton>
              ))}
              <ToolButton label="셀 배경 지우기" onClick={() => setCellShade(editor, null)}>
                <span className="text-xs">✕</span>
              </ToolButton>

              <Divider />
              <ToolButton
                label="테두리 기본"
                active={!editor.getAttributes('table').border}
                onClick={() => editor.chain().focus().updateAttributes('table', { border: null }).run()}
              >
                <span className="text-xs">선</span>
              </ToolButton>
              <ToolButton
                label="테두리 굵게"
                active={editor.getAttributes('table').border === 'bold'}
                onClick={() => editor.chain().focus().updateAttributes('table', { border: 'bold' }).run()}
              >
                <span className="text-xs font-bold">선</span>
              </ToolButton>
              <ToolButton
                label="테두리 없음"
                active={editor.getAttributes('table').border === 'none'}
                onClick={() => editor.chain().focus().updateAttributes('table', { border: 'none' }).run()}
              >
                <span className="text-xs line-through opacity-60">선</span>
              </ToolButton>
            </>
          )}
        </>
      )}

      <Divider />
      <ToolButton label="이미지" onClick={() => fileInput.current?.click()}>
        🖼
      </ToolButton>
      {onPickVideo && (
        <ToolButton label="영상 첨부" onClick={() => videoInput.current?.click()}>
          ▶
        </ToolButton>
      )}
      <ToolButton
        label="인라인 수식"
        onClick={() => editor.chain().focus().setMathInline('').run()}
      >
        <span className="font-serif italic">x</span>
      </ToolButton>
      <ToolButton
        label="각주"
        active={editor.isActive('footnote')}
        onClick={() => editor.chain().focus().insertFootnote().run()}
      >
        <span className="text-xs">
          가<sup className="text-[9px] font-bold">1</sup>
        </span>
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

      {onPickVideo && (
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mov"
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            if (files.length > 0) onPickVideo(editor.view, files)
            event.target.value = ''
          }}
        />
      )}

      {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  )
}


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
