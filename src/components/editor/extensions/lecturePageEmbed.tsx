/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { LecturePageCard, type LecturePageAttrs } from '@/components/lecture/LecturePageCard'
import { parseStrokes } from '@/components/lecture/pageStrokes'

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
function LecturePageEmbedView({ node, selected, editor, deleteNode, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as Record<string, unknown>

  return (
    <NodeViewWrapper
      as="div"
      className="my-3"
      contentEditable={false}
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onKeyUp={(event: KeyboardEvent) => event.stopPropagation()}
      onPaste={(event: ClipboardEvent) => event.stopPropagation()}
      onDrop={(event: DragEvent) => event.stopPropagation()}
    >
      <LecturePageCard
        src={typeof attrs.src === 'string' ? attrs.src : null}
        lectureId={typeof attrs.lectureId === 'string' ? attrs.lectureId : null}
        page={typeof attrs.page === 'number' ? attrs.page : null}
        title={typeof attrs.title === 'string' ? attrs.title : null}
        professor={typeof attrs.professor === 'string' ? attrs.professor : null}
        width={typeof attrs.width === 'number' ? attrs.width : null}
        selected={selected}
        onRemove={editor.isEditable ? deleteNode : undefined}
        onResize={editor.isEditable ? (width) => updateAttributes({ width }) : undefined}
        strokes={parseStrokes(attrs.strokes)}
        onStrokesChange={
          editor.isEditable ? (strokes) => updateAttributes({ strokes }) : undefined
        }
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
      // 쪽 위에 덧그린 자국. 좌표라서 크기를 바꿔도 따라 움직인다.
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
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-lecture-page]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-lecture-page': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LecturePageEmbedView)
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
