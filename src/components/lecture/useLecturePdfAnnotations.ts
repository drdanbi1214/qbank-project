import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parsePageMarks, type PageMark } from '@/components/lecture/pageMarks'
import { useAuth } from '@/lib/auth'
import {
  fetchLectureAnnotationDrafts,
  removeLectureAnnotationDraft,
  saveLectureAnnotationDraft,
} from '@/lib/lectureAnnotationDrafts'
import {
  fetchLecturePdfAnnotations,
  saveLecturePdfAnnotations,
  type LecturePdfAnnotations,
} from '@/lib/queries/lectureAnnotations'
import { supabase } from '@/lib/supabase'

export type AnnotationSaveState =
  | 'unavailable'
  | 'loading'
  | 'idle'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'error'

const HISTORY_LIMIT = 80
const SAVE_DEBOUNCE_MS = 280
const REMOTE_UPDATE_NOTICE_MS = 5_000
let realtimeChannelSequence = 0

type PageHistory = {
  undo: PageMark[][]
  redo: PageMark[][]
}

type SaveSnapshot = {
  generation: number
  marks: PageMark[]
}

type SaveQueueEntry = {
  key: string
  contextKey: string
  userId: string
  lectureId: string
  pageNumber: number
  generation: number
  latest: SaveSnapshot | null
  expectedRevision: number | null
  baseMarks: PageMark[]
  timer: number | null
  inFlight: boolean
  conflicted: boolean
}

export type AnnotationConflict = {
  key: string
  pageNumber: number
  localMarks: PageMark[]
  serverMarks: PageMark[]
  baseMarks: PageMark[]
  serverRevision: number | null
  serverUpdatedAt: string | null
}

function combineMarks(serverMarks: PageMark[], localMarks: PageMark[]): PageMark[] {
  const seen = new Set<string>()
  return [...serverMarks, ...localMarks].filter((mark) => {
    const key = JSON.stringify(mark)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 강의록 한 권의 개인 필기를 관리한다.
 *
 * 화면 상태는 즉시 바꾸고, 페이지별 최신본은 IndexedDB에 먼저 남긴 뒤 서버로
 * 보낸다. 저장 중 여러 번 고쳐도 이미 지난 중간본을 줄줄이 보내지 않고 현재
 * 최신본 하나만 이어서 보내므로 긴 필기에서도 저장 대기열이 불어나지 않는다.
 */
export function useLecturePdfAnnotations(lectureId: string | undefined, enabled = true) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const available = Boolean(enabled && lectureId && userId)
  const contextKey = available ? `${userId}:${lectureId}` : ''

  const [loaded, setLoaded] = useState<{
    key: string
    pages: LecturePdfAnnotations
    error: string | null
  } | null>(null)
  const [pending, setPending] = useState<{ key: string; count: number } | null>(null)
  const [lastSaved, setLastSaved] = useState<{ key: string; at: number } | null>(null)
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null)
  const [conflicts, setConflicts] = useState<Record<string, AnnotationConflict>>({})
  const [remoteUpdate, setRemoteUpdate] = useState<{ key: string; pageNumber: number; at: number } | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const pagesRef = useRef<LecturePdfAnnotations>({})
  const revisionsRef = useRef(new Map<number, number | null>())
  const basePagesRef = useRef<LecturePdfAnnotations>({})
  const histories = useRef(new Map<number, PageHistory>())
  const queues = useRef(new Map<string, SaveQueueEntry>())
  const dirtyKeys = useRef(new Set<string>())
  const failedKeys = useRef(new Set<string>())
  const localWrites = useRef(new Map<string, Promise<void>>())
  const runQueueRef = useRef<(entry: SaveQueueEntry) => Promise<void>>(async () => undefined)
  const remoteUpdateTimer = useRef<number | null>(null)
  const [, setHistoryVersion] = useState(0)

  const syncPending = useCallback((key: string) => {
    const count = [...dirtyKeys.current].filter((item) => item.startsWith(`${key}:`)).length
    setPending({ key, count })
  }, [])

  const announceRemoteUpdate = useCallback((key: string, pageNumber: number) => {
    const at = Date.now()
    setRemoteUpdate({ key, pageNumber, at })
    if (remoteUpdateTimer.current !== null) window.clearTimeout(remoteUpdateTimer.current)
    remoteUpdateTimer.current = window.setTimeout(() => {
      remoteUpdateTimer.current = null
      setRemoteUpdate((current) => (current?.at === at ? null : current))
    }, REMOTE_UPDATE_NOTICE_MS)
  }, [])

  useEffect(
    () => () => {
      if (remoteUpdateTimer.current !== null) window.clearTimeout(remoteUpdateTimer.current)
    },
    [],
  )

  const queueLocalOperation = useCallback((key: string, operation: () => Promise<void>) => {
    const previous = localWrites.current.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    localWrites.current.set(key, next)
    void next.then(
      () => {
        if (localWrites.current.get(key) === next) localWrites.current.delete(key)
      },
      () => {
        if (localWrites.current.get(key) === next) localWrites.current.delete(key)
      },
    )
    return next
  }, [])

  const runQueue = useCallback(
    async (entry: SaveQueueEntry) => {
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      entry.timer = null
      if (entry.inFlight || entry.conflicted || !entry.latest) return
      entry.inFlight = true
      failedKeys.current.delete(entry.key)

      const localWrite = localWrites.current.get(entry.key)
      if (localWrite) await localWrite.catch(() => undefined)

      let saving: SaveSnapshot | null = null
      let lastSavedGeneration = 0
      try {
        while (entry.latest) {
          saving = entry.latest
          entry.latest = null
          const result = await saveLecturePdfAnnotations({
            lectureId: entry.lectureId,
            pageNumber: entry.pageNumber,
            marks: saving.marks,
            expectedRevision: entry.expectedRevision,
          })
          if (result.status === 'conflict') {
            const queuedAfterSave = entry.latest as SaveSnapshot | null
            if (!queuedAfterSave || queuedAfterSave.generation < saving.generation) {
              entry.latest = saving
            }
            entry.conflicted = true
            entry.inFlight = false
            const localMarks = (entry.latest ?? saving).marks
            setConflicts((current) => ({
              ...current,
              [entry.key]: {
                key: entry.key,
                pageNumber: entry.pageNumber,
                localMarks,
                serverMarks: result.marks,
                baseMarks: entry.baseMarks,
                serverRevision: result.revision,
                serverUpdatedAt: result.updatedAt,
              },
            }))
            syncPending(entry.contextKey)
            return
          }
          entry.expectedRevision = result.revision
          entry.baseMarks = result.marks
          revisionsRef.current.set(entry.pageNumber, result.revision)
          if (result.marks.length === 0) delete basePagesRef.current[entry.pageNumber]
          else basePagesRef.current[entry.pageNumber] = result.marks
          lastSavedGeneration = saving.generation
        }
      } catch (caught: unknown) {
        // 실패한 것보다 새로운 최신본이 있으면 옛 상태는 다시 넣지 않는다.
        if (saving && (!entry.latest || entry.latest.generation < saving.generation)) {
          entry.latest = saving
        }
        entry.inFlight = false
        failedKeys.current.add(entry.key)
        setSaveError({
          key: entry.contextKey,
          message: caught instanceof Error ? caught.message : '필기를 저장하지 못했습니다.',
        })
        syncPending(entry.contextKey)
        return
      }

      const finalLocalWrite = localWrites.current.get(entry.key)
      if (finalLocalWrite) await finalLocalWrite.catch(() => undefined)

      if (entry.latest || entry.generation !== lastSavedGeneration) {
        entry.inFlight = false
        entry.timer = window.setTimeout(() => void runQueueRef.current(entry), 0)
        return
      }

      await queueLocalOperation(entry.key, () =>
        removeLectureAnnotationDraft(entry.contextKey, entry.pageNumber),
      ).catch(() => undefined)

      entry.inFlight = false
      if (entry.latest || entry.generation !== lastSavedGeneration) {
        entry.timer = window.setTimeout(() => void runQueueRef.current(entry), 0)
        return
      }

      queues.current.delete(entry.key)
      dirtyKeys.current.delete(entry.key)
      failedKeys.current.delete(entry.key)
      syncPending(entry.contextKey)
      setLastSaved({ key: entry.contextKey, at: Date.now() })
      if (![...failedKeys.current].some((key) => key.startsWith(`${entry.contextKey}:`))) {
        setSaveError((current) => (current?.key === entry.contextKey ? null : current))
      }
    },
    [queueLocalOperation, syncPending],
  )

  useEffect(() => {
    runQueueRef.current = runQueue
  }, [runQueue])

  const enqueueSave = useCallback(
    (
      pageNumber: number,
      marks: PageMark[],
      persistLocally = true,
      recoveredBase?: { revision: number | null; marks: PageMark[] },
    ) => {
      if (!available || !lectureId) return

      const key = `${contextKey}:${pageNumber}`
      let entry = queues.current.get(key)
      if (!entry) {
        entry = {
          key,
          contextKey,
          userId,
          lectureId,
          pageNumber,
          generation: 0,
          latest: null,
          expectedRevision: recoveredBase?.revision ?? revisionsRef.current.get(pageNumber) ?? null,
          baseMarks: recoveredBase?.marks ?? basePagesRef.current[pageNumber] ?? [],
          timer: null,
          inFlight: false,
          conflicted: false,
        }
        queues.current.set(key, entry)
      }

      entry.generation += 1
      entry.latest = { generation: entry.generation, marks }
      dirtyKeys.current.add(key)
      failedKeys.current.delete(key)
      syncPending(contextKey)
      if (![...failedKeys.current].some((item) => item.startsWith(`${contextKey}:`))) {
        setSaveError((current) => (current?.key === contextKey ? null : current))
      }

      if (persistLocally) {
        void queueLocalOperation(key, () =>
          saveLectureAnnotationDraft({
            contextKey,
            pageNumber,
            marks,
            baseRevision: entry!.expectedRevision,
            baseMarks: entry!.baseMarks,
          }),
        ).catch(() => undefined)
      }

      if (entry.timer !== null) window.clearTimeout(entry.timer)
      if (entry.conflicted) {
        setConflicts((current) => {
          const conflict = current[key]
          return conflict
            ? { ...current, [key]: { ...conflict, localMarks: marks } }
            : current
        })
        return
      }
      entry.timer = window.setTimeout(() => void runQueueRef.current(entry), SAVE_DEBOUNCE_MS)
    },
    [available, contextKey, lectureId, queueLocalOperation, syncPending, userId],
  )

  useEffect(() => {
    let active = true
    if (!available || !lectureId) return () => { active = false }

    pagesRef.current = {}
    revisionsRef.current.clear()
    basePagesRef.current = {}
    histories.current.clear()
    void (async () => {
      const drafts = await fetchLectureAnnotationDrafts(contextKey).catch(() => [])
      if (!active) return
      setConflicts((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${contextKey}:`))),
      )
      try {
        const serverSnapshot = await fetchLecturePdfAnnotations({ userId, lectureId })
        if (!active) return
        const merged = { ...serverSnapshot.pages }
        for (const draft of drafts) {
          if (draft.marks.length === 0) delete merged[draft.pageNumber]
          else merged[draft.pageNumber] = draft.marks
        }
        pagesRef.current = merged
        revisionsRef.current = new Map(
          Object.entries(serverSnapshot.revisions).map(([page, revision]) => [Number(page), revision]),
        )
        basePagesRef.current = { ...serverSnapshot.pages }
        histories.current.clear()
        setLoaded({ key: contextKey, pages: merged, error: null })
        for (const draft of drafts) {
          const serverMarks = serverSnapshot.pages[draft.pageNumber] ?? []
          const serverRevision = serverSnapshot.revisions[draft.pageNumber] ?? null
          if (draft.baseRevision !== undefined && draft.baseMarks !== undefined) {
            enqueueSave(draft.pageNumber, draft.marks, false, {
              revision: draft.baseRevision,
              marks: draft.baseMarks,
            })
            continue
          }

          // 배포 전 임시본에는 기준 revision이 없다. 서버와 같으면 정리만 하고,
          // 서버 행이 없으면 안전하게 새로 저장한다. 둘 다 아니면 사용자 선택 전
          // 절대로 추측해서 덮어쓰지 않는다.
          if (JSON.stringify(serverMarks) === JSON.stringify(draft.marks)) {
            void removeLectureAnnotationDraft(contextKey, draft.pageNumber).catch(() => undefined)
            continue
          }
          enqueueSave(draft.pageNumber, draft.marks, false, {
            revision: serverRevision,
            marks: serverMarks,
          })
          if (serverRevision !== null) {
            const entryKey = `${contextKey}:${draft.pageNumber}`
            const entry = queues.current.get(entryKey)
            if (entry) {
              if (entry.timer !== null) window.clearTimeout(entry.timer)
              entry.timer = null
              entry.conflicted = true
              setConflicts((current) => ({
                ...current,
                [entryKey]: {
                  key: entryKey,
                  pageNumber: draft.pageNumber,
                  localMarks: draft.marks,
                  serverMarks,
                  baseMarks: serverMarks,
                  serverRevision,
                  serverUpdatedAt: serverSnapshot.updatedAt[draft.pageNumber] ?? null,
                },
              }))
            }
          }
        }
      } catch (caught: unknown) {
        if (!active) return
        const localPages: LecturePdfAnnotations = {}
        for (const draft of drafts) {
          if (draft.marks.length > 0) localPages[draft.pageNumber] = draft.marks
        }
        pagesRef.current = localPages
        histories.current.clear()
        setLoaded({
          key: contextKey,
          pages: localPages,
          error: caught instanceof Error ? caught.message : '필기를 불러오지 못했습니다.',
        })
      }
    })()

    return () => {
      active = false
    }
  }, [available, contextKey, enqueueSave, lectureId, reloadToken, userId])

  useEffect(() => {
    if (!available || !lectureId || loaded?.key !== contextKey) return
    let active = true

    const receiveServerPage = (params: {
      pageNumber: number
      marks: PageMark[]
      revision: number | null
      updatedAt: string | null
    }) => {
      if (!active || params.pageNumber <= 0) return
      const pageNumber = params.pageNumber
      const key = `${contextKey}:${pageNumber}`
      const currentRevision = revisionsRef.current.get(pageNumber) ?? null
      const currentServerMarks = basePagesRef.current[pageNumber] ?? []
      if (
        params.revision === currentRevision &&
        JSON.stringify(params.marks) === JSON.stringify(currentServerMarks)
      ) {
        return
      }
      if (
        params.revision !== null &&
        currentRevision !== null &&
        params.revision < currentRevision
      ) {
        return
      }

      const entry = queues.current.get(key)
      // 자신의 저장 이벤트는 응답보다 먼저 올 수도 있다. 실행 중 요청의 원자적
      // 결과가 곧 도착하므로 여기서 성급하게 충돌로 만들지 않는다.
      if (entry?.inFlight) return

      if (entry && dirtyKeys.current.has(key)) {
        if (entry.expectedRevision === params.revision) return
        if (entry.timer !== null) window.clearTimeout(entry.timer)
        entry.timer = null
        entry.conflicted = true
        const localMarks = entry.latest?.marks ?? pagesRef.current[pageNumber] ?? []
        setConflicts((current) => ({
          ...current,
          [key]: {
            key,
            pageNumber,
            localMarks,
            serverMarks: params.marks,
            baseMarks: entry.baseMarks,
            serverRevision: params.revision,
            serverUpdatedAt: params.updatedAt,
          },
        }))
        setSaveError((current) => (current?.key === contextKey ? null : current))
        syncPending(contextKey)
        return
      }

      revisionsRef.current.set(pageNumber, params.revision)
      if (params.marks.length === 0) delete basePagesRef.current[pageNumber]
      else basePagesRef.current[pageNumber] = params.marks
      const next = { ...pagesRef.current }
      if (params.marks.length === 0) delete next[pageNumber]
      else next[pageNumber] = params.marks
      pagesRef.current = next
      histories.current.delete(pageNumber)
      setLoaded((current) =>
        current?.key === contextKey ? { key: contextKey, pages: next, error: null } : current,
      )
      setHistoryVersion((version) => version + 1)
      announceRemoteUpdate(contextKey, pageNumber)
    }

    realtimeChannelSequence += 1
    const channel = supabase
      .channel(`lecture-annotations:${userId}:${lectureId}:${realtimeChannelSequence}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lecture_pdf_annotations',
          filter: `lecture_id=eq.${lectureId}`,
        },
        (payload) => {
          const source = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<
            string,
            unknown
          >
          if (source.user_id !== userId) return
          const pageNumber = source.page_number
          if (!Number.isInteger(pageNumber) || Number(pageNumber) <= 0) return
          if (payload.eventType === 'DELETE') {
            receiveServerPage({
              pageNumber: Number(pageNumber),
              marks: [],
              revision: null,
              updatedAt: null,
            })
            return
          }
          const revision = source.revision
          if (!Number.isInteger(revision) || Number(revision) <= 0) return
          receiveServerPage({
            pageNumber: Number(pageNumber),
            marks: parsePageMarks(source.marks),
            revision: Number(revision),
            updatedAt: typeof source.updated_at === 'string' ? source.updated_at : null,
          })
        },
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        // 최초 불러오기와 구독 완료 사이의 짧은 틈에 생긴 변경도 다시 비교한다.
        void fetchLecturePdfAnnotations({ userId, lectureId }).then(
          (snapshot) => {
            if (!active) return
            const pageNumbers = new Set([
              ...revisionsRef.current.keys(),
              ...Object.keys(snapshot.revisions).map(Number),
            ])
            for (const pageNumber of pageNumbers) {
              receiveServerPage({
                pageNumber,
                marks: snapshot.pages[pageNumber] ?? [],
                revision: snapshot.revisions[pageNumber] ?? null,
                updatedAt: snapshot.updatedAt[pageNumber] ?? null,
              })
            }
          },
          () => undefined,
        )
      })

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [
    announceRemoteUpdate,
    available,
    contextKey,
    lectureId,
    loaded?.key,
    syncPending,
    userId,
  ])

  const updatePage = useCallback(
    (pageNumber: number, marks: PageMark[]) => {
      if (!available) return
      const previous = pagesRef.current[pageNumber] ?? []
      const history = histories.current.get(pageNumber) ?? { undo: [], redo: [] }
      history.undo.push(previous)
      if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
      history.redo = []
      histories.current.set(pageNumber, history)

      const next = { ...pagesRef.current }
      if (marks.length === 0) delete next[pageNumber]
      else next[pageNumber] = marks
      pagesRef.current = next
      setLoaded({ key: contextKey, pages: next, error: null })
      setHistoryVersion((version) => version + 1)
      enqueueSave(pageNumber, marks)
    },
    [available, contextKey, enqueueSave],
  )

  const restorePage = useCallback(
    (pageNumber: number, marks: PageMark[]) => {
      if (!available) return
      const next = { ...pagesRef.current }
      if (marks.length === 0) delete next[pageNumber]
      else next[pageNumber] = marks
      pagesRef.current = next
      setLoaded({ key: contextKey, pages: next, error: null })
      setHistoryVersion((version) => version + 1)
      enqueueSave(pageNumber, marks)
    },
    [available, contextKey, enqueueSave],
  )

  const undoPage = useCallback(
    (pageNumber: number) => {
      const history = histories.current.get(pageNumber)
      const previous = history?.undo.pop()
      if (!history || !previous) return
      history.redo.push(pagesRef.current[pageNumber] ?? [])
      histories.current.set(pageNumber, history)
      restorePage(pageNumber, previous)
    },
    [restorePage],
  )

  const redoPage = useCallback(
    (pageNumber: number) => {
      const history = histories.current.get(pageNumber)
      const next = history?.redo.pop()
      if (!history || !next) return
      history.undo.push(pagesRef.current[pageNumber] ?? [])
      histories.current.set(pageNumber, history)
      restorePage(pageNumber, next)
    },
    [restorePage],
  )

  const canUndoPage = useCallback(
    (pageNumber: number) => (histories.current.get(pageNumber)?.undo.length ?? 0) > 0,
    [],
  )
  const canRedoPage = useCallback(
    (pageNumber: number) => (histories.current.get(pageNumber)?.redo.length ?? 0) > 0,
    [],
  )

  const resolveConflict = useCallback(
    (pageNumber: number, choice: 'server' | 'mine' | 'combine') => {
      const key = `${contextKey}:${pageNumber}`
      const conflict = conflicts[key]
      const entry = queues.current.get(key)
      if (!conflict || !entry) return

      if (entry.timer !== null) window.clearTimeout(entry.timer)
      entry.timer = null
      entry.inFlight = false

      const removeConflict = () =>
        setConflicts((current) => {
          if (!current[key]) return current
          const next = { ...current }
          delete next[key]
          return next
        })

      if (choice === 'server') {
        entry.latest = null
        entry.conflicted = false
        queues.current.delete(key)
        dirtyKeys.current.delete(key)
        failedKeys.current.delete(key)
        revisionsRef.current.set(pageNumber, conflict.serverRevision)
        if (conflict.serverMarks.length === 0) delete basePagesRef.current[pageNumber]
        else basePagesRef.current[pageNumber] = conflict.serverMarks

        const next = { ...pagesRef.current }
        if (conflict.serverMarks.length === 0) delete next[pageNumber]
        else next[pageNumber] = conflict.serverMarks
        pagesRef.current = next
        histories.current.delete(pageNumber)
        setLoaded({ key: contextKey, pages: next, error: null })
        setHistoryVersion((version) => version + 1)
        void queueLocalOperation(key, () =>
          removeLectureAnnotationDraft(contextKey, pageNumber),
        ).catch(() => undefined)
        removeConflict()
        syncPending(contextKey)
        setLastSaved({ key: contextKey, at: Date.now() })
        return
      }

      const marks =
        choice === 'combine'
          ? combineMarks(conflict.serverMarks, conflict.localMarks)
          : conflict.localMarks
      if (choice === 'combine') {
        const history = histories.current.get(pageNumber) ?? { undo: [], redo: [] }
        history.undo.push(pagesRef.current[pageNumber] ?? [])
        if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
        history.redo = []
        histories.current.set(pageNumber, history)
        const next = { ...pagesRef.current }
        if (marks.length === 0) delete next[pageNumber]
        else next[pageNumber] = marks
        pagesRef.current = next
        setLoaded({ key: contextKey, pages: next, error: null })
        setHistoryVersion((version) => version + 1)
      }

      entry.expectedRevision = conflict.serverRevision
      entry.baseMarks = conflict.serverMarks
      entry.conflicted = false
      entry.generation += 1
      entry.latest = { generation: entry.generation, marks }
      revisionsRef.current.set(pageNumber, conflict.serverRevision)
      if (conflict.serverMarks.length === 0) delete basePagesRef.current[pageNumber]
      else basePagesRef.current[pageNumber] = conflict.serverMarks
      void queueLocalOperation(key, () =>
        saveLectureAnnotationDraft({
          contextKey,
          pageNumber,
          marks,
          baseRevision: conflict.serverRevision,
          baseMarks: conflict.serverMarks,
        }),
      ).catch(() => undefined)
      removeConflict()
      entry.timer = window.setTimeout(() => void runQueueRef.current(entry), 0)
      syncPending(contextKey)
    },
    [conflicts, contextKey, queueLocalOperation, syncPending],
  )

  const retrySave = useCallback(() => {
    if (loaded?.key === contextKey && loaded.error) {
      setLoaded(null)
      setReloadToken((token) => token + 1)
      return
    }
    for (const key of [...failedKeys.current]) {
      const entry = queues.current.get(key)
      if (!entry || entry.contextKey !== contextKey) continue
      failedKeys.current.delete(key)
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      entry.timer = window.setTimeout(() => void runQueueRef.current(entry), 0)
    }
    setSaveError((current) => (current?.key === contextKey ? null : current))
  }, [contextKey, loaded])

  const flushPendingSaves = useCallback(() => {
    for (const entry of queues.current.values()) {
      if (entry.contextKey !== contextKey || !entry.latest) continue
      if (entry.timer !== null) window.clearTimeout(entry.timer)
      entry.timer = window.setTimeout(() => void runQueueRef.current(entry), 0)
    }
  }, [contextKey])

  useEffect(() => {
    window.addEventListener('online', retrySave)
    return () => window.removeEventListener('online', retrySave)
  }, [retrySave])

  useEffect(() => {
    const flushWhenHidden = () => {
      if (window.document.visibilityState === 'hidden') flushPendingSaves()
    }
    window.document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushPendingSaves)
    return () => {
      window.document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushPendingSaves)
    }
  }, [flushPendingSaves])

  const pages = loaded?.key === contextKey ? loaded.pages : {}
  const loading = available && loaded?.key !== contextKey
  const loadFailed = Boolean(loaded?.key === contextKey && loaded.error)
  const pendingCount = pending?.key === contextKey ? pending.count : 0
  const contextConflicts = Object.values(conflicts)
    .filter((conflict) => conflict.key.startsWith(`${contextKey}:`))
    .sort((a, b) => a.pageNumber - b.pageNumber)
  const conflict = contextConflicts[0] ?? null
  const visibleRemoteUpdate = remoteUpdate?.key === contextKey ? remoteUpdate : null
  const error =
    loaded?.key === contextKey && loaded.error
      ? loaded.error
      : saveError?.key === contextKey
        ? saveError.message
        : null
  const hasUnsavedChanges = pendingCount > 0 || saveError?.key === contextKey

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [hasUnsavedChanges])

  const status = useMemo<AnnotationSaveState>(() => {
    if (!available) return 'unavailable'
    if (loading) return 'loading'
    if (conflict) return 'conflict'
    if (error) return 'error'
    if (pendingCount > 0) return 'saving'
    return lastSaved?.key === contextKey ? 'saved' : 'idle'
  }, [available, conflict, contextKey, error, lastSaved?.key, loading, pendingCount])

  return {
    available,
    pages,
    status,
    error,
    conflict,
    conflictCount: contextConflicts.length,
    remoteUpdate: visibleRemoteUpdate,
    loadFailed,
    hasUnsavedChanges,
    updatePage,
    undoPage,
    redoPage,
    canUndoPage,
    canRedoPage,
    retrySave,
    resolveConflict,
  }
}
