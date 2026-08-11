import { Suspense, lazy, type ComponentProps } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import type { RichTextEditor } from '@/components/editor/RichTextEditor'

/**
 * Tiptap 은 번들에서 가장 무거운 의존성인데 글을 쓸 때만 필요하다.
 * 읽기 전용 뷰어(RichTextViewer)는 Tiptap 을 쓰지 않으므로, 에디터만 떼어내면
 * 문제를 풀기만 하는 사용자는 이 코드를 내려받지 않는다.
 */
const Editor = lazy(async () => {
  const module = await import('@/components/editor/RichTextEditor')
  return { default: module.RichTextEditor }
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
