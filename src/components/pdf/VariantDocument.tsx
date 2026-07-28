import { forwardRef } from 'react'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import {
  buildKeyTable,
  resolveSourceLabel,
  resolveSectionLabel,
  printContentWidthMm,
  printContentHeightMm,
  shouldBoostPrintFigures,
  type PrintableItem,
  type KeyEntry,
} from '@/utils/variantPrintUtils'
import type { VariantPrintSettings } from '@/types/variantPrint'

interface Props {
  items:    PrintableItem[]
  settings: VariantPrintSettings
  /**
   * Numbering offset for `items` — lets a caller render a subset of the full
   * task list (e.g. one sheet per task in the live preview's one-per-page
   * split) while task numbers still reflect their position in the whole
   * document. Defaults to 0 (numbering starts at `items[0]` = "1"), which is
   * exactly the previous behavior for a single full-document call.
   */
  startIndex?:     number
  /** Render the running header / title / comment / instruction block. Default true (unchanged). */
  showTitleBlock?: boolean
  /** Render the trailing "Ключ" table (still also gated on settings.showKey). Default true (unchanged). */
  showKeyTable?:   boolean
  /** Precomputed key rows — falls back to computing from `items` (unchanged default: same as before). */
  keyRows?:        KeyEntry[]
  /**
   * Suppress the "Задания не выбраны" placeholder when `items` is
   * intentionally empty (a header-only or key-only sheet in the live
   * preview's per-page split), as opposed to a genuinely empty document.
   * Default false (unchanged existing behavior).
   */
  hideEmptyMessage?: boolean
}

/**
 * Single source of truth for variant document markup. Used for BOTH the
 * inline live preview and the print portal — same component, same classes,
 * so preview and printed output can never drift apart.
 */
export const VariantDocument = forwardRef<HTMLDivElement, Props>(
  function VariantDocument(
    { items, settings, startIndex = 0, showTitleBlock = true, showKeyTable = true, keyRows: keyRowsProp, hideEmptyMessage = false },
    ref,
  ) {
    const {
      title, comment, instruction, headerLeft, variantNumber,
      showNumbers, showExplanations, showAnswers, showKey,
      showSource, showCodifierSection, onePerPage, mode,
      orientation, margins,
    } = settings

    // Worksheet mode is a fixed preset (conditions only, one task per page,
    // ruled grid to fill the rest) — it overrides these toggles at render
    // time rather than mutating the stored settings, so switching back to
    // 'standard' restores whatever the user had before.
    const isWorksheet = mode === 'worksheet'
    const effShowExplanations = !isWorksheet && showExplanations
    const effShowAnswers      = !isWorksheet && showAnswers
    const effShowKey          = !isWorksheet && showKey

    const keyRows = keyRowsProp ?? (effShowKey ? buildKeyTable(items) : [])

    // Grid line counts: the field's rendered width always equals the page
    // content width (same column as the statement above it), and its height
    // never exceeds the page content height — both computable from
    // orientation/margins alone, no DOM measurement needed. Lines are
    // generated to cover the full content box; `.print-worksheet-fill`'s
    // `overflow: hidden` clips whatever falls below a given task's actual
    // (shorter) height, so one shared line set works for every task.
    const worksheetGridLinesX = isWorksheet
      ? gridLinePositions(mmToPx(printContentWidthMm(orientation, margins)))
      : []
    const worksheetGridLinesY = isWorksheet
      ? gridLinePositions(mmToPx(printContentHeightMm(orientation, margins)))
      : []

    // Running header / title block. In worksheet mode this is rendered
    // *inside* task 0's own flex column (see isFirstWorksheetPageWithHeader
    // below) instead of as a page-level sibling — that way it takes its
    // natural height as a normal flex child, and the grid field (flex:1
    // 1 auto) automatically absorbs whatever height is left on the page,
    // with no need to measure or hardcode the header's height. Standard
    // mode keeps the header as a page-level sibling, unchanged.
    const headerBlock = (
      <>
        {(headerLeft || variantNumber) && (
          <div className="print-running-header">
            <span>{headerLeft}</span>
            {variantNumber && <span>Вариант № {variantNumber}</span>}
          </div>
        )}
        {showTitleBlock && (
          <div className="print-header">
            {title && <h1 className="print-title">{title}</h1>}
            {comment && <p className="print-comment">{comment}</p>}
            {instruction && (
              <div className="print-instruction">
                <p className="print-section-label">Инструкция</p>
                <p>{instruction}</p>
              </div>
            )}
          </div>
        )}
      </>
    )

    return (
      <div ref={ref} className="print-document">
        {!isWorksheet && headerBlock}

        {/* ── Tasks ──────────────────────────────────────────────── */}
        <div className="print-tasks">
          {items.length === 0 ? (
            hideEmptyMessage ? null : <p className="print-no-content">Задания не выбраны</p>
          ) : (
            items.map((item, idx) => {
              const task = item.task
              const num = item.customNumber ?? String(startIndex + idx + 1)
              // Worksheet mode: every task gets its own full page
              // (break-before on every task except the very first — the
              // first starts wherever the document naturally begins, exactly
              // like every other mode). Task 0 additionally carries the
              // header/title block as its first flex child (see headerBlock
              // above) instead of that block eating into the page from
              // outside the task's own min-height box.
              const pageBreak = isWorksheet
                ? idx > 0
                : (onePerPage && idx > 0)
              const isFirstWorksheetPageWithHeader = isWorksheet && idx === 0 && showTitleBlock
              const taskClassName = `print-task${pageBreak ? ' print-task--page-break' : ''}${isWorksheet ? ' print-task--worksheet' : ''}`

              if (!task) {
                return (
                  <div key={item.id} className={taskClassName}>
                    {isFirstWorksheetPageWithHeader && headerBlock}
                    {showNumbers && <p className="print-task-number">Задание {num}</p>}
                    <p className="print-task-unavailable">Задача недоступна</p>
                  </div>
                )
              }

              const stmt = resolveTaskHtml(task.statement_html, task.assets)
              // solution_html is the real, populated explanation field
              // (~99.9% of tasks); solution_plan_html is a separate, much
              // rarer field (~0.4%) — fall back to it only when the primary
              // field is empty, never fabricate content.
              const explanationSource = task.solution_html || task.solution_plan_html
              const explanationHtml =
                effShowExplanations && explanationSource
                  ? resolveTaskHtml(explanationSource, task.assets)
                  : ''
              const answerHtml =
                effShowAnswers && task.has_answer && task.answer_html
                  ? resolveTaskHtml(task.answer_html, task.assets)
                  : ''
              const sourceLabel = showSource ? resolveSourceLabel(task) : null
              const sectionLabel = showCodifierSection ? resolveSectionLabel(task) : null
              // Физика ЕГЭ: иллюстрации в PDF укрупняются (см. shouldBoostPrintFigures)
              const figuresBoostClass = shouldBoostPrintFigures(task) ? ' print-figures-boost' : ''

              return (
                <div key={item.id} className={taskClassName}>
                  {isFirstWorksheetPageWithHeader && headerBlock}
                  <div className="print-task-head">
                    {showNumbers && <p className="print-task-number">Задание {num}</p>}
                    {sectionLabel && <p className="print-task-section">{sectionLabel}</p>}
                  </div>

                  <div
                    className={`catalog-html print-statement${figuresBoostClass}`}
                    dangerouslySetInnerHTML={{ __html: stmt }}
                  />

                  {sourceLabel && (
                    <p className="print-source">Источник: {sourceLabel}</p>
                  )}

                  {explanationHtml && (
                    <div className="print-section print-section--explanation">
                      <p className="print-section-label">Решение</p>
                      <div className={`catalog-html${figuresBoostClass}`} dangerouslySetInnerHTML={{ __html: explanationHtml }} />
                    </div>
                  )}

                  {effShowAnswers && (
                    <div className="print-section print-section--answer">
                      <p className="print-section-label">Ответ</p>
                      {answerHtml ? (
                        <div className="catalog-html" dangerouslySetInnerHTML={{ __html: answerHtml }} />
                      ) : (
                        <p className="print-no-content">Ответ не указан</p>
                      )}
                    </div>
                  )}

                  {isWorksheet && <WorksheetGrid linesX={worksheetGridLinesX} linesY={worksheetGridLinesY} />}
                </div>
              )
            })
          )}
        </div>

        {/* ── Key table ──────────────────────────────────────────── */}
        {showKeyTable && effShowKey && keyRows.length > 0 && (
          <div className="print-key print-task--page-break">
            <h2 className="print-section-heading">Ключ</h2>
            <table className="print-key-table">
              <thead>
                <tr>
                  <th>№ задания</th>
                  <th>Ответ</th>
                </tr>
              </thead>
              <tbody>
                {keyRows.map(row => (
                  <tr key={row.itemId}>
                    <td>{row.number}</td>
                    <td>{row.shortAnswer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }
)

// ── Worksheet grid ────────────────────────────────────────────────────────────

// 5mm at the standard 96 CSS px/inch (1mm = 96/25.4px) — matches the mm-based
// page geometry used everywhere else in this pipeline (marginsToCss,
// printContentHeightMm/printContentWidthMm), converted once here because SVG
// coordinate attributes (x1/y1/x2/y2 with no viewBox) are plain numbers.
const MM_TO_PX = 96 / 25.4
const WORKSHEET_CELL_PX = 5 * MM_TO_PX

function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

/** Line positions 0, cell, 2*cell, … through (and one past) `maxPx`, so the
 *  drawn grid always fully covers a box up to `maxPx` tall/wide regardless of
 *  rounding. Only used as an upper bound — see worksheetGridLinesX/Y above:
 *  `.print-worksheet-fill`'s `overflow: hidden` clips whatever a shorter task
 *  field doesn't need, so the same array works for every task. */
function gridLinePositions(maxPx: number): number[] {
  const count = Math.ceil(maxPx / WORKSHEET_CELL_PX) + 1
  return Array.from({ length: count }, (_, i) => i * WORKSHEET_CELL_PX)
}

/**
 * Ruled "клетка" field for worksheet mode, rendered as real SVG <line>
 * elements (not a CSS background-image, and not a <pattern>/fill="url(#…)").
 * Two prior attempts both failed to reach a real, browser-saved PDF:
 *   1. CSS background-image — Chromium drops CSS backgrounds from
 *      "Печать → Сохранить PDF" unless the user enables "Фоновая графика".
 *   2. SVG <pattern> tile filled via fill="url(#id)" — rendered correctly in
 *      the live preview, but Chromium's print/PDF pipeline did not reliably
 *      paint the pattern fill into the saved PDF (pattern resolution across
 *      the print rasterizer proved unreliable; the pattern's own defining
 *      elements are outside the normal paint order that print reuses).
 * Plain <line> elements are ordinary painted vector content with no
 * indirection through `fill="url(#...)"` or a `<defs>` reference — the same
 * kind of primitive the frame's `border` and the task/answer text already
 * are, both of which always printed correctly, which is what makes this
 * approach reliable rather than a third guess.
 */
function WorksheetGrid({ linesX, linesY }: { linesX: number[]; linesY: number[] }) {
  return (
    <div className="print-worksheet-fill" aria-hidden="true">
      <svg className="print-worksheet-grid" width="100%" height="100%">
        {linesX.map(x => (
          <line
            key={`v-${x}`}
            x1={x} y1={0} x2={x} y2="100%"
            stroke="#94a3b8" strokeOpacity={0.45} strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {linesY.map(y => (
          <line
            key={`h-${y}`}
            x1={0} y1={y} x2="100%" y2={y}
            stroke="#94a3b8" strokeOpacity={0.45} strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  )
}
