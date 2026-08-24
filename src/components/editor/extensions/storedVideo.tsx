/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 노드뷰를 함께 둔다. */
import type { DragEvent, KeyboardEvent } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Spinner } from '@/components/ui/Spinner'
import { useSignedUrl } from '@/lib/storage'
import { cn } from '@/utils/cn'

/**
 * 공지 본문에 저장하는 비공개 영상.
 *
 * 이미지와 마찬가지로 src에는 만료되는 서명 URL이 아니라
 * `<bucket>/<사용자>/<파일>` 경로만 저장한다. 읽는 시점에 권한을 확인해
 * 서명 URL을 새로 발급하므로 레옵스 권한이 없는 사람은 영상을 열 수 없다.
 */
function StoredVideoView({ node, selected, editor, deleteNode }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null
  const url = useSignedUrl(src)

  return (
    <NodeViewWrapper
      as="div"
      className="my-3"
      contentEditable={false}
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onKeyUp={(event: KeyboardEvent) => event.stopPropagation()}
      onDrop={(event: DragEvent) => event.stopPropagation()}
    >
      {!src ? (
        <div className="flex h-36 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <Spinner className="h-4 w-4" />
          영상을 올리는 중입니다
        </div>
      ) : !url ? (
        <div className="h-36 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
      ) : (
        <div className="group/video relative overflow-hidden rounded-lg bg-black">
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className={cn(
              'mx-auto max-h-[75vh] w-full bg-black',
              selected && 'ring-2 ring-inset ring-brand-500',
            )}
          >
            이 브라우저에서는 영상을 재생할 수 없습니다.
          </video>
          {editor.isEditable && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={deleteNode}
              className="absolute right-2 top-2 rounded-md bg-slate-950/75 px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity hover:bg-rose-600 group-hover/video:opacity-100"
            >
              영상 삭제
            </button>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

export const StoredVideo = Node.create({
  name: 'video',
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
      uploadId: {
        default: null,
        // 업로드가 끝난 자리표시자를 찾는 임시 값이라 저장하지 않는다.
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-stored-video]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-stored-video': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(StoredVideoView)
  },
})
