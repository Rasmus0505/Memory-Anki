import { palaceClearanceCopy, type PalaceClearance } from '@/modules/practice/ui/freestyle/model/freestylePalaceClearance'

export function FreestylePalaceClearedBanner({
  clearance,
}: {
  clearance: PalaceClearance
}) {
  return (
    <div
      data-testid="freestyle-palace-cleared"
      role="status"
      className="pointer-events-none absolute inset-x-3 top-[4.75rem] z-30 sm:inset-x-4 sm:top-20"
    >
      <div className="mx-auto max-w-lg rounded-2xl border border-emerald-300/35 bg-emerald-950/92 px-4 py-3 text-center shadow-[0_12px_36px_rgba(0,0,0,0.4)] backdrop-blur-md">
        <div className="text-[15px] font-semibold leading-snug text-emerald-50 sm:text-base">
          {palaceClearanceCopy(clearance)}
        </div>
        <div className="mt-1 text-[11px] text-emerald-100/75">滑走继续</div>
      </div>
    </div>
  )
}
