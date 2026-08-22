import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BRAND_NAME, BRAND_NAME_CLASSNAME, BrandMark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'

export function ResetPasswordPage() {
  const { session, loading, updatePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== confirmPassword) {
      setError('새 비밀번호가 서로 일치하지 않습니다.')
      return
    }

    setBusy(true)
    try {
      await updatePassword(password)
      await signOut()
      navigate('/login', {
        replace: true,
        state: { notice: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' },
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '비밀번호를 변경하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-3 h-14 w-14 text-lg" />
          <h1 className={cn('text-2xl', BRAND_NAME_CLASSNAME)}>{BRAND_NAME}</h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-bold">새 비밀번호 설정</h2>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : !session ? (
            <div className="mt-3">
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                재설정 링크가 만료됐거나 올바르지 않습니다. 로그인 화면에서 새 링크를
                요청해주세요.
              </p>
              <Link
                to="/login"
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                로그인으로 돌아가기
              </Link>
            </div>
          ) : (
            <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-3">
              <div>
                <label htmlFor="newPassword" className="mb-1 block text-sm font-medium">
                  새 비밀번호
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
                  새 비밀번호 확인
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>

              {error && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" block disabled={busy}>
                {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                비밀번호 변경하기
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
