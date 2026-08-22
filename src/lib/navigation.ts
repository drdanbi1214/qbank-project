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
  // 테마는 이론과 완전히 별개다. 이론은 Notion 에서 임포트한 교과 정리이고,
  // 테마는 스터디원이 주제 단위로 쓰고 야마를 붙이는 글이다.
  // 강의록은 활성 회원 전원이 본다. 이론과 달리 스터디 권한을 걸지 않는다.
  { to: '/lectures', label: '강의록', icon: 'theory' },
  { to: '/topics', label: '레옵스', icon: 'topic', permission: 'study_legendob' },
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
