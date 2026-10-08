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
    if (hasPendingMath(html)) void upgradeMathIn(ref.current)
  }, [html])
  if (!html) return null
  return (
    <div
      ref={ref}
      className={`prose prose-sm max-w-none text-gray-800 catalog-html ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
