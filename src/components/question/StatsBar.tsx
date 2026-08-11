import type { QuestionStats } from '@/types/question'

/**
 * 정답 확인 후 표시하는 요약.
 * 누적 풀이 횟수는 내 계정 기준이다. 전체 정답률과 평균 풀이 시간은
 * 집계 자체는 유지하되 풀이 화면에서는 보여주지 않는다.
 */
export function StatsBar({ stats }: { stats: QuestionStats }) {
  return (
    <div className="border-l-4 border-brand-600 bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        내 누적 풀이 횟수{' '}
        <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
          {stats.myAttempts}회
        </span>
      </p>
    </div>
  )
}
