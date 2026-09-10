import { Extension, InputRule, textInputRule, type Editor } from '@tiptap/core'

type TextShortcutOptions = {
  onRequestTheory: ((editor: Editor) => void) | null
  onRequestLecture: ((editor: Editor) => void) | null
}

/**
 * 모든 서식 편집기에서 쓰는 짧은 입력 명령.
 *
 * 한글 명령은 IME 조합이 끝난 뒤에도 Tiptap input rule 이 다시 검사하므로
 * `/알렌`, `/강의록`의 마지막 글자가 완성되는 즉시 선택창을 열 수 있다.
 */
export const TextShortcuts = Extension.create<TextShortcutOptions>({
  name: 'textShortcuts',

  addOptions() {
    return {
      onRequestTheory: null,
      onRequestLecture: null,
    }
  },

  addInputRules() {
    const rules: InputRule[] = [
      textInputRule({
        find: /->$/,
        replace: '→',
      }),
    ]

    if (this.options.onRequestTheory) {
      rules.push(commandInputRule('/알렌', () => this.options.onRequestTheory?.(this.editor)))
    }
    if (this.options.onRequestLecture) {
      rules.push(commandInputRule('/강의록', () => this.options.onRequestLecture?.(this.editor)))
    }

    return rules
  },
})

/**
 * 문단 처음이나 공백 뒤에서만 슬래시 명령을 인식한다. URL이나 본문 중간의
 * 슬래시는 건드리지 않고, 명령 글자만 지운 뒤 원래 도구 모음 동작을 호출한다.
 */
function commandInputRule(command: string, run: () => void) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const find = new RegExp(`(?:^|\\s)(${escaped})$`)

  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const matchedCommand = match[1]
      if (!matchedCommand) return null

      // handleTextInput 시점에는 방금 친 글자가 아직 문서에 없지만,
      // compositionend 시점에는 명령 전체가 이미 들어 있다. match 안에서 명령이
      // 시작한 위치를 기준으로 잡으면 두 경우 모두 앞 공백은 남고 명령만 지워진다.
      const commandStart = range.from + match[0].length - matchedCommand.length
      state.tr.delete(commandStart, range.to)
      // input rule 의 삭제 transaction 이 먼저 반영된 뒤 선택창을 연다.
      queueMicrotask(run)
    },
    undoable: false,
  })
}
