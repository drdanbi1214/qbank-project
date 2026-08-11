import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/lib/auth'

export type Theme = 'light' | 'dark' | 'system'

const THEME_CACHE_KEY = 'qbank.theme.cache'
const FONT_CACHE_KEY = 'qbank.font.cache'

/** 글자 크기 배율의 허용 범위와 단계. DB check 제약과 맞춰둔다. */
export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.4
export const FONT_SCALE_STEP = 0.05

type ThemeState = {
  /** 사용자가 고른 설정값 */
  theme: Theme
  /** 실제 적용 중인 값 */
  resolved: 'light' | 'dark'
  setTheme: (next: Theme) => void
  toggle: () => void
  /** 본문 글자 크기 배율 */
  fontScale: number
  setFontScale: (next: number) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

/** DB 컬럼은 text 이므로 알려진 값만 통과시킨다. */
function asTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function readCache(): Theme {
  return asTheme(localStorage.getItem(THEME_CACHE_KEY)) ?? 'system'
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(value * 100) / 100))
}

function readFontCache(): number {
  return clampScale(Number(localStorage.getItem(FONT_CACHE_KEY) ?? '1'))
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * 테마 설정의 원본은 Supabase profiles.theme 이다. localStorage 는
 * 로그인 전이나 프로필을 받아오기 전 깜빡임을 막기 위한 캐시로만 쓴다.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile, session, updateProfile } = useAuth()
  const [localTheme, setLocalTheme] = useState<Theme>(() => readCache())
  const [localScale, setLocalScale] = useState<number>(() => readFontCache())
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark())

  const theme: Theme = asTheme(profile?.theme) ?? localTheme
  const fontScale = clampScale(profile?.font_scale ?? localScale)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' =
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.style.colorScheme = resolved
    localStorage.setItem(THEME_CACHE_KEY, theme)
  }, [resolved, theme])

  // 루트 글꼴 크기를 바꾸면 rem 기준인 화면 전체가 함께 커지고 작아진다.
  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontScale * 100).toFixed(0)}%`
    localStorage.setItem(FONT_CACHE_KEY, String(fontScale))
  }, [fontScale])

  const setTheme = useCallback(
    (next: Theme) => {
      setLocalTheme(next)
      localStorage.setItem(THEME_CACHE_KEY, next)
      if (session) {
        // 기기 간 동기화를 위해 프로필에 저장한다.
        void updateProfile({ theme: next }).catch((error: unknown) => {
          console.error('테마 설정을 저장하지 못했습니다.', error)
        })
      }
    },
    [session, updateProfile],
  )

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setTheme])

  const setFontScale = useCallback(
    (next: number) => {
      const value = clampScale(next)
      setLocalScale(value)
      localStorage.setItem(FONT_CACHE_KEY, String(value))
      if (session) {
        void updateProfile({ font_scale: value }).catch((error: unknown) => {
          console.error('글자 크기를 저장하지 못했습니다.', error)
        })
      }
    },
    [session, updateProfile],
  )

  const value = useMemo<ThemeState>(
    () => ({ theme, resolved, setTheme, toggle, fontScale, setFontScale }),
    [theme, resolved, setTheme, toggle, fontScale, setFontScale],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme 은 ThemeProvider 안에서만 사용할 수 있습니다.')
  }
  return context
}
