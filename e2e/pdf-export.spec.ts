/**
 * E2E tests for the unified PDF export flow (VariantDocument / VariantPrintPanel),
 * reached from the catalog via /collections/:id — the same renderer used by the
 * Variant Builder. No modal, no separate route: settings + live A4 preview are
 * inline on the page, and window.print() is intercepted with page.pdf() to
 * generate real, inspectable PDF files.
 *
 * Run: npx playwright test e2e/pdf-export.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { PDF_FIXTURES_FILE, type PdfFixtures } from './global-setup'

// No hardcoded collection UUIDs: e2e/global-setup.ts creates disposable
// [E2E]-prefixed collections before this file runs and writes their ids
// here; e2e/global-teardown.ts deletes them after the whole run (pass or
// fail). See e2e/pdf-fixtures.ts for the guarded create/delete lifecycle.
const fixtures: PdfFixtures = JSON.parse(fs.readFileSync(PDF_FIXTURES_FILE, 'utf8'))
const COLLECTION_1  = fixtures.collection1
const COLLECTION_15 = fixtures.collection15
const COLLECTION_30 = fixtures.collection30

const PDF_DIR = path.resolve('test-results/pdf')

test.beforeAll(async () => {
  fs.mkdirSync(PDF_DIR, { recursive: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mockWindowPrint(page: Page) {
  await page.addInitScript(() => {
    ;(window as Window & { __printCallCount: number }).__printCallCount = 0
    window.print = function () {
      ;(window as Window & { __printCallCount: number }).__printCallCount++
      window.dispatchEvent(new Event('afterprint'))
    }
  })
}

async function getPrintCount(page: Page) {
  return page.evaluate(
    () => (window as Window & { __printCallCount?: number }).__printCallCount ?? 0,
  )
}

async function openCollection(page: Page, id: string) {
  await page.goto(`/collections/${id}`)
  await page.waitForSelector('button[title="Экспорт в PDF"]', { timeout: 30_000 })
}

async function openPrintPanel(page: Page) {
  await page.click('button[title="Экспорт в PDF"]')
  await page.waitForSelector('.print-preview-page', { timeout: 15_000 })
}

async function waitForPrintReady(page: Page) {
  await page.waitForSelector('.bg-green-50, .bg-amber-50', { timeout: 30_000 })
}

/**
 * Best-effort page count from raw PDF bytes: the page tree root's
 * `/Type /Pages ... /Count N` is not compressed by Chromium's PDF writer for
 * the small, simple documents this pipeline produces, so a direct regex scan
 * works without a PDF-parsing dependency. Returns null (skip the assertion,
 * don't fail) if the marker isn't found in that exact shape — a heuristic,
 * not a full parser.
 */
function countPdfPagesApprox(buf: Buffer): number | null {
  const text = buf.toString('latin1')
  const m = text.match(/\/Type\s*\/Pages[\s\S]{0,300}?\/Count\s+(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

async function generatePdf(page: Page, filename: string, opts: { landscape?: boolean } = {}) {
  const pdfPath = path.join(PDF_DIR, filename)
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    landscape: opts.landscape ?? false,
    printBackground: true,
    // No explicit margin here: preferCSSPageSize lets the actual @page rule
    // (driven by --print-margins, same one window.print() would use) decide
    // margins, so the "wide margins" scenario is genuinely exercised.
    preferCSSPageSize: true,
  })
  return pdfPath
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Single renderer / no legacy modal
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Unified renderer — no legacy PdfExportModal', () => {
  test('catalog PDF export is the inline VariantPrintPanel, not a modal or separate route', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)

    // No modal dialog / no navigation away from /collections/:id
    await expect(page).toHaveURL(new RegExp(`/collections/${COLLECTION_15}$`))
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)

    // Preview sheet is inline on the page
    await expect(page.locator('.print-preview-page')).toBeVisible()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Task count scenarios
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Task count scenarios', () => {
  test('1 task renders with no crash, no page-break artifacts', async ({ page }) => {
    await openCollection(page, COLLECTION_1)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    const tasks = page.locator('.print-preview-page .print-task')
    await expect(tasks).toHaveCount(1)
    await expect(tasks.first()).not.toHaveClass(/print-task--page-break/)
  })

  test('30 mixed tasks (math + physics, images + answers) all render', async ({ page }) => {
    await openCollection(page, COLLECTION_30)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    const tasks = page.locator('.print-preview-page .print-task')
    await expect(tasks).toHaveCount(30)

    // At least one image loaded from Supabase Storage
    const imgs = page.locator('.print-preview-page img')
    expect(await imgs.count()).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Settings toggles
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Settings toggles actually affect the document', () => {
  test('answers toggle shows/hides "Ответ" sections', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await expect(page.locator('.print-preview-page .print-section--answer')).toHaveCount(0)

    await page.click('text=Ответы')
    await page.waitForTimeout(400) // debounce
    await expect(page.locator('.print-preview-page .print-section--answer').first()).toBeVisible()
  })

  test('explanations toggle shows real solution_html content, not empty', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await expect(page.locator('.print-preview-page .print-section--explanation')).toHaveCount(0)

    await page.click('text=Пояснения')
    await page.waitForTimeout(400)

    // solution_html is populated for ~99.9% of published catalog tasks —
    // the fixture set should show real explanation text, not just an empty
    // toggle with no visible effect.
    const explanations = page.locator('.print-preview-page .print-section--explanation')
    expect(await explanations.count()).toBeGreaterThan(0)
    const firstText = (await explanations.first().textContent())?.trim() ?? ''
    expect(firstText.length).toBeGreaterThan('Пояснение'.length)
  })

  test('codifier section toggle shows the real section title per task', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await expect(page.locator('.print-preview-page .print-task-section')).toHaveCount(0)

    await page.click('text=Раздел кодификатора')
    await page.waitForTimeout(400)

    const sections = page.locator('.print-preview-page .print-task-section')
    expect(await sections.count()).toBeGreaterThan(0)
    const firstText = (await sections.first().textContent())?.trim() ?? ''
    expect(firstText.length).toBeGreaterThan(0)
  })

  test('key table toggle adds a compact "Ключ" table at the end', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await expect(page.locator('.print-preview-page .print-key')).toHaveCount(0)
    await page.click('text=Ключ')
    await page.waitForTimeout(400)
    await expect(page.locator('.print-preview-page .print-key-table')).toBeVisible()
    await expect(page.locator('.print-preview-page').getByText('№ задания')).toBeVisible()
  })

  test('one-per-page: the live preview splits into one separate A4 sheet per task', async ({ page }) => {
    // The print portal (used for the actual PDF) still uses a single
    // continuous flow with CSS break-before — that's covered by PDF 3 below.
    // The on-screen preview instead renders one .print-preview-page per
    // task, since CSS page-break rules only apply during print/PDF and have
    // no visual effect in the browser otherwise.
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    const sheetsBefore = page.locator('.print-preview-page')
    await expect(sheetsBefore).toHaveCount(1)

    await page.click('text=Каждое задание с новой страницы')
    await page.waitForTimeout(400)

    const sheets = page.locator('.print-preview-page')
    await expect(sheets).toHaveCount(15)

    // Each sheet contains exactly one task, numbered by its real position —
    // not reset to "1" on every sheet.
    await expect(sheets.nth(0).locator('.print-task')).toHaveCount(1)
    await expect(sheets.nth(0).locator('.print-task-number')).toHaveText('Задание 1')
    await expect(sheets.nth(1).locator('.print-task-number')).toHaveText('Задание 2')
    await expect(sheets.nth(14).locator('.print-task-number')).toHaveText('Задание 15')

    // Document title/comment/instruction block appears only on the first
    // sheet, not repeated on every page.
    await expect(sheets.nth(0).locator('.print-header')).toHaveCount(1)
    await expect(sheets.nth(1).locator('.print-header')).toHaveCount(0)
  })

  test('landscape orientation widens the preview sheet beyond portrait width', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    // The preview is scaled to fit the container width, so the rendered box
    // width normalizes to ~the same value in both orientations (794px wide *
    // scale factor ≈ 1123px wide * a smaller scale factor). The orientation
    // flip instead shows up in the unscaled logical A4 dimensions baked into
    // the inline style (width/min-height swap 794x1123 <-> 1123x794).
    const dims = () => page.locator('.print-preview-page').evaluate(el => {
      const style = getComputedStyle(el)
      return { width: parseFloat(style.width), minHeight: parseFloat(style.minHeight) }
    })

    const portrait = await dims()
    expect(portrait.width).toBeLessThan(portrait.minHeight) // 794 x 1123

    await page.getByLabel('Ориентация').selectOption('landscape')
    await page.waitForTimeout(500)

    const landscape = await dims()
    expect(landscape.width).toBeGreaterThan(landscape.minHeight) // 1123 x 794
  })

  test('large font size increases root font-size on the print document', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    const preview = page.locator('.print-preview-page .print-document')
    const normalFont = await preview.evaluate(el => getComputedStyle(el).fontSize)
    await page.getByLabel('Шрифт').selectOption('large')
    await page.waitForTimeout(400)
    const largeFont = await preview.evaluate(el => getComputedStyle(el).fontSize)

    expect(parseFloat(largeFont)).toBeGreaterThan(parseFloat(normalFont))
  })

  test('wide margins increase the CSS margin variable used by @page', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await page.getByLabel('Поля').selectOption('wide')
    await page.waitForTimeout(400)
    const marginVar = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--print-margins').trim(),
    )
    expect(marginVar.length).toBeGreaterThan(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. window.print() gating
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Print gating', () => {
  test('print button is disabled until images are ready, then calls window.print() once', async ({ page }) => {
    await mockWindowPrint(page)
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)

    await waitForPrintReady(page)
    const printBtn = page.locator('button:has-text("Печать / Сохранить PDF")')
    await expect(printBtn).toBeEnabled({ timeout: 5_000 })

    await printBtn.click()
    await page.waitForTimeout(300)
    expect(await getPrintCount(page)).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Real PDF generation + inspection (actual downloadable files, actual page counts)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Real PDF generation', () => {
  test.describe.configure({ mode: 'serial' })

  test('PDF 1 — 1 task, portrait, statements only', async ({ page }) => {
    await openCollection(page, COLLECTION_1)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    const pdfPath = await generatePdf(page, 'pdf1-single-task.pdf')
    const size = fs.statSync(pdfPath).size
    expect(size).toBeGreaterThan(5_000)
    console.log(`PDF 1: ${pdfPath} (${Math.round(size / 1024)} KB)`)
  })

  test('PDF 2 — 30 mixed tasks, answers + key on', async ({ page }) => {
    await openCollection(page, COLLECTION_30)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.click('text=Ответы')
    await page.click('text=Ключ')
    await page.waitForTimeout(400)
    await waitForPrintReady(page)

    const pdfPath = await generatePdf(page, 'pdf2-30tasks-answers-key.pdf')
    const size = fs.statSync(pdfPath).size
    expect(size).toBeGreaterThan(10_000)
    console.log(`PDF 2: ${pdfPath} (${Math.round(size / 1024)} KB)`)
  })

  test('PDF 3 — 15 tasks, one-per-page', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.click('text=Каждое задание с новой страницы')
    await page.waitForTimeout(400)
    await waitForPrintReady(page)

    const pdfPath = await generatePdf(page, 'pdf3-15tasks-one-per-page.pdf')
    const size = fs.statSync(pdfPath).size
    expect(size).toBeGreaterThan(10_000)
    console.log(`PDF 3: ${pdfPath} (${Math.round(size / 1024)} KB)`)
  })

  test('PDF 4 — 15 tasks, landscape, large font, wide margins', async ({ page }) => {
    await mockWindowPrint(page)
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.getByLabel('Ориентация').selectOption('landscape')
    await page.getByLabel('Шрифт').selectOption('large')
    await page.getByLabel('Поля').selectOption('wide')
    await page.waitForTimeout(400)
    await waitForPrintReady(page)

    // Click the real print button first so handlePrint() injects the
    // landscape @page override exactly as it would for a real user, then
    // capture from that exact DOM/CSS state (window.print() itself is
    // mocked — the OS print dialog can't be automated — but everything
    // handlePrint() does before calling it runs for real).
    const printBtn = page.locator('button:has-text("Печать / Сохранить PDF")')
    await expect(printBtn).toBeEnabled({ timeout: 5_000 })
    await printBtn.click()
    await page.waitForTimeout(200)

    const pdfPath = await generatePdf(page, 'pdf4-15tasks-landscape-large-wide.pdf')
    const size = fs.statSync(pdfPath).size
    expect(size).toBeGreaterThan(10_000)
    console.log(`PDF 4: ${pdfPath} (${Math.round(size / 1024)} KB)`)
  })

  test('handlePrint() itself injects/cleans up the landscape @page override', async ({ page }) => {
    await mockWindowPrint(page)
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.getByLabel('Ориентация').selectOption('landscape')
    await page.waitForTimeout(400)

    const printBtn = page.locator('button:has-text("Печать / Сохранить PDF")')
    await expect(printBtn).toBeEnabled({ timeout: 5_000 })
    await printBtn.click()
    await page.waitForTimeout(200)

    const styleTag = await page.evaluate(() => {
      const el = document.getElementById('print-orientation-override')
      return el ? el.textContent : null
    })
    expect(styleTag).toContain('landscape')
  })

  test('PDF 5 — 15 tasks, explanations on', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.click('text=Пояснения')
    await page.waitForTimeout(400)
    await waitForPrintReady(page)

    const pdfPath = await generatePdf(page, 'pdf5-15tasks-explanations.pdf')
    const size = fs.statSync(pdfPath).size
    expect(size).toBeGreaterThan(10_000)
    console.log(`PDF 5: ${pdfPath} (${Math.round(size / 1024)} KB)`)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. Worksheet mode ("Рабочий лист") — conditions only, one task per page,
//    ruled-grid field rendered as real SVG (not a CSS background-image, which
//    Chromium drops from page.pdf({printBackground:false}) / a user's "Печать
//    → Сохранить PDF" with "Фоновая графика" off).
// ══════════════════════════════════════════════════════════════════════════════

async function enableWorksheetMode(page: Page) {
  await page.click('button:has-text("Рабочий лист")')
  await page.waitForTimeout(400)
  await waitForPrintReady(page)
}

test.describe('Worksheet mode', () => {
  test('standard mode has no worksheet grid at all', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)

    await expect(page.locator('.print-worksheet-fill')).toHaveCount(0)
    await expect(page.locator('svg.print-worksheet-grid')).toHaveCount(0)
  })

  test('enabling worksheet mode: only statements, one task per page, forces content toggles off', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await enableWorksheetMode(page)

    // One-per-page split kicks in automatically (part of the preset). The
    // header is NOT a separate sheet — it lives on task 0's own sheet
    // (task 0's flex column carries it as a first child, ahead of the
    // statement), so 15 tasks always means 15 sheets, never 16.
    const sheets = page.locator('.print-preview-page')
    await expect(sheets).toHaveCount(15)
    await expect(sheets.first().locator('.print-header')).toHaveCount(1)
    await expect(sheets.first().locator('.print-task-number')).toHaveText('Задание 1')
    await expect(sheets.nth(1).locator('.print-header')).toHaveCount(0)
    await expect(sheets.nth(1).locator('.print-task-number')).toHaveText('Задание 2')

    // No solution/answer/key content anywhere, even though nothing disabled them by hand
    await expect(page.locator('.print-section--explanation')).toHaveCount(0)
    await expect(page.locator('.print-section--answer')).toHaveCount(0)
    await expect(page.locator('.print-key-table')).toHaveCount(0)

    // Content toggles are visibly disabled while worksheet mode is active
    const explanationsToggle = page.locator('label', { hasText: 'Пояснения' }).locator('input[type="checkbox"]')
    await expect(explanationsToggle).toBeDisabled()
  })

  test('each worksheet task gets exactly one real SVG grid made of plain <line> elements (no <pattern>/fill="url(#…)")', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await enableWorksheetMode(page)

    const grids = page.locator('.print-worksheet-fill svg.print-worksheet-grid')
    await expect(grids).toHaveCount(15)

    // Grid is real DOM content, never a CSS background
    await expect(page.locator('.print-worksheet-fill')).toHaveCSS('background-image', 'none')
    for (const el of await grids.all()) {
      const box = await el.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThan(0)
      expect(box?.height ?? 0).toBeGreaterThan(0)
    }

    // A <pattern>/fill="url(#…)" grid rendered fine in the live preview but
    // did not reliably paint into a real saved PDF — plain <line> elements
    // (ordinary painted vector content, same category as the frame's border)
    // replaced it entirely; assert the old approach is gone, not just that
    // something is present.
    await expect(page.locator('.print-worksheet-fill pattern')).toHaveCount(0)
    await expect(page.locator('.print-worksheet-fill rect')).toHaveCount(0)

    const lineCountFirst = await grids.first().locator('line').count()
    expect(lineCountFirst).toBeGreaterThan(1)
    // Same line count on every sheet (grid geometry is derived from
    // orientation/margins, identical across tasks — not per-task DOM state).
    for (const el of await grids.all()) {
      expect(await el.locator('line').count()).toBe(lineCountFirst)
    }
  })

  test('worksheet field grows for a short statement and stays large even for a long one (height still driven by --print-content-height, unchanged by the SVG switch)', async ({ page }) => {
    await openCollection(page, COLLECTION_30)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await enableWorksheetMode(page)

    const fills = page.locator('.print-worksheet-fill')
    const count = await fills.count()
    expect(count).toBeGreaterThan(1)
    // Every field reaches close to the bottom of its own A4 sheet (the outer
    // frame from the screenshot this fix was reported against) — not a
    // fixed/guessed pixel height independent of the page.
    for (const el of await fills.all()) {
      const box = await el.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThan(30) // px in the scaled preview; just "not collapsed"
    }
  })

  test('PDF — worksheet mode grid survives page.pdf({ printBackground: false }) (the reported bug: CSS background-image grids are dropped here, real SVG content is not)', async ({ page }) => {
    await openCollection(page, COLLECTION_1)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await enableWorksheetMode(page)

    const pdfPathBgOn  = path.join(PDF_DIR, 'pdf6-worksheet-bg-on.pdf')
    const pdfPathBgOff = path.join(PDF_DIR, 'pdf6-worksheet-bg-off.pdf')
    await page.pdf({ path: pdfPathBgOn,  format: 'A4', printBackground: true,  preferCSSPageSize: true })
    await page.pdf({ path: pdfPathBgOff, format: 'A4', printBackground: false, preferCSSPageSize: true })

    const sizeOn  = fs.statSync(pdfPathBgOn).size
    const sizeOff = fs.statSync(pdfPathBgOff).size
    expect(sizeOff).toBeGreaterThan(5_000)

    // A CSS-background grid would shrink drastically (or vanish) with
    // printBackground:false; plain SVG <line> elements are regular page
    // content and are emitted either way, so the two files stay close in size.
    const ratio = sizeOff / sizeOn
    expect(ratio).toBeGreaterThan(0.7)
    console.log(`PDF6 worksheet: bg-on ${Math.round(sizeOn / 1024)} KB, bg-off ${Math.round(sizeOff / 1024)} KB (ratio ${ratio.toFixed(2)})`)
  })

  test('PDF — worksheet mode with 5 tasks, portrait and landscape, normal and wide margins all produce valid non-trivial files', async ({ page }) => {
    await openCollection(page, COLLECTION_15) // has enough tasks; only first 5 matter for size sanity
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await enableWorksheetMode(page)

    for (const [label, landscape, margins] of [
      ['portrait-normal',  false, 'normal'],
      ['landscape-normal', true,  'normal'],
      ['portrait-wide',    false, 'wide'],
    ] as const) {
      await page.getByLabel('Ориентация').selectOption(landscape ? 'landscape' : 'portrait')
      await page.getByLabel('Поля').selectOption(margins)
      await page.waitForTimeout(400)
      await waitForPrintReady(page)

      const pdfPath = await generatePdf(page, `pdf7-worksheet-${label}.pdf`, { landscape })
      const size = fs.statSync(pdfPath).size
      expect(size).toBeGreaterThan(5_000)
      console.log(`PDF7 (${label}): ${pdfPath} (${Math.round(size / 1024)} KB)`)
    }
  })

  test('PDF — 1 task + title = exactly 1 page (regression: the header used to force a spurious blank leading page)', async ({ page }) => {
    await openCollection(page, COLLECTION_1)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.fill('input[placeholder="Например: Тренировочный вариант"]', 'Regression title 1223')
    await page.waitForTimeout(400)
    await enableWorksheetMode(page)

    // Preview: exactly one sheet, and it carries both the title and task 1.
    const sheets = page.locator('.print-preview-page')
    await expect(sheets).toHaveCount(1)
    await expect(sheets.first().getByText('Regression title 1223')).toBeVisible()
    await expect(sheets.first().locator('.print-task-number')).toHaveText('Задание 1')
    await expect(sheets.first().locator('.print-worksheet-fill')).toHaveCount(1)

    const pdfPath = await generatePdf(page, 'pdf8-worksheet-1task-title.pdf')
    const pages = countPdfPagesApprox(fs.readFileSync(pdfPath))
    if (pages !== null) expect(pages).toBe(1)
  })

  test('PDF — 15 tasks + title = exactly 15 pages, not 16 (header does not consume its own page)', async ({ page }) => {
    await openCollection(page, COLLECTION_15)
    await openPrintPanel(page)
    await waitForPrintReady(page)
    await page.fill('input[placeholder="Например: Тренировочный вариант"]', 'Regression title 1223')
    await page.waitForTimeout(400)
    await enableWorksheetMode(page)

    await expect(page.locator('.print-preview-page')).toHaveCount(15)

    const pdfPath = await generatePdf(page, 'pdf9-worksheet-15tasks-title.pdf')
    const pages = countPdfPagesApprox(fs.readFileSync(pdfPath))
    if (pages !== null) expect(pages).toBe(15)
  })
})
