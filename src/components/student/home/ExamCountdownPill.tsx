import type { ExamCountdown } from '@/lib/examCountdown'

/**
 * §255 (дополнение владельца 02.10). Плашка «242 дня до ЕГЭ · примерно, до
 * 1 июня» в шапке главной, слева от плашки серии. Что считать и когда не
 * показывать — `examCountdown` (lib/examCountdown.ts).
 */
export function ExamCountdownPill({ countdown }: { countdown: ExamCountdown }) {
  return (
    <div
      data-testid="exam-countdown"
      title={countdown.hint}
      aria-label={`${countdown.days} ${countdown.daysWord} ${countdown.label}, ${countdown.note}. ${countdown.hint}`}
      className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-graphite-200 bg-white py-1.5 pl-2 pr-4"
    >
      <b className="grid h-[30px] min-w-[44px] place-items-center rounded-full bg-primary-600 px-2 text-base font-extrabold tabular-nums text-white">
        {countdown.days}
      </b>
      <span className="grid leading-tight">
        <span className="whitespace-nowrap text-[15px] font-extrabold text-graphite-950">{countdown.daysWord} {countdown.label}</span>
        <small className="whitespace-nowrap text-[12px] font-semibold text-graphite-500">{countdown.note}</small>
      </span>
    </div>
  )
}
