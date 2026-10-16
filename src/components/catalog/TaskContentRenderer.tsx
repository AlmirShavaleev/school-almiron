import { useEffect, useRef } from 'react'
import { hasPendingMath } from '@/lib/catalogMarkdown'
import { upgradeMathIn } from '@/lib/katexLoader'

interface Props {
  /** Pre-resolved HTML (run through resolveTaskHtml before passing here) */
  html: string
  className?: string
}

/**
 * Renders a single block of task HTML (statement, answer, or solution).
 * Applies the catalog-html CSS class so all image/table rules work correctly.
 * Always pass html through resolveTaskHtml() before using this component.
 *
 * §269: у задач в Markdown формулы, пока KaTeX не загружен, приходят
 * исходником (`.catalog-math-pending`) — здесь KaTeX подгружается и
 * дорисовывает их на месте.
 */
export function TaskContentRenderer({ html, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !hasPendingMath(html)) return
    // KaTeX — только для задач на экране (и чуть ниже): на странице темы
    // десятки карточек, а формулы считаются в главном потоке.
    if (typeof IntersectionObserver === 'undefined') {
      void upgradeMathIn(el)
      return
    }
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      io.disconnect()
      void upgradeMathIn(el)
    }, { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [html])
  if (!html) return null
  return (
    <div
      ref={ref}
      data-math-lazy=""
      className={`prose prose-sm max-w-none text-gray-800 catalog-html ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
