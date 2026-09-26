import { cn } from '@/utils/cn'
import { VERDICT_MARK_LABEL, type VerdictMarkState } from '@/lib/verdictMark'

export { MARK_OF_REVIEW_VERDICT, VERDICT_MARK_LABEL, type VerdictMarkState } from '@/lib/verdictMark'

/**
 * §225. Метка состояния проверки — дизайн-система v2.
 *
 * Пять состояний, и у каждого своя ФОРМА, а не только цвет (принцип брифа:
 * «состояние видно формой»; лист для родителя печатают на ч/б принтере):
 *
 * | состояние   | форма                         | цвет          |
 * |-------------|-------------------------------|---------------|
 * | верно       | закрашенный круг с галкой     | зелёный       |
 * | неверно     | закрашенный круг с крестом    | красный       |
 * | частично    | круг, закрашенный наполовину  | охра          |
 * | не сверено  | пунктирный круг с «?»         | синий         |
 * | не решено   | пустой круг                   | серый         |
 *
 * Рисуется SVG, а не фоном: браузеры по умолчанию не печатают фоны, и
 * закрашенный круг на бумаге стал бы пустым — форма «верно» совпала бы с
 * «не решено». Заливка SVG печатается всегда. На печати цвет снимается в
 * чёрный (`.verdict-mark` в index.css), тире «не решено» пропадает — остаётся
 * пустой круг, как в макете.
 */
const TONE: Record<VerdictMarkState, string> = {
  ok: 'text-verdict-ok',
  bad: 'text-verdict-bad',
  part: 'text-verdict-part',
  unk: 'text-verdict-unk',
  none: 'text-verdict-none',
}

interface VerdictMarkProps {
  state: VerdictMarkState
  /** Сторона значка в пикселях. В макете: 20 — в строке, 16 — в сводке. */
  size?: number
  /**
   * Подпись для скринридера и подсказки. По умолчанию — название состояния.
   * `null` — значок декоративный (рядом уже стоит слово).
   */
  label?: string | null
  className?: string
}

export function VerdictMark({ state, size = 20, label, className }: VerdictMarkProps) {
  const name = label === undefined ? VERDICT_MARK_LABEL[state] : label
  const a11y = name
    ? { role: 'img' as const, 'aria-label': name }
    : { 'aria-hidden': true as const }
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      data-testid="verdict-mark"
      data-state={state}
      className={cn('verdict-mark inline-block shrink-0', TONE[state], className)}
      {...a11y}
    >
      {name && <title>{name}</title>}
      {state === 'ok' && (
        <>
          <circle cx="10" cy="10" r="9.25" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 10.4l2.7 2.7L14.2 7.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {state === 'bad' && (
        <>
          <circle cx="10" cy="10" r="9.25" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {state === 'part' && (
        <>
          <circle cx="10" cy="10" r="9.25" fill="#fff" stroke="currentColor" strokeWidth="1.5" />
          <path data-part="half" d="M10 0.75A9.25 9.25 0 0 0 10 19.25Z" fill="currentColor" />
        </>
      )}
      {state === 'unk' && (
        <>
          <circle data-part="dashed" cx="10" cy="10" r="9.25" fill="#fff" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 1.9" />
          <path
            d="M7.6 7.9a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.7-.9 1.3v.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="10" cy="14.4" r="1.05" fill="currentColor" />
        </>
      )}
      {state === 'none' && (
        <>
          <circle cx="10" cy="10" r="9.25" fill="#fff" stroke="currentColor" strokeWidth="1.5" />
          <path className="verdict-mark-dash" d="M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
