import type { ReactNode } from 'react'

type Props = {
  title: string
  description: string
  phase: string
  children?: ReactNode
}

/**
 * Phase 1 에서는 라우팅과 레이아웃 셸까지만 구성한다.
 * 각 화면의 내용은 해당 Phase 에서 채운다.
 */
export function PagePlaceholder({ title, description, phase, children }: Props) {
  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </header>

      {children}

      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">{phase}에서 구현 예정입니다.</p>
      </div>
    </section>
  )
}
