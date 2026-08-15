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
import { type PermissionKey } from '@/lib/permissions'

type AuthState = {
  session: Session | null
  profile: Profile | null
  /** 세션과 프로필을 처음 확인하는 동안 true */
  loading: boolean
  /** 로그인했지만 관리자 승인 전이라 모든 쓰기가 막힌 상태 */
  isPending: boolean
  isAdmin: boolean
  permissions: PermissionKey[]
  hasPermission: (permission: PermissionKey) => boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (patch: ProfilePatch) => Promise<void>
  dismissWelcomePopup: () => Promise<void>
}

export type ProfilePatch = Partial<
  Pick<
    Profile,
    | 'display_name'
    | 'cohort'
    | 'avatar_url'
    | 'theme'
    | 'font_scale'
    | 'welcome_popup_dismissed'
    | 'default_solution_permission'
  >
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

async function fetchPermissions(userId: string): Promise<PermissionKey[]> {
  const { data, error } = await supabase
    .from('profile_permissions')
    .select('permission_key')
    .eq('profile_id', userId)

  if (error) {
    console.error('콘텐츠 권한을 불러오지 못했습니다.', error)
    return []
  }
  // 권한 키는 DB 에서 늘어날 수 있으므로 코드 목록으로 거르지 않는다.
  return (data ?? []).map((row) => row.permission_key)
}

type Account = { profile: Profile | null; permissions: PermissionKey[] }

async function fetchAccount(userId: string): Promise<Account> {
  const [profile, permissions] = await Promise.all([
    fetchProfile(userId),
    fetchPermissions(userId),
  ])
  return { profile, permissions }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [permissions, setPermissions] = useState<PermissionKey[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * getSession() 과 onAuthStateChange 가 같은 사용자에 대해 거의 동시에 들어온다.
   * 진행 중인 조회를 공유해서, 두 경로 모두 프로필이 실제로 도착한 뒤에만
   * loading 을 내리도록 한다. 그러지 않으면 프로필이 아직 null 인 상태로
   * 권한 가드가 판정해 관리자가 /admin 에서 튕겨난다.
   */
  const profileRequest = useRef<{ userId: string; promise: Promise<Account> } | null>(null)

  useEffect(() => {
    let active = true

    async function syncProfile(next: Session | null) {
      if (!next) {
        profileRequest.current = null
        if (active) {
          setProfile(null)
          setPermissions([])
          setLoading(false)
        }
        return
      }

      const userId = next.user.id
      if (profileRequest.current?.userId !== userId) {
        profileRequest.current = { userId, promise: fetchAccount(userId) }
      }

      const request = profileRequest.current
      const loaded = await request.promise

      // 그 사이 사용자가 바뀌었으면 낡은 응답은 버린다.
      if (!active || profileRequest.current !== request) return
      // 이 ref는 getSession과 최초 auth 이벤트가 동시에 요청하는 경우만 합치기
      // 위한 것이다. 완료된 응답을 계속 보관하면 TOKEN_REFRESHED 같은 이후
      // 인증 이벤트에서 로그인 당시의 오래된 테마/글자 크기를 다시 적용한다.
      profileRequest.current = null
      setProfile(loaded.profile)
      setPermissions(loaded.permissions)
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
    const loaded = await fetchAccount(userId)
    setProfile(loaded.profile)
    setPermissions(loaded.permissions)
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
    setPermissions([])
    profileRequest.current = null
  }, [])

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      const userId = session?.user.id
      if (!userId) return
      // 낙관적 반영 후 저장
      setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
      // UPDATE가 RLS에서 0행으로 끝난 경우도 성공처럼 보이지 않도록 갱신된
      // 프로필 한 행을 반드시 돌려받아 저장 여부를 확인한다.
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select('*')
        .single()
      if (error) {
        await refreshProfile()
        throw error
      }
      setProfile(data)
    },
    [session?.user.id, refreshProfile],
  )

  const dismissWelcomePopup = useCallback(async () => {
    const userId = session?.user.id
    if (!userId) throw new Error('로그인이 필요합니다.')

    const { data, error } = await supabase.rpc('dismiss_welcome_popup')
    if (error) throw error
    if (data !== true) throw new Error('안내창 설정을 저장하지 못했습니다.')

    // 서버 저장이 확인된 뒤에만 화면 상태도 바꾼다.
    setProfile((prev) => (prev ? { ...prev, welcome_popup_dismissed: true } : prev))
  }, [session?.user.id])

  const value = useMemo<AuthState>(
    () => {
      const permissionSet = new Set(permissions)
      return {
        session,
        profile,
        loading,
        isPending: Boolean(session) && profile?.is_suspended === true,
        isAdmin: profile?.role === 'admin',
        permissions,
        hasPermission: (permission: PermissionKey) => permissionSet.has(permission),
        signIn,
        signUp,
        signOut,
        refreshProfile,
        updateProfile,
        dismissWelcomePopup,
      }
    },
    [
      session,
      profile,
      permissions,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      updateProfile,
      dismissWelcomePopup,
    ],
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
