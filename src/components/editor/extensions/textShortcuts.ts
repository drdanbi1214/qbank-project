import { Extension, textInputRule } from '@tiptap/core'

/**
 * 모든 서식 편집기에서 쓰는 짧은 기호 입력 명령.
 * `/야마` 같은 삽입 명령은 입력 중 후보를 보여 주는 SlashCommandMenu가 맡는다.
 */
export const TextShortcuts = Extension.create({
  name: 'textShortcuts',

  addInputRules() {
    return [
      // 더 긴 규칙을 먼저 검사해야 `<->`의 뒤쪽 `->`만 화살표로 바뀌지 않는다.
      textShortcut(/<->$/, '↔'),
      textShortcut(/->$/, '→'),
      // 채팅/마크다운에서 기호 앞에 역슬래시를 붙여 적는 경우도 같은 명령으로 받는다.
      textShortcut(/\\=>$/, '⇒'),
      textShortcut(/=>$/, '⇒'),
      textShortcut(/\/>$/, '↗'),
      textShortcut(/\\\\>$/, '↘'),
      textShortcut(/\\>$/, '↘'),
    ]
  },
})

function textShortcut(find: RegExp, replace: string) {
  return textInputRule({ find, replace })
}
