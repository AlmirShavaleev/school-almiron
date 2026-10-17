import type { CourseLadder } from '@/lib/myCourses'

/**
 * Кольцо в два слоя (вариант «Б»): внешнее тонкое светло-синее — доля
 * открытых тем, внутреннее толстое синее — доля пройденных. Внутри — только
 * процент пройденного; «открыто N%» — под кругом (просьба владельца).
 */
export function DualRing({ ladder, size = 92 }: { ladder: Pick<CourseLadder, 'donePct' | 'openPct'>; size?: number }) {
  const C1 = 2 * Math.PI * 40
  const C2 = 2 * Math.PI * 30
  return (
    <div className="stu-dring" data-testid="course-ring">
      <div className="stu-dring-c" style={{ width: size, height: size }}>
        <svg viewBox="0 0 92 92" aria-hidden="true">
          <circle cx="46" cy="46" r="40" fill="none" stroke="var(--line)" strokeWidth="5" />
          {ladder.openPct != null && ladder.openPct > 0 && (
            <circle cx="46" cy="46" r="40" fill="none" stroke="var(--blueMid)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${(C1 * ladder.openPct) / 100} ${C1}`} />
          )}
          <circle cx="46" cy="46" r="30" fill="none" stroke="var(--line)" strokeWidth="9" />
          {ladder.donePct > 0 && (
            <circle cx="46" cy="46" r="30" fill="none" stroke="var(--blue)" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(C2 * ladder.donePct) / 100} ${C2}`} />
          )}
        </svg>
        <b>{ladder.donePct}%</b>
      </div>
      {ladder.openPct != null && <small data-testid="course-open-pct">открыто {ladder.openPct}%</small>}
    </div>
  )
}
