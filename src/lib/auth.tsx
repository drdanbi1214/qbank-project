import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from '@/lib/supabase'

type AuthState = {
  session: Session | null
  profile: Profile | null
  /** 세션과 프로필을 처음 확인하는 동안 true */
  loading: boolean
  /** 로그인했지만 관리자 승인 전이라 모든 쓰기가 막힌 상태 */
  isPending: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (patch: ProfilePatch) => Promise<void>
}

export type ProfilePatch = Partial<
  Pick<Profile, 'display_name' | 'cohort' | 'avatar_url' | 'theme' | 'font_scale'>
>

const AuthContext = createContext<AuthState | null>(null)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('프로필을 불러오지 못했습니다.', error)
    return null
  }
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * getSession() 과 onAuthStateChange 가 같은 사용자에 대해 거의 동시에 들어온다.
   * 진행 중인 조회를 공유해서, 두 경로 모두 프로필이 실제로 도착한 뒤에만
   * loading 을 내리도록 한다. 그러지 않으면 프로필이 아직 null 인 상태로
   * 권한 가드가 판정해 관리자가 /admin 에서 튕겨난다.
   */
  const profileRequest = useRef<{ userId: string; promise: Promise<Profile | null> } | null>(null)

  useEffect(() => {
    let active = true

    async function syncProfile(next: Session | null) {
      if (!next) {
        profileRequest.current = null
        if (active) {
          setProfile(null)
          setLoading(false)
        }
        return
      }

      const userId = next.user.id
      if (profileRequest.current?.userId !== userId) {
        profileRequest.current = { userId, promise: fetchProfile(userId) }
      }

      const request = profileRequest.current
      const loaded = await request.promise

      // 그 사이 사용자가 바뀌었으면 낡은 응답은 버린다.
      if (!active || profileRequest.current !== request) return
      setProfile(loaded)
      setLoading(false)
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      void syncProfile(data.session)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next)
      void syncProfile(next)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const userId = session?.user.id
    if (!userId) return
    setProfile(await fetchProfile(userId))
  }, [session?.user.id])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      })
      if (error) throw error
    },
    [],
  )

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setProfile(null)
    profileRequest.current = null
  }, [])

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      const userId = session?.user.id
      if (!userId) return
      // 낙관적 반영 후 저장
      setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
      if (error) {
        await refreshProfile()
        throw error
      }
    },
    [session?.user.id, refreshProfile],
  )

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      isPending: Boolean(session) && profile?.is_suspended === true,
      isAdmin: profile?.role === 'admin',
      signIn,
      signUp,
      signOut,
      refreshProfile,
      updateProfile,
    }),
    [session, profile, loading, signIn, signUp, signOut, refreshProfile, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 는 AuthProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}
