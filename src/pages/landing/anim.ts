import { useReducedMotion, type Variants } from 'framer-motion'

/** Кривая прототипа: быстрый старт, мягкая посадка. */
export const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * Анимировать ли вообще. `useReducedMotion()` отдаёт null до первого чтения
 * настройки — считаем это «можно», как и прототип.
 */
export function useAnim() {
  return !useReducedMotion()
}

/** Ребёнок `Stagger` (`data-stagger` прототипа): въезжает снизу по очереди. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE } },
}
