import type { TheoryDocument } from '@/lib/queries/theory'

/** 이 문서와 그 자손 id. 자기 자손 밑으로 옮기면 목차가 고리를 이룬다. */
export function descendantIds(id: string, all: TheoryDocument[]): Set<string> {
  const found = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const document of all) {
      if (document.parentId && found.has(document.parentId) && !found.has(document.id)) {
        found.add(document.id)
        grew = true
      }
    }
  }
  return found
}

