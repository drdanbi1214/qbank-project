import type { IconName } from '@/components/ui/Icon'

/**
 * 과목마다 다른 아이콘과 색을 준다. 목록에서 아이콘이 전부 같으면 과목을
 * 이름으로만 구별해야 해서 눈이 느리다.
 *
 * Tailwind 는 소스에 그대로 적힌 클래스만 만들어 내므로 색을 조합해서
 * 만들지 말고 완성된 문자열로 둔다.
 */
export type SubjectVisual = {
  icon: IconName
  /** 아이콘 배지의 배경/글자색 */
  tint: string
}

const BY_CODE: Record<string, SubjectVisual> = {
  '01': { icon: 'stethoscope', tint: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200' },
  '02': { icon: 'scalpel', tint: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200' },
  '03': { icon: 'venus', tint: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-200' },
  '04': { icon: 'teddy', tint: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200' },
  '05': { icon: 'mood', tint: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200' },
  '06': { icon: 'brain', tint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200' },
  '07': { icon: 'bone', tint: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200' },
  '08': { icon: 'scan', tint: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-200' },
  '09': { icon: 'flask', tint: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200' },
}

// 과목 코드가 비어 있어도 이름으로 찾을 수 있게 둔다.
const BY_NAME: Record<string, string> = {
  내과: '01',
  외과: '02',
  산부인과: '03',
  소아청소년과: '04',
  정신건강의학과: '05',
  신경과: '06',
  정형외과: '07',
  영상의학과: '08',
  진단검사의학과: '09',
}

const FALLBACK: SubjectVisual = {
  icon: 'topic',
  tint: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
}

export function subjectVisual(subject: { code?: string | null; name: string }): SubjectVisual {
  const code = subject.code ?? BY_NAME[subject.name]
  return (code && BY_CODE[code]) || FALLBACK
}
