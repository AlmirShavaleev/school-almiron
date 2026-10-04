import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * §265. Полоса, которая прокручивается вбок (вкладки курса на телефоне), должна
 * показывать, что за краем есть ещё: иначе «Настройки» просто не существуют
 * для того, кто не догадался провести пальцем. Край, за которым что-то есть,
 * тает (маска-градиент), а ближняя вкладка видна наполовину.
 */
export interface ScrollEdges {
  /** Слева есть скрытое — полоса уже прокручена. */
  left: boolean
  /** Справа есть скрытое. */
  right: boolean
}

/** Порог в пикселях: дробные scrollLeft на HiDPI не должны мигать краем. */
const EPS = 2

export function scrollEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): ScrollEdges {
  const hidden = el.scrollWidth - el.clientWidth
  if (hidden <= EPS) return { left: false, right: false }
  return { left: el.scrollLeft > EPS, right: el.scrollLeft < hidden - EPS }
}

/** Ширина тающего края. */
const FADE = 28

/**
 * CSS-маска для полосы: тает только тот край, за которым что-то есть. Нет
 * переполнения — маски нет вовсе (`undefined`), на широком экране полоса как была.
 */
export function edgeMask(edges: ScrollEdges): string | undefined {
  if (!edges.left && !edges.right) return undefined
  const from = edges.left ? `transparent 0, #000 ${FADE}px` : '#000 0'
  const to = edges.right ? `#000 calc(100% - ${FADE}px), transparent 100%` : '#000 100%'
  return `linear-gradient(to right, ${from}, ${to})`
}

/** Края прокрутки элемента: пересчёт на прокрутку, на смену размера и по `deps`. */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = scrollEdges(el)
    setEdges(prev => (prev.left === next.left && prev.right === next.right ? prev : next))
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps])

  return edges
}
