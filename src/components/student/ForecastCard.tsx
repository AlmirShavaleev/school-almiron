import { Sticker } from '@/components/student/skin/Sticker'
import { rangeText, type ForecastRange } from '@/hooks/useMyForecastRanges'

const OF: Record<string, string> = { physics: 'физика', math: 'математика' }

/**
 * «Прогноз ЕГЭ · физика» и одно крупное значение — диапазон «58–70» (письмо
 * ЛК_виджет_прогноз_балла.md, правка владельца 17.10: «просто прогноз и всё»).
 * Данных мало или прогноза нет — «0», без пояснений. `loading` — «…».
 */
export function ForecastCard({ subject, range, loading = false, compact = false }: {
  subject: string
  range: ForecastRange | null | undefined
  loading?: boolean
  compact?: boolean
}) {
  return (
    <div className={compact ? 'stu-fc is-compact' : 'stu-fc'} data-testid={`forecast-${subject}`}>
      <p className="stu-fc-t">
        <Sticker name="target" size={compact ? 18 : 22} />
        Прогноз ЕГЭ · {OF[subject] ?? subject}
      </p>
      <p className="stu-fc-v" data-testid={`forecast-${subject}-value`}>{loading ? '…' : rangeText(range)}</p>
    </div>
  )
}
