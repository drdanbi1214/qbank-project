/**
 * 짧은 기호 입력 명령 표.
 *
 * 편집기와 떼어 두는 이유가 있다. 이 규칙들은 글자를 하나 칠 때마다 위에서부터
 * 검사해 처음 맞는 것 하나만 적용된다. 그래서 순서와 "이미 바뀐 기호에 이어
 * 치는 경우"까지 맞물려야 하는데, 그것은 편집기를 띄우지 않고도 확인할 수 있는
 * 성질이다. tests/text-shortcuts.test.mjs 가 이 표를 그대로 가져다 쓴다.
 */
export type TextShortcutRule = { find: RegExp; replace: string }

export const TEXT_SHORTCUT_RULES: TextShortcutRule[] = [
  // 한 글자씩 칠 때는 `<-` 가 먼저 ← 로 바뀌어 버려서 `<->` 규칙에는 영영
  // 닿지 못한다. 바뀐 뒤의 모양(`←>`)을 받아 주어야 ↔ 로 이어진다.
  // 아래 `<->` 는 붙여넣기처럼 한 번에 들어오는 경우를 위해 남겨 둔다.
  { find: /←>$/, replace: '↔' },
  { find: /<->$/, replace: '↔' },
  // `\>=` 도 마찬가지다. `>` 에서 먼저 ↘ 가 되어 버리므로 그 뒤의 `=` 를 받는다.
  // `\\>=` 도 ↘ 를 거쳐 오므로 이 한 줄로 함께 이어진다.
  { find: /↘=$/, replace: '≥' },
  { find: /<-$/, replace: '←' },
  { find: /->$/, replace: '→' },
  { find: /<=$/, replace: '≤' },
  { find: /=\/=$/, replace: '≠' },
  { find: /\+-$/, replace: '±' },
  { find: /\\~=$/, replace: '≈' },
  // 채팅/마크다운에서 기호 앞에 역슬래시를 붙여 적는 경우도 같은 명령으로 받는다.
  { find: /\\=>$/, replace: '⇒' },
  { find: /=>$/, replace: '⇒' },
  { find: /\\\\>=$/, replace: '≥' },
  { find: /\\>=$/, replace: '≥' },
  { find: /\/>$/, replace: '↗' },
  { find: /\\\\>$/, replace: '↘' },
  { find: /\\>$/, replace: '↘' },
]

/**
 * 한 글자씩 이어 쳤을 때 남는 결과. 편집기의 입력 규칙과 같은 방식으로
 * — 글자를 붙일 때마다 위에서부터 처음 맞는 규칙 하나만 적용한다 — 흉내 낸다.
 */
export function applyTextShortcuts(typed: string): string {
  let text = ''
  for (const character of typed) {
    text += character
    for (const rule of TEXT_SHORTCUT_RULES) {
      const match = rule.find.exec(text)
      if (match) {
        text = text.slice(0, match.index) + rule.replace
        break
      }
    }
  }
  return text
}
