import { Link } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'

const TOOLS: { to: string | null; title: string; description: string; phase?: string }[] = [
  {
    to: '/admin/questions',
    title: '문제 관리',
    description: '문제를 등록하고 고칩니다. 본문 블록, 보기, 정답을 편집합니다.',
  },
  {
    to: '/admin/labeling',
    title: '단원 라벨링 큐',
    description: '단원이 비어 있는 문항을 모아 한 번에 분류합니다.',
  },
  {
    to: '/admin/assignments',
    title: '배정 관리',
    description: '문항을 골라 담당자에게 배정하고 진행률을 확인합니다.',
  },
  {
    to: '/admin/users',
    title: '사용자 관리',
    description: '가입 승인, 정지, 관리자 권한을 다룹니다.',
  },
  {
    to: '/admin/visibility',
    title: '공개 범위 관리',
    description: '학번별로 문제를 열고 잠급니다. 스터디 그룹도 여기서 만듭니다.',
  },
  {
    to: '/admin/reports',
    title: '신고 처리함',
    description: '신고된 문제와 글을 확인하고 처리합니다.',
  },
  {
    to: '/admin/revisions',
    title: '최근 변경',
    description: '전체 편집 이력을 보고 문제를 되돌립니다.',
  },
  {
    to: '/admin/stats',
    title: '통계',
    description: '회원, 문제, 손볼 곳을 한눈에 봅니다.',
  },
  {
    to: '/admin/review',
    title: 'PDF 검수',
    description: '원본 PDF 를 옆에 띄우고 본문과 보기를 옮겨 적습니다.',
  },
  {
    to: '/admin/upload',
    title: 'CSV 일괄 업로드',
    description: '엑셀로 정리한 문항을 한 번에 등록합니다.',
  },
]

export function AdminHomePage() {
  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">관리자</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            편집과 운영 도구입니다.
          </p>
        </header>

        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((tool) => {
            const body = (
              <>
                <h2 className="font-semibold">{tool.title}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {tool.description}
                </p>
                {tool.phase && (
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    {tool.phase}
                  </p>
                )}
              </>
            )

            return (
              <li key={tool.title}>
                {tool.to ? (
                  <Link
                    to={tool.to}
                    className="block h-full rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="h-full rounded-xl border border-dashed border-slate-300 p-4 opacity-70 dark:border-slate-700">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </DesktopOnly>
  )
}
