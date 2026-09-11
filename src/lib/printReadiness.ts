export const PRINT_ASSET_KINDS = ['image', 'lecture', 'allen', 'yama'] as const

export type PrintAssetKind = (typeof PRINT_ASSET_KINDS)[number]

export type PrintReadinessSnapshot = {
  imageTotal: number
  imageReady: number
  imageFailed: number
  pending: Record<PrintAssetKind, number>
  failed: Record<PrintAssetKind, number>
  fontsReady: boolean
}

export const EMPTY_PRINT_READINESS: PrintReadinessSnapshot = {
  imageTotal: 0,
  imageReady: 0,
  imageFailed: 0,
  pending: { image: 0, lecture: 0, allen: 0, yama: 0 },
  failed: { image: 0, lecture: 0, allen: 0, yama: 0 },
  fontsReady: false,
}

export function pendingPrintAssetCount(snapshot: PrintReadinessSnapshot): number {
  return (
    snapshot.imageTotal - snapshot.imageReady - snapshot.imageFailed +
    Object.values(snapshot.pending).reduce((sum, count) => sum + count, 0)
  )
}

export function failedPrintAssetCount(snapshot: PrintReadinessSnapshot): number {
  return (
    snapshot.imageFailed +
    Object.values(snapshot.failed).reduce((sum, count) => sum + count, 0)
  )
}

/** 네트워크 자료와 글꼴까지 끝난 뒤에만 마지막 지면 안정화 단계로 간다. */
export function canSettlePrintLayout(snapshot: PrintReadinessSnapshot): boolean {
  return (
    snapshot.fontsReady &&
    pendingPrintAssetCount(snapshot) === 0 &&
    failedPrintAssetCount(snapshot) === 0
  )
}

export function samePrintReadiness(
  left: PrintReadinessSnapshot,
  right: PrintReadinessSnapshot,
): boolean {
  return (
    left.imageTotal === right.imageTotal &&
    left.imageReady === right.imageReady &&
    left.imageFailed === right.imageFailed &&
    left.fontsReady === right.fontsReady &&
    PRINT_ASSET_KINDS.every(
      (kind) => left.pending[kind] === right.pending[kind] && left.failed[kind] === right.failed[kind],
    )
  )
}
