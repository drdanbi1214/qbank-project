import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { isChunkLoadError, reloadOnce } from '@/utils/reloadOnChunkError'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * 렌더링 중 예외가 나도 흰 화면 대신 원인을 보여준다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면을 렌더링하지 못했습니다.', error, info.componentStack)

    // lazy() 내부뿐 아니라, 이미 실패한 lazy import가 React에 의해 다시
    // 던져지는 경우도 여기까지 온다. 배포 교체로 인한 청크 불일치라면
    // 사용자에게 오류 화면을 보이기 전에 최신 배포본으로 한 번 복구한다.
    if (isChunkLoadError(error)) reloadOnce()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-lg text-center">
          <h1 className="text-lg font-bold">화면을 표시하지 못했습니다</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            아래 오류 내용과 함께 문의해주세요.
          </p>
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-rose-700 dark:bg-slate-900 dark:text-rose-300">
            {error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}>다시 시도</Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              새로고침
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
