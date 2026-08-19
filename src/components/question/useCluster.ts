import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  attachToCluster,
  detachFromCluster,
  ensureClusterGroup,
  fetchClusterSiblings,
  type ClusterSibling,
  type VariantType,
} from '@/lib/queries/clusters'

/**
 * 야마 클러스터의 상태와 조작.
 *
 * 화면마다 배치가 달라서 훅으로 뺐다. 문제 풀이 화면은 배너와 변주를 세로로
 * 쌓고, 테마 본문의 야마 카드는 좌(문제)·우(해설)·아래(변주)로 흩는다. 로직은
 * 같고 그리는 자리만 다르다.
 */
export function useCluster(questionId: string, initialGroupId: string | null) {
  const [groupId, setGroupId] = useState(initialGroupId)
  // 묶인 그룹이 없으면 조회할 것도 없으므로 빈 배열로 시작한다.
  // 이펙트 안에서 동기적으로 setState 하지 않기 위한 초기값 분기다.
  const [siblings, setSiblings] = useState<ClusterSibling[] | null>(initialGroupId ? null : [])

  const refresh = useCallback(
    (id: string) => {
      void fetchClusterSiblings(id, questionId)
        .then(setSiblings)
        .catch((caught: unknown) => {
          console.error('야마 묶음을 불러오지 못했습니다.', caught)
          setSiblings([])
        })
    },
    [questionId],
  )

  const load = useCallback(() => {
    if (!groupId) return
    refresh(groupId)
  }, [groupId, refresh])

  useEffect(load, [load])

  /**
   * 격자에 깔리는 카드들. 기준 문제는 여기 없고 화면에서 맨 앞에 따로 그린다.
   * same_as 가 null 인 형제 = 자기 자신이 카드인 판본이다.
   */
  const cards = useMemo(
    () => (siblings ?? []).filter((row) => row.sameAs === null),
    [siblings],
  )

  /** 카드 id → 그 카드와 글자까지 같은 판본들 */
  const identicalOf = useMemo(() => {
    const map = new Map<string, ClusterSibling[]>()
    for (const row of siblings ?? []) {
      if (!row.sameAs) continue
      map.set(row.sameAs, [...(map.get(row.sameAs) ?? []), row])
    }
    return map
  }, [siblings])

  /**
   * 붙이기.
   *
   * 두 번째부터는 cluster_attach 가 같은 그룹 id 를 돌려주므로 setGroupId 로는
   * 아무 일도 일어나지 않는다(값이 같아 이펙트가 다시 돌지 않는다). 그래서 받은
   * id 로 직접 다시 읽는다.
   */
  const attach = useCallback(
    async (targetId: string, variant: VariantType, anchorId: string = questionId) => {
      const nextGroupId = await attachToCluster({ anchorId, targetId, variant })
      setGroupId(nextGroupId)
      refresh(nextGroupId)
    },
    [questionId, refresh],
  )

  const detach = useCallback(
    (targetId: string) => {
      void detachFromCluster(targetId)
        .then(load)
        .catch((caught: unknown) => {
          window.alert(caught instanceof Error ? caught.message : '묶기를 풀지 못했습니다.')
        })
    },
    [load],
  )

  /**
   * 해설을 붙일 그룹을 보장한다. 그룹 없이 문제에 직접 붙이면 나중에 판본을
   * 묶어도 해설이 따라가지 않는다.
   */
  const ensureGroup = useCallback(async () => {
    const id = await ensureClusterGroup(questionId)
    setGroupId(id)
    return id
  }, [questionId])

  return { groupId, siblings, cards, identicalOf, attach, detach, ensureGroup }
}
