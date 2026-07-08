interface Props {
  /** Pre-resolved HTML (run through resolveTaskHtml before passing here) */
  html: string
  className?: string
}

/**
 * Renders a single block of task HTML (statement, answer, or solution).
 * Applies the catalog-html CSS class so all image/table rules work correctly.
 * Always pass html through resolveTaskHtml() before using this component.
 */
export function TaskContentRenderer({ html, className = '' }: Props) {
  if (!html) return null
  return (
    <div
      className={`prose prose-sm max-w-none text-gray-800 catalog-html ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
