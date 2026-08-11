/**
 * 최종 업데이트 시각.
 *
 * __BUILD_TIME__ 은 vite.config.ts 의 define 에서 빌드 시점에 문자열로 굳혀
 * 넣는다. Vercel 이 커밋마다 새로 빌드하므로, 배포될 때마다 이 값도 저절로
 * 최신 빌드 시각으로 바뀐다. 따로 손으로 갱신할 곳이 없다.
 */
export function BuildFooter() {
  const label = new Date(__BUILD_TIME__).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <p className="mt-6 text-center text-[10px] text-slate-400 dark:text-slate-600">
      최종 업데이트 {label}
    </p>
  )
}
