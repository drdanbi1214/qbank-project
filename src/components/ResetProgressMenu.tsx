import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { resetProgress } from '@/lib/queries/questions'
import { useData } from '@/lib/data'

type Props = {
  label: string
  scope: { subjectId?: string; unitId?: string; examId?: string }
}

/**
 * 진행 초기화. 물리 삭제가 아니라 attempts.is_active = false 로 바꾼다.
 * 누적 풀이 횟수는 그대로 남는다.
 */
export function ResetProgressMenu({ label, scope }: Props) {
  const { refreshProgress } = useData()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  async function run() {
    setBusy(true)
    try {
      const count = await resetProgress(scope)
      setDone(count)
      refreshProgress()
    } catch (error) {
      console.error('진행 초기화에 실패했습니다.', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`${label} 메뉴`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
          setDone(null)
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span aria-hidden className="text-lg leading-none">
          ⋯
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg dark:bg-slate-900">
            <h2 className="text-base font-semibold">{label} 진행 초기화</h2>

            {done === null ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  이 범위의 문제를 안 푼 상태로 되돌립니다. 기록 자체는 지워지지 않아 누적
                  풀이 횟수는 그대로 유지됩니다.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                    취소
                  </Button>
                  <Button variant="danger" onClick={() => void run()} disabled={busy}>
                    초기화
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {done}건의 풀이 기록을 안 푼 상태로 되돌렸습니다.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => setOpen(false)}>확인</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
