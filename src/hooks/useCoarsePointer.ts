import { useEffect, useState } from 'react'

/**
 * «Телефон» — по вводу, а не по ширине окна: планшет с клавиатурой и мышью
 * должен получить настольный экран (широкий сенсорный монитор — наоборот,
 * телефонный). `pointer: coarse` — основной указатель неточный (палец), это
 * ровно то различие, которое здесь важно. Тот же защитный приём, что у
 * `usePrefersReducedMotion` в `LiveNow.tsx`: без `matchMedia` (не бывает в
 * реальном браузере, бывает в тестовом окружении) — просто false, экран
 * ведёт себя как десктопный, ничего не ломается молча.
 *
 * §240: вынесено из TopicHomeworkStudent — им же живёт экран работы по
 * времени (TopicTimedWorkStudent).
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(pointer: coarse)')
    setCoarse(query.matches)
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches)
    if (query.addEventListener) {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    query.addListener(onChange)
    return () => query.removeListener(onChange)
  }, [])

  return coarse
}
