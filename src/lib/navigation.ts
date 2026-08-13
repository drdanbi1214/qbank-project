import type { IconName } from '@/components/ui/Icon'
import type { PermissionKey } from '@/lib/permissions'

export type NavItem = {
  to: string
  label: string
  icon: IconName
  adminOnly?: boolean
  permission?: PermissionKey
}

/** 웹 상단 메인 네비게이션 */
export const MAIN_NAV: NavItem[] = [
  { to: '/study', label: '학습하기', icon: 'study' },
  { to: '/theory', label: '이론 보기', icon: 'theory', permission: 'study_hapbon3' },
  { to: '/exams', label: '시험별', icon: 'exam' },
  { to: '/assignments', label: '풀이 배정', icon: 'clipboard' },
  { to: '/wrong-notes', label: '오답노트', icon: 'wrong-note' },
  { to: '/search', label: '검색', icon: 'search' },
  { to: '/discussions', label: '게시판', icon: 'board' },
  { to: '/announcements', label: '공지사항', icon: 'megaphone' },
  { to: '/admin', label: '관리자', icon: 'shield', adminOnly: true },
]

/** 모바일 하단 탭바 */
export const MOBILE_NAV: NavItem[] = [
  { to: '/study', label: '학습', icon: 'study' },
  { to: '/theory', label: '이론', icon: 'theory', permission: 'study_hapbon3' },
  { to: '/assignments', label: '풀이 배정', icon: 'clipboard' },
  { to: '/discussions', label: '게시판', icon: 'board' },
  { to: '/notifications', label: '알림', icon: 'bell' },
  { to: '/me', label: '내정보', icon: 'user' },
]
