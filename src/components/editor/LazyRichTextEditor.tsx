import { Suspense, lazy, type ComponentProps } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import type { RichTextEditor } from '@/components/editor/RichTextEditor'
import { isChunkLoadError, reloadOnce } from '@/utils/reloadOnChunkError'

/**
 * Tiptap 은 번들에서 가장 무거운 의존성인데 글을 쓸 때만 필요하다.
 * 읽기 전용 뷰어(RichTextViewer)는 Tiptap 을 쓰지 않으므로, 에디터만 떼어내면
 * 문제를 풀기만 하는 사용자는 이 코드를 내려받지 않는다.
 */
const Editor = lazy(async () => {
  try {
    const module = await import('@/components/editor/RichTextEditor')
    return { default: module.RichTextEditor }
  } catch (caught) {
    // 배포가 새로 올라가 예전 청크 해시가 사라진 경우, 새로고침하면 바로
    // 해결된다. 새로고침이 걸리는 동안은 에러 화면 대신 로딩 상태로 둔다.
    if (isChunkLoadError(caught) && reloadOnce()) return new Promise(() => {})
    throw caught
  }
})

export function LazyRichTextEditor(props: ComponentProps<typeof RichTextEditor>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700">
          <Spinner className="h-5 w-5" />
        </div>
      }
    >
      <Editor {...props} />
    </Suspense>
  )
}
