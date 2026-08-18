import type { SVGProps } from 'react'

export type IconName =
  | 'study'
  | 'theory'
  | 'topic'
  | 'exam'
  | 'wrong-note'
  | 'board'
  | 'clipboard'
  | 'bell'
  | 'megaphone'
  | 'shield'
  | 'user'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'close'
  | 'chevron-right'
  | 'logout'
  | 'search'
  | 'shuffle'

const PATHS: Record<IconName, string> = {
  study: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20',
  theory: 'M3 5a2 2 0 0 1 2-2h6a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H3zM21 5a2 2 0 0 0-2-2h-5v18a3 3 0 0 1 3-3h4z',
  // 한 주제 아래에 야마가 쌓이는 모양이라 겹친 층으로 그린다. 이론(펼친 책)과 헷갈리지 않는다.
  topic: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  exam: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M9 8h6M9 12h6M9 16h3',
  'wrong-note': 'M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M14 3v6h6M10 12l4 4M14 12l-4 4',
  clipboard: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4',
  board: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12',
  bell: 'M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M13.7 20a2 2 0 0 1-3.4 0',
  megaphone: 'M4 10v4h3l7 4V6l-7 4zM18 9a3 3 0 0 1 0 6',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-right': 'M9 6l6 6-6 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
}

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
