/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import Image from '@tiptap/extension-image'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Spinner } from '@/components/ui/Spinner'
import { useSignedUrl } from '@/lib/storage'

/**
 * 본문 이미지.
 *
 * src 에는 서명 URL 이 아니라 `<bucket>/<path>` 경로를 저장한다. 서명 URL 은
 * 만료되기 때문에 본문에 박아두면 나중에 깨진다. 표시할 때마다 새로 발급한다.
 *
 * 업로드가 끝나기 전에는 uploadId 만 가진 자리표시자 노드로 먼저 삽입하고,
 * 완료되면 같은 uploadId 를 가진 노드를 찾아 src 로 바꿔치기한다.
 */
function StoredImageView({ node, selected }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null
  const caption = typeof node.attrs.alt === 'string' ? node.attrs.alt : null
  const url = useSignedUrl(src)

  return (
    <NodeViewWrapper as="div" className="my-2">
      {!src ? (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <Spinner className="h-4 w-4" />
          이미지를 올리는 중입니다
        </div>
      ) : !url ? (
        <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
      ) : (
        <img
          src={url}
          alt={caption ?? ''}
          className={
            selected
              ? 'max-h-96 rounded-lg ring-2 ring-brand-500'
              : 'max-h-96 rounded-lg border border-slate-200 dark:border-slate-700'
          }
        />
      )}
    </NodeViewWrapper>
  )
}

export const StoredImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: {
        default: null,
        // 업로드 진행 추적용이라 저장할 필요가 없다.
        rendered: false,
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(StoredImageView)
  },
})
