import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { ONE_LINER_MAX, fetchProfileCards, type ProfileCard } from '@/lib/queries/profiles'

/** 가입자 전체의 프로필(사진/이름/한마디)을 보여주는 화면. 내 프로필이 맨 위에 뜨고, 한마디만 직접 수정할 수 있다. */
export function ProfilesPage() {
  const { profile, updateProfile } = useAuth()
  const [cards, setCards] = useState<ProfileCard[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [oneLiner, setOneLiner] = useState(profile?.one_liner ?? '')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchProfileCards()
      .then((next) => {
        if (active) setCards(next)
      })
      .catch((caught: unknown) => {
        if (active) {
          setLoadError(caught instanceof Error ? caught.message : '목록을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  const ordered = cards
    ? [...cards].sort((a, b) => {
        if (a.id === profile?.id) return -1
        if (b.id === profile?.id) return 1
        return a.displayName.localeCompare(b.displayName)
      })
    : null

  function startEditing() {
    setOneLiner(profile?.one_liner ?? '')
    setSaveError(null)
    setEditing(true)
  }

  async function saveOneLiner() {
    if (!profile) return
    setSaveError(null)
    setBusy(true)
    try {
      const trimmed = oneLiner.trim()
      await updateProfile({ one_liner: trimmed || null })
      setCards((prev) =>
        prev
          ? prev.map((card) =>
              card.id === profile.id ? { ...card, oneLiner: trimmed || null } : card,
            )
          : prev,
      )
      setEditing(false)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-bold">프로필 보기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          가입한 사람들의 프로필과 한마디를 볼 수 있습니다.
        </p>
      </header>

      {loadError && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {loadError}
        </p>
      )}

      {!ordered && !loadError && (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 border-slate-300 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300" />
        </div>
      )}

      {ordered && (
        <ul className="space-y-2">
          {ordered.map((card) => {
            const isMe = card.id === profile?.id
            return (
              <li
                key={card.id}
                className={
                  isMe
                    ? 'rounded-xl border border-brand-300 bg-brand-50/50 p-3 dark:border-brand-700 dark:bg-brand-900/20'
                    : 'rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900'
                }
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    path={card.avatarUrl}
                    name={card.displayName}
                    size={44}
                    enlargeOnClick
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {card.displayName}
                      {isMe && (
                        <span className="ml-1.5 text-xs font-normal text-brand-600 dark:text-brand-300">
                          나
                        </span>
                      )}
                    </p>

                    {isMe && editing ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={oneLiner}
                          onChange={(event) => setOneLiner(event.target.value)}
                          maxLength={ONE_LINER_MAX}
                          placeholder="한마디를 입력해보세요"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
                        />
                        <Button size="sm" disabled={busy} onClick={() => void saveOneLiner()}>
                          저장
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          취소
                        </Button>
                      </div>
                    ) : (
                      <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                        {card.oneLiner || (isMe ? '한마디를 등록해보세요.' : '')}
                      </p>
                    )}

                    {isMe && !editing && (
                      <button
                        type="button"
                        onClick={startEditing}
                        className="mt-0.5 text-xs text-brand-600 hover:underline dark:text-brand-300"
                      >
                        한마디 수정
                      </button>
                    )}

                    {isMe && saveError && (
                      <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{saveError}</p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
