/* eslint-disable react-refresh/only-export-components -- 컨텍스트와 훅은 한 파일에 두는 편이 읽기 쉽다. */
import { createContext, useContext, type ReactNode } from 'react'

type TopicScope = {
  /** 테마를 처음 쓴 사람. 야마 카드는 이 사람의 해설만 보여준다. */
  authorId: string | null
  /** 해설을 새로 쓸 때 걸어 줄 공개 범위 */
  requiredPermission: string
}

const Context = createContext<TopicScope | null>(null)

/**
 * 야마 카드가 자기가 어느 테마 안에 있는지 알아야 해서 둔다.
 *
 * 카드는 Tiptap 노드뷰 안에서 그려지기 때문에 props 로 내려받을 길이 없다.
 * 테마 밖(문제 풀이 화면 등)에서 쓰이면 null 이라 카드가 알아서 읽기 전용이 된다.
 */
export function TopicScopeProvider({
  authorId,
  requiredPermission,
  children,
}: TopicScope & { children: ReactNode }) {
  return (
    <Context.Provider value={{ authorId, requiredPermission }}>{children}</Context.Provider>
  )
}

export function useTopicScope(): TopicScope | null {
  return useContext(Context)
}
