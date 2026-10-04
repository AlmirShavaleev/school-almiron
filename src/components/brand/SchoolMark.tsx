/**
 * §265. Знак школы — «Орбита» (вариант 3, выбран владельцем 04.10): «A» внутри
 * наклонной орбиты с точкой. Геометрия — дословно из файлов знака
 * (`brand/orbita-*.svg`, тот же viewBox), здесь только цвета под фон:
 *
 *  * `light` — на белой плитке и светлом фоне: синяя «A» #2F5BEA, оранжевая
 *    орбита #F28C28 (как `public/favicon.svg`);
 *  * `dark`  — прямо на тёмно-синем фоне (лендинг): светлее, #7AA2FF и #FFA94D.
 *
 * Адреса сайта в знаке нет и не будет — домен владелец будет менять.
 */
const TONES = {
  light: { letter: '#2F5BEA', orbit: '#F28C28' },
  dark: { letter: '#7AA2FF', orbit: '#FFA94D' },
} as const

export function SchoolMark({
  tone = 'light',
  size = 28,
  className,
  title,
}: {
  tone?: keyof typeof TONES
  size?: number
  className?: string
  /** Подпись для читалки. Без неё знак декоративный (рядом и так написано «Школа Almiron»). */
  title?: string
}) {
  const c = TONES[tone]
  return (
    <svg
      viewBox="-3 -3 70 70"
      width={size}
      height={size}
      className={className}
      data-testid="school-mark"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      focusable="false"
    >
      <ellipse cx="32" cy="34" rx="28" ry="12" transform="rotate(-22 32 34)" fill="none" stroke={c.orbit} strokeWidth="3.5" />
      <path d="M17 52 L32 12 L47 52 M23 38 H41" fill="none" stroke={c.letter} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="56" cy="23" r="4.5" fill={c.orbit} />
    </svg>
  )
}
