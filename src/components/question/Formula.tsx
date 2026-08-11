import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type Props = {
  latex: string
  display?: boolean
}

export function Formula({ latex, display = true }: Props) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        // 복기 데이터의 수식이 깨져 있어도 화면 전체가 죽지 않도록 원문을 보여준다.
        errorColor: '#e11d48',
        output: 'htmlAndMathml',
      }),
    [latex, display],
  )

  return (
    <span
      className={display ? 'block overflow-x-auto py-1' : 'inline-block'}
      // KaTeX 가 생성한 마크업이라 신뢰할 수 있다.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
