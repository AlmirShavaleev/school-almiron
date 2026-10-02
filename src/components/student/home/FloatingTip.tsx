import { useCallback, useState, type FocusEvent, type MouseEvent } from 'react'

/**
 * §254. Подсказка над клеткой календаря / столбиком недели — при наведении
 * И при фокусе с клавиатуры (как в макете). Одна на карточку: десятки
 * `title` дали бы системные подсказки с задержкой и без фокуса.
 *
 * Положение — `position: fixed` от прямоугольника элемента; по ширине
 * прижимается к краям окна, чтобы на 390 px не вылезать за экран.
 */
export function useFloatingTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)

  const show = useCallback((el: Element, text: string) => {
    const r = el.getBoundingClientRect()
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024
    const x = Math.max(110, Math.min(r.left + r.width / 2, w - 110))
    const below = r.top < 48
    setTip({ text, x, y: below ? r.bottom + 8 : r.top - 8, below })
  }, [])
  const hide = useCallback(() => setTip(null), [])

  const bind = useCallback((text: string) => ({
    onMouseEnter: (e: MouseEvent<Element>) => show(e.currentTarget, text),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent<Element>) => show(e.currentTarget, text),
    onBlur: hide,
  }), [show, hide])

  const node = tip ? (
    <div
      role="tooltip"
      data-testid="home-tip"
      className="pointer-events-none fixed z-50 w-max max-w-[220px] rounded-lg bg-graphite-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
      {tip.text}
    </div>
  ) : null

  return { bind, node, text: tip?.text ?? null }
}
