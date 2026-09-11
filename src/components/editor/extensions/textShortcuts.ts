import { Extension, textInputRule } from '@tiptap/core'
import { TEXT_SHORTCUT_RULES } from '@/components/editor/extensions/textShortcutRules'

/**
 * 모든 서식 편집기에서 쓰는 짧은 기호 입력 명령.
 * `/야마` 같은 삽입 명령은 입력 중 후보를 보여 주는 SlashCommandMenu가 맡는다.
 *
 * 규칙 표는 textShortcutRules 에 있다. 순서가 곧 동작이라 테스트로 묶어 두었다.
 */
export const TextShortcuts = Extension.create({
  name: 'textShortcuts',

  addInputRules() {
    return TEXT_SHORTCUT_RULES.map((rule) => textInputRule({ find: rule.find, replace: rule.replace }))
  },
})
