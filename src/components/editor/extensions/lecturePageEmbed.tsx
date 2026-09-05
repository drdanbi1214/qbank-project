/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import type {
  ClipboardEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { LecturePageCard, type LecturePageAttrs } from '@/components/lecture/LecturePageCard'
import { parsePageMarks } from '@/components/lecture/pageMarks'
import { pageCropOf } from '@/components/lecture/pageCrop'
import { imageWidthOf } from '@/types/richtext'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lecturePageEmbed: {
      insertLecturePage: (attrs: LecturePageAttrs | LecturePageAttrs[]) => ReturnType
    }
  }
}

/**
 * 본문에 박는 강의록 한 쪽.
 *
 * 알렌(theoryEmbed)과 달리 문서 id 만 담지 않고 그 쪽을 구운 이미지를 함께
 * 담는다. 참조만 담으면 글을 읽는 사람이 60MB 짜리 PDF 를 통째로 받아야 하고,
 * 한 글에 여러 강의록을 인용하면 그만큼 배가 되기 때문이다. 대신 lectureId 와
 * page 를 같이 남겨 원본 강의록으로 갈 수 있게 한다.
 *
 * title/professor 는 넣은 시점의 값을 그대로 굳혀 둔다. 이미지가 그때의 화면인
 * 이상 설명도 그때 것이어야 앞뒤가 맞는다.
 *
 * richtext.ts 의 LEAF_TYPES 에도 같은 이름이 등록되어 있어야 인라인 코멘트
 * 위치가 어긋나지 않는다.
 */
function LecturePageEmbedView({
  node,
  selected,
  editor,
  deleteNode,
  updateAttributes,
  getPos,
}: NodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>

  function resizePage(width: number | null) {
    const savedWidth = imageWidthOf(width)
    const editorWidth = editor.view.dom.getBoundingClientRect().width
    // 반쪽보다 작게 줄이면 바깥 노드도 반 칸만 차지한다. 연달아 놓인 두 쪽은
    // 같은 줄에 들어가고, 다시 크게 늘리면 자동으로 한 줄 전체로 돌아온다.
    const nextLayout =
      savedWidth !== null && editorWidth > 0 && savedWidth <= (editorWidth - 12) / 2
        ? 'half'
        : null
    updateAttributes({ width: savedWidth, layout: nextLayout })
  }

  function selectThisPage(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editor.isEditable || event.button !== 0) return
    const position = getPos()
    if (typeof position !== 'number') return

    // 카드 안의 이미지처럼 contentEditable=false 인 자손을 누르면 ProseMirror가
    // 클릭을 카드 선택이 아니라 앞뒤 문단의 커서로 해석하는 경우가 있다.
    // 먼저 원자 노드를 직접 선택하고, 바깥 편집기가 다시 커서를 옮기지 못하게 한다.
    if (!selected) editor.commands.setNodeSelection(position)
    event.stopPropagation()
  }

  return (
    <NodeViewWrapper
      as="div"
      data-side-by-side-item=""
      className="relative"
      contentEditable={false}
      onPointerDown={selectThisPage}
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onKeyUp={(event: KeyboardEvent) => event.stopPropagation()}
      onPaste={(event: ClipboardEvent) => event.stopPropagation()}
    >
      {editor.isEditable && (
        <span
          data-drag-handle=""
          contentEditable={false}
          title="끌어서 강의록 쪽 이동"
          className="absolute left-1/2 top-1 z-30 -translate-x-1/2 touch-none select-none cursor-grab rounded-md bg-slate-900/75 px-2 py-0.5 text-xs font-bold tracking-widest text-white shadow active:cursor-grabbing"
        >
          ⠿
        </span>
      )}
      <LecturePageCard
        src={typeof attrs.src === 'string' ? attrs.src : null}
        lectureId={typeof attrs.lectureId === 'string' ? attrs.lectureId : null}
        page={typeof attrs.page === 'number' ? attrs.page : null}
        title={typeof attrs.title === 'string' ? attrs.title : null}
        professor={typeof attrs.professor === 'string' ? attrs.professor : null}
        width={typeof attrs.width === 'number' ? attrs.width : null}
        crop={pageCropOf(attrs.crop)}
        selected={selected}
        onRemove={editor.isEditable ? deleteNode : undefined}
        onResize={editor.isEditable ? resizePage : undefined}
        onCropChange={editor.isEditable ? (crop) => updateAttributes({ crop }) : undefined}
        marks={parsePageMarks(attrs.strokes)}
        onMarksChange={editor.isEditable ? (strokes) => updateAttributes({ strokes }) : undefined}
        canMove={editor.isEditable}
      />
    </NodeViewWrapper>
  )
}

export const LecturePageEmbed = Node.create({
  name: 'lecturePageEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-src'),
        renderHTML: (attributes) => (attributes.src ? { 'data-src': attributes.src } : {}),
      },
      lectureId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-lecture-id'),
        renderHTML: (attributes) =>
          attributes.lectureId ? { 'data-lecture-id': attributes.lectureId } : {},
      },
      page: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-page')) || null,
        renderHTML: (attributes) => (attributes.page ? { 'data-page': String(attributes.page) } : {}),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
      professor: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-professor'),
        renderHTML: (attributes) =>
          attributes.professor ? { 'data-professor': attributes.professor } : {},
      },
      // 다른 탭에서 붙여넣은 쪽 이미지가 Storage에 올라가는 동안 같은 노드를
      // 찾아 완성하기 위한 임시 값. 업로드가 끝나면 null로 지운다.
      uploadId: {
        default: null,
        rendered: false,
      },
      // 쪽 위에 남긴 자국과 글자. 좌표라서 크기를 바꿔도 따라 움직인다.
      // 이름이 strokes 인 건 글자를 뒤에 붙였기 때문이다. 이미 저장된 글이
      // 이 이름으로 담겨 있어 바꾸면 예전 글의 표시가 사라진다.
      strokes: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-strokes')
          if (!raw) return null
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        },
        renderHTML: (attributes) =>
          Array.isArray(attributes.strokes) && attributes.strokes.length > 0
            ? { 'data-strokes': JSON.stringify(attributes.strokes) }
            : {},
      },
      // 사람이 조절한 폭(px). 없으면 글 폭에 맞춘다.
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || null,
        renderHTML: (attributes) =>
          attributes.width ? { 'data-width': String(attributes.width) } : {},
      },
      // 반쪽 폭 노드 두 개는 한 줄에 나란히 놓는다. px 폭만으로 판단하면 읽는
      // 화면의 폭에 따라 배치가 달라지므로 작성 시 정한 상태를 따로 저장한다.
      layout: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-layout') === 'half' ? 'half' : null,
        renderHTML: (attributes) =>
          attributes.layout === 'half' ? { 'data-layout': 'half' } : {},
      },
      crop: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-crop')
          if (!raw) return null
          try {
            return pageCropOf(JSON.parse(raw))
          } catch {
            return null
          }
        },
        renderHTML: (attributes) => {
          const crop = pageCropOf(attributes.crop)
          return crop ? { 'data-crop': JSON.stringify(crop) } : {}
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-lecture-page]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-lecture-page': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LecturePageEmbedView, {
      attrs: ({ node }) => ({
        'data-side-by-side-item': '',
        'data-page-layout': node.attrs.layout === 'half' ? 'half' : 'full',
      }),
    })
  },

  addCommands() {
    return {
      // 여러 쪽을 한 번에 받는다. chain() 으로 insertContent 를 이어 붙이면
      // 묶인 명령들이 모두 "원래" 커서 위치를 보기 때문에 같은 자리에 겹쳐
      // 들어가 마지막 쪽만 남는다. 한 번의 삽입으로 배열을 통째로 넣어야
      // 순서대로 쌓이고, 되돌리기도 한 번에 걸린다.
      insertLecturePage:
        (attrs: LecturePageAttrs | LecturePageAttrs[]) =>
        ({ commands }) =>
          commands.insertContent(
            (Array.isArray(attrs) ? attrs : [attrs]).map((item) => ({
              type: this.name,
              attrs: item,
            })),
          ),
    }
  },
})
