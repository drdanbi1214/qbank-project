import { HIGHLIGHT_STYLES, type MarkStyle } from '@/components/marking/marks'
import { cn } from '@/utils/cn'

const SWATCH: Record<string, string> = {
  yellow: 'bg-amber-300',
  green: 'bg-emerald-300',
  sky: 'bg-sky-300',
  pink: 'bg-pink-300',
}

const SWATCH_LABEL: Record<string, string> = {
  yellow: '노랑 형광펜',
  green: '초록 형광펜',
  sky: '하늘 형광펜',
  pink: '분홍 형광펜',
}

type Props = {
  /** 선택 영역의 화면 좌표. 이 위에 툴바를 띄운다. */
  rect: DOMRect
  onPick: (style: MarkStyle) => void
  onErase: () => void
  /** 질문하기. 제공되지 않으면 Q 버튼을 숨긴다. */
  onAsk?: () => void
}

/**
 * 텍스트를 드래그하면 뜨는 서식 툴바.
 * 형광펜 4색, 빨간 글씨, 굵은 글씨, 질문, 지우개 순으로 가로 배치한다.
 */
export function MarkToolbar({ rect, onPick, onErase, onAsk }: Props) {
  // 화면 위쪽에 공간이 없으면 선택 영역 아래로 내린다.
  const above = rect.top > 60
  const top = above ? rect.top - 48 : rect.bottom + 8
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, 130),
    Math.max(window.innerWidth - 130, 130),
  )

  return (
    <div
      // 선택이 풀리지 않도록 눌림 자체를 막는다.
      onMouseDown={(event) => event.preventDefault()}
      onTouchStart={(event) => event.preventDefault()}
      style={{ top, left, transform: 'translateX(-50%)' }}
      className="fixed z-50 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      {HIGHLIGHT_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          title={SWATCH_LABEL[style]}
          aria-label={SWATCH_LABEL[style]}
          onClick={() => onPick(style)}
          className={cn(
            'h-7 w-7 rounded-md border border-black/10 transition-transform hover:scale-110',
            SWATCH[style],
          )}
        />
      ))}

      <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-600" />

      <button
        type="button"
        title="빨간 글씨"
        aria-label="빨간 글씨"
        onClick={() => onPick('red')}
        className="h-7 w-7 rounded-md text-base font-semibold text-marker-red transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        A
      </button>
      <button
        type="button"
        title="굵은 글씨"
        aria-label="굵은 글씨"
        onClick={() => onPick('bold')}
        className="h-7 w-7 rounded-md text-base font-bold transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        A
      </button>

      {onAsk && (
        <button
          type="button"
          title="이 부분에 질문하기"
          aria-label="이 부분에 질문하기"
          onClick={onAsk}
          className="h-7 w-7 rounded-md text-base font-bold text-brand-600 transition-colors hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-700"
        >
          Q
        </button>
      )}

      <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-600" />

      <button
        type="button"
        title="표시 지우기"
        aria-label="표시 지우기"
        onClick={onErase}
        className="h-7 w-7 rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <svg viewBox="0 0 24 24" fill="none" className="mx-auto h-4 w-4">
          <path
            d="M8 20H21M4.5 16.5l3 3M16 4l4 4-9 9H7l-3-3z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
