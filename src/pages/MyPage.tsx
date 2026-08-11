import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  isNicknameAvailable,
  validateNickname,
} from '@/lib/queries/profiles'
import { fetchMySummary, type MySummary } from '@/lib/queries/study'
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  useTheme,
} from '@/lib/theme'
import { uploadAvatar } from '@/lib/uploads'

/** 마이페이지. 프로필 편집과 학습 통계를 함께 보여준다. */
export function MyPage() {
  const { profile, updateProfile } = useAuth()
  const { fontScale, setFontScale, theme, setTheme } = useTheme()

  const [nickname, setNickname] = useState(profile?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState<MySummary | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void fetchMySummary()
      .then((next) => {
        if (active) setSummary(next)
      })
      .catch((caught: unknown) => console.error('통계를 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900'

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const trimmed = nickname.trim()
    const invalid = validateNickname(trimmed)
    if (invalid) {
      setError(invalid)
      return
    }

    setBusy(true)
    try {
      const changed = trimmed.toLowerCase() !== (profile?.display_name ?? '').toLowerCase()
      if (changed && !(await isNicknameAvailable(trimmed))) {
        setError('이미 사용 중인 닉네임입니다.')
        return
      }
      await updateProfile({ display_name: trimmed })
      setMessage('저장했습니다.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function pickAvatar(file: File) {
    if (!profile) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const path = await uploadAvatar(file, profile.id)
      await updateProfile({ avatar_url: path })
      setMessage('프로필 사진을 바꿨습니다.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 올리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const accuracy =
    summary && summary.solved > 0 ? Math.round((summary.correct / summary.solved) * 100) : null
  const progress =
    summary && summary.totalQuestions > 0
      ? Math.round((summary.solved / summary.totalQuestions) * 100)
      : 0

  return (
    <section className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-xl font-bold">마이페이지</h1>
      </header>

      {/* 프로필 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-4">
          <Avatar path={profile?.avatar_url} name={profile?.display_name} size={72} />
          <div className="min-w-0">
            <p className="font-semibold">{profile?.display_name}</p>
            <p className="truncate text-sm text-slate-500 dark:text-slate-400">
              {profile?.email}
            </p>
            <div className="mt-2 flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                사진 변경
              </Button>
              {profile?.avatar_url && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void updateProfile({ avatar_url: null })
                      .then(() => setMessage('프로필 사진을 지웠습니다.'))
                      .catch((caught: unknown) =>
                        setError(
                          caught instanceof Error ? caught.message : '지우지 못했습니다.',
                        ),
                      )
                  }}
                >
                  사진 삭제
                </Button>
              )}
            </div>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void pickAvatar(file)
            event.target.value = ''
          }}
        />

        <form onSubmit={(event) => void save(event)} className="mt-4 space-y-3">
          <div>
            <label htmlFor="nickname" className="mb-1 block text-sm font-medium">
              닉네임
            </label>
            <input
              id="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              minLength={NICKNAME_MIN}
              maxLength={NICKNAME_MAX}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              풀이와 댓글에 표시되는 이름입니다.
            </p>
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
              {message}
            </p>
          )}

          <Button type="submit" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            저장
          </Button>
        </form>
      </div>

      {/* 화면 설정 */}
      <div>
        <h2 className="mb-2 text-base font-bold">화면 설정</h2>
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">글자 크기</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                aria-label="글자 작게"
                disabled={fontScale <= FONT_SCALE_MIN}
                onClick={() => setFontScale(fontScale - FONT_SCALE_STEP)}
              >
                −
              </Button>
              <span className="w-14 text-center text-sm tabular-nums">
                {Math.round(fontScale * 100)}%
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label="글자 크게"
                disabled={fontScale >= FONT_SCALE_MAX}
                onClick={() => setFontScale(fontScale + FONT_SCALE_STEP)}
              >
                +
              </Button>
              {fontScale !== 1 && (
                <Button size="sm" variant="ghost" onClick={() => setFontScale(1)}>
                  기본값
                </Button>
              )}
            </div>
          </div>

          <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
            미리보기, 이 문장의 크기로 문제와 풀이가 표시됩니다.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">화면 모드</span>
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              {(['light', 'dark', 'system'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={
                    theme === value
                      ? 'rounded-md bg-white px-3 py-1 text-sm font-medium shadow-sm dark:bg-slate-700'
                      : 'rounded-md px-3 py-1 text-sm text-slate-500 dark:text-slate-400'
                  }
                >
                  {value === 'light' ? '밝게' : value === 'dark' ? '어둡게' : '시스템'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 학습 통계 */}
      {summary && (
        <>
          <div>
            <h2 className="mb-2 text-base font-bold">학습 현황</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="푼 문제" value={`${summary.solved}`} sub={`/ ${summary.totalQuestions}`} />
              <Stat label="정답률" value={accuracy === null ? '-' : `${accuracy}%`} />
              <Stat label="연속 학습" value={`${summary.streakDays}일`} />
              <Stat label="받은 추천" value={`${summary.upvotesReceived}`} />
            </div>

            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>전체 진행률</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold">약점 단원</h2>
            {summary.weakUnits.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                아직 판단할 만큼 기록이 쌓이지 않았습니다. 단원별로 3문제 이상 풀면 나타납니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.weakUnits.map((unit) => (
                  <li
                    key={unit.unitId}
                    className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span>
                        <span className="text-slate-400">{unit.subjectName} </span>
                        <span className="font-medium">{unit.unitName}</span>
                      </span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">
                        정답률 {unit.accuracy}% ({unit.attempts}회)
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{ width: `${100 - unit.accuracy}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold">내가 쓴 풀이</h2>
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
              풀이 {summary.solutionCount}개를 작성했고 추천 {summary.upvotesReceived}개를
              받았습니다.{' '}
              <Link to="/assignments" className="text-brand-600 hover:underline dark:text-brand-300">
                배정된 문항 보기
              </Link>
            </p>
          </div>
        </>
      )}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">
        {value}
        {sub && (
          <span className="ml-1 text-xs font-normal text-slate-400">{sub}</span>
        )}
      </p>
    </div>
  )
}
