import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  isNicknameAvailable,
  validateNickname,
} from '@/lib/queries/profiles'
import { cn } from '@/utils/cn'
import { BRAND_NAME, BRAND_NAME_CLASSNAME, BrandMark } from '@/components/ui/BrandMark'

type Mode = 'signin' | 'signup'

export function LoginPage() {
  const { session, loading, signIn, signUp } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/study'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        const nickname = displayName.trim()
        const invalid = validateNickname(nickname)
        if (invalid) {
          setError(invalid)
          return
        }
        if (!(await isNicknameAvailable(nickname))) {
          setError('이미 사용 중인 닉네임입니다.')
          return
        }

        await signUp(email.trim(), password, nickname)
        setNotice(
          '가입 요청이 접수되었습니다. 관리자 승인이 완료되면 이용할 수 있습니다.',
        )
        setMode('signin')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '요청을 처리하지 못했습니다.')
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

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          {(['signin', 'signup'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value)
                setError(null)
              }}
              className={cn(
                'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
                mode === value
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {value === 'signin' ? '로그인' : '가입 요청'}
            </button>
          ))}
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
                닉네임
              </label>
              <input
                id="displayName"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="nickname"
                minLength={NICKNAME_MIN}
                maxLength={NICKNAME_MAX}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                풀이와 댓글에 표시됩니다. {NICKNAME_MIN}~{NICKNAME_MAX}자, 공백 없이
                입력해주세요.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              이메일
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className={inputClass}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              {notice}
            </p>
          )}

          <Button type="submit" size="lg" block disabled={busy}>
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            {mode === 'signin' ? '로그인' : '가입 요청 보내기'}
          </Button>
        </form>
      </div>
    </div>
  )
}
