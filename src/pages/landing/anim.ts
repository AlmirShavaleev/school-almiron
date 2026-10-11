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

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.96 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: EASE } },
}

/** Пункты макетов экранов: въезжают по очереди при показе вкладки. */
export const screenItem: Variants = {
  off: { opacity: 0, x: -10 },
  on: { opacity: 1, x: 0, transition: { duration: 0.3 } },
}
