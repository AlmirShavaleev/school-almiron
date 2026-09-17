/**
 * §197: разделы 1–8 этого файла проверяли контур «Этапа 4» — выдачу подборки
 * как работы (`assigned_collections`, `task_submissions`, страницы
 * `/assign-homework`, `/review-submissions`, `/my-assignments`). Контур снят с
 * фронта, и проверки ушли вместе с ним: зелёный тест обязан ссылаться на живой
 * файл.
 *
 * Осталось то, что «Этап 4» никогда и не трогал, — подборки каталога и единый
 * рисовальщик PDF. Они живы (41 подборка на проде, печать из карточки), и
 * страховка от их случайного сноса нужна ровно так же, как была.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
function read(rel: string) { return readFileSync(join(ROOT, rel), 'utf8') }
function exists(rel: string) { return existsSync(join(ROOT, rel)) }

// ══════════════════════════════════════════════════════════════════════════════
// 9. Etap 1-3 non-regression
// ══════════════════════════════════════════════════════════════════════════════

describe('Etap 1-3 non-regression', () => {
  it('CollectionDetailPage still uses task_collections/task_collection_items as before', () => {
    const src = read('src/pages/CollectionDetailPage.tsx')
    expect(src).toContain('useCollection')
    expect(src).toContain('VariantPrintPanel')
  })

  it('VariantDocument (unified renderer) still uses resolveTaskHtml, answers/explanations intact', () => {
    const src = read('src/components/pdf/VariantDocument.tsx')
    expect(src).toContain('resolveTaskHtml')
    expect(src).toContain('showAnswers')
    expect(src).toContain('showExplanations')
  })

  it('legacy PdfExportModal/PrintDocument/pdfTypes were removed — single PDF renderer only', () => {
    expect(exists('src/components/pdf/PdfExportModal.tsx')).toBe(false)
    expect(exists('src/components/pdf/PrintDocument.tsx')).toBe(false)
    expect(exists('src/components/pdf/pdfTypes.ts')).toBe(false)
  })
})
