import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getAssetUrl, safeDecodeStoragePath, type CatalogTask } from '@/hooks/useCatalog'
import { sanitizeHtml } from '@/utils/sanitizeHtml'
import { isAnswerTemplateSvg } from '@/pages/catalog/classifyAnswerTemplate'

// ── resolveHtml ───────────────────────────────────────────────────────────────

/** Decode HTML character entities in img src attributes so apostrophes and
 *  other encoded chars match the actual storage_path / alt values. */
function decodeHtmlEntitiesInSrc(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function resolveTaskHtml(html: string | null | undefined, assets: CatalogTask['assets']): string {
  if (!html) return ''
  let resolved = html.replace(
    /<img\b([^>]*)\bsrc="([^"]*)"([^>]*)>/gi,
    (wholeTag, before, src, after) => {
      if (/^https?:\/\/|^\/\//.test(src)) return wholeTag
      // Decode HTML entities before matching (e.g. &#39; → ' for apostrophe filenames)
      const decodedSrc = decodeHtmlEntitiesInSrc(src)
      // Find ALL matching assets (in case of duplicates with same basename)
      // and select the LAST one (by position) — newer tex_session is more likely correct
      const matchingAssets = (assets ?? []).filter(a => {
        const decoded = safeDecodeStoragePath(a.storage_path)
        return decoded.endsWith(`/${decodedSrc}`)
            || a.storage_path.endsWith(`/${decodedSrc}`)
            || a.alt === decodedSrc
            || a.alt === src
      })
      const asset = matchingAssets.length > 0 ? matchingAssets[matchingAssets.length - 1] : null
      if (!asset) return wholeTag
      const url = getAssetUrl(asset.storage_path)
      const hasMathClass = /\bclass="[^"]*\bmath\b[^"]*"/i.test(before + after)
      const altMatch = /\balt="([^"]*)"/i.exec(before + after)
      const rawAlt = altMatch?.[1] ?? ''
      const isAnswerTemplate = hasMathClass && /^\s*\|[-|]/.test(rawAlt)
      const kindClass =
        isAnswerTemplate
          ? 'catalog-answer-template'
        : (asset.kind === 'solution' || asset.kind === 'solution_plan') && !hasMathClass
          ? 'catalog-solution-image'
        : asset.kind === 'condition' && !hasMathClass
          ? 'catalog-condition-figure'
        : ''
      const base = `<img${before} src="${url}"${after}>`
      if (!kindClass) return base
      if (/\bclass="/i.test(before + after)) {
        return base.replace(/\bclass="([^"]*)"/, `class="$1 ${kindClass}"`)
      }
      return `<img${before} src="${url}" class="${kindClass}"${after}>`
    }
  )
  resolved = resolved
    .replace(/<table/gi, '<div class="tbl-wrap"><table')
    .replace(/<\/table>/gi, '</table></div>')
  return sanitizeHtml(resolved)
}

// ── CatalogTaskContent ────────────────────────────────────────────────────────

interface CatalogTaskContentProps {
  task: CatalogTask
  /** Показывать кнопку «Показать ответ» и т.д. (для teacher/admin/owner) */
  showControls?: boolean
  /** Дополнительный slot справа от условия задачи */
  actionsSlot?: React.ReactNode
  /** Порядковый номер в варианте (если задан) */
  variantNumber?: number
}

export function CatalogTaskContent({
  task,
  showControls = true,
  actionsSlot,
  variantNumber,
}: CatalogTaskContentProps) {
  const [showAnswer,        setShowAnswer]        = useState(false)
  const [showSolution,      setShowSolution]      = useState(false)
  const [showPlan,          setShowPlan]          = useState(false)
  const [showGradeCriteria, setShowGradeCriteria] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = cardRef.current
    if (!root) return
    function reclassify(img: HTMLImageElement) {
      const { naturalWidth: nw, naturalHeight: nh } = img
      if (!nw) return
      const alt    = img.getAttribute('alt') ?? ''
      const should = isAnswerTemplateSvg(nw, nh, img.classList.contains('math-display'), alt)
      const has    = img.classList.contains('catalog-answer-template')
      if (should && !has) img.classList.add('catalog-answer-template')
      if (!should && has) img.classList.remove('catalog-answer-template')
    }
    const imgs = [...root.querySelectorAll<HTMLImageElement>('img')]
    imgs.forEach(img => {
      if (img.complete && img.naturalWidth > 0) reclassify(img)
      else img.addEventListener('load', () => reclassify(img), { once: true })
    })
  }, [task.id, showAnswer, showSolution, showPlan, showGradeCriteria])

  const resolve = (html: string | null | undefined) => resolveTaskHtml(html, task.assets)

  // Math ЕГЭ/ОГЭ only: real figures in statement/solution rendered smaller (see index.css .scale-figures-math-exam)
  const isMathExam = task.subject === 'Математика' && (task.exam_type === 'ЕГЭ' || task.exam_type === 'ОГЭ')
  const figureScaleClass = isMathExam ? ' scale-figures-math-exam' : ''

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200">
      {/* Условие */}
      <div className="flex items-start gap-3 p-4">
        {variantNumber !== undefined && (
          <span className="text-xs font-mono text-gray-400 mt-0.5 w-6 flex-shrink-0">
            #{variantNumber}
          </span>
        )}
        <div
          className={`flex-1 min-w-0 prose prose-sm max-w-none text-gray-800 catalog-html${figureScaleClass}`}
          dangerouslySetInnerHTML={{ __html: resolve(task.statement_html) }}
        />
        {actionsSlot && (
          <div className="flex-shrink-0 flex items-start gap-1">
            {actionsSlot}
          </div>
        )}
      </div>

      {/* Кнопки раскрытия */}
      {showControls && (task.has_answer || task.has_solution || task.solution_plan_html || task.grade_criteria_html) && (
        <div className="px-4 pb-4 flex gap-2 flex-wrap">
          {task.has_answer && (
            <button
              onClick={() => setShowAnswer(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              {showAnswer ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showAnswer ? 'Скрыть ответ' : 'Показать ответ'}
            </button>
          )}
          {task.has_solution && (
            <button
              onClick={() => setShowSolution(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors"
            >
              {showSolution ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showSolution ? 'Скрыть решение' : 'Показать решение'}
            </button>
          )}
          {task.solution_plan_html && (
            <button
              onClick={() => setShowPlan(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
            >
              {showPlan ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showPlan ? 'Скрыть план' : 'План решения'}
            </button>
          )}
          {task.grade_criteria_html && (
            <button
              onClick={() => setShowGradeCriteria(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
            >
              {showGradeCriteria ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showGradeCriteria ? 'Скрыть критерии' : 'Критерии оценки'}
            </button>
          )}
        </div>
      )}

      {/* Ответ */}
      {showAnswer && task.answer_html && (
        <div className="border-t border-blue-100 mx-4 mb-4 pt-3">
          <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Ответ</div>
          <div
            className="prose prose-sm max-w-none text-gray-800 catalog-html"
            dangerouslySetInnerHTML={{ __html: resolve(task.answer_html) }}
          />
        </div>
      )}

      {/* Решение */}
      {showSolution && task.solution_html && (
        <div className="border-t border-purple-100 mx-4 mb-4 pt-3">
          <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">Решение</div>
          <div
            className={`prose prose-sm max-w-none text-gray-800 catalog-html${figureScaleClass}`}
            dangerouslySetInnerHTML={{ __html: resolve(task.solution_html) }}
          />
        </div>
      )}

      {/* План */}
      {showPlan && task.solution_plan_html && (
        <div className="border-t border-amber-100 mx-4 mb-4 pt-3">
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">План решения</div>
          <div
            className="prose prose-sm max-w-none text-gray-800 catalog-html"
            dangerouslySetInnerHTML={{ __html: resolve(task.solution_plan_html) }}
          />
        </div>
      )}

      {/* Критерии */}
      {showGradeCriteria && task.grade_criteria_html && (
        <div className="border-t border-teal-100 mx-4 mb-4 pt-3">
          <div className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-2">Критерии оценки</div>
          <div
            className="prose prose-sm max-w-none text-gray-800 catalog-html"
            dangerouslySetInnerHTML={{ __html: resolve(task.grade_criteria_html) }}
          />
        </div>
      )}
    </div>
  )
}
