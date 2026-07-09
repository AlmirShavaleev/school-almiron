import { test, expect, chromium, type BrowserContext, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { AUTH_FILE } from './global-setup'

test.describe.configure({ mode: 'serial' })

const STUDENT_EMAIL = 'alex@demo.ru'
const STUDENT_PASSWORD = 'demo123'
const STUDENT_NAME = 'Алексей Петров'
const COMMENT_SUFFIX = `(e2e ${Date.now().toString(36)})`
const COMMENT_TEXT = `Проверь знаки ${COMMENT_SUFFIX}`
const REVIEW_FIXTURE_PDF = path.resolve('doc_web/data/uploads/02847eb2.pdf')
const REVIEW_FIXTURE_JPG = path.resolve('doc_web/data/uploads/043c2965.jpg')

let teacherCtx: BrowserContext
let studentCtx: BrowserContext
let teacherPage: Page
let studentPage: Page

type ReviewTarget = {
  studentName: string
  homeworkTitle: string
}

test.beforeAll(async () => {
  const browser = await chromium.launch()

  teacherCtx = await browser.newContext({ storageState: AUTH_FILE })
  teacherPage = await teacherCtx.newPage()

  studentCtx = await browser.newContext()
  studentPage = await studentCtx.newPage()
  await loginAsStudent(studentPage)
})

test.afterAll(async () => {
  await teacherCtx.close()
  await studentCtx.close()
})

test('teacher review cycle persists draft, publishes, returns to queue, and is visible to student — across a two-file submission', async () => {
  test.slow()

  const target = await createStudentSubmission(teacherPage, studentPage)

  await openQueueReview(teacherPage, target)
  await expect(teacherPage.getByTestId('student-review-page')).toBeVisible()
  await expect(teacherPage.getByTestId('review-overlay-1')).toBeVisible()

  // Comment on the SECOND file, not the first — this is the whole point of
  // the multi-file smoke: prove the continuous strip actually keeps each
  // file's regions keyed to that file, not just to a page number that
  // happens to be 1 in the single-file case.
  const secondFileOverlay = secondFileOverlayLocator(teacherPage)
  await secondFileOverlay.scrollIntoViewIfNeeded()
  await drawRegion(secondFileOverlay)
  await teacherPage.getByTestId('comment-category-calc').click()
  await teacherPage.getByRole('button', { name: 'Проверь знаки' }).click()
  await teacherPage.getByTestId('comment-editor-text').fill(COMMENT_TEXT)
  await teacherPage.getByTestId('comment-editor-save').click()
  await expect(teacherPage.getByTestId('comment-list-item').filter({ hasText: COMMENT_TEXT })).toBeVisible()

  await teacherPage.getByTestId('student-review-back-button').click()
  await teacherPage.waitForURL(/\/inbox/)

  await openQueueReview(teacherPage, target)
  await expect(teacherPage.getByTestId('comment-list-item').filter({ hasText: COMMENT_TEXT })).toBeVisible()

  await scrollToGradingCard(teacherPage)
  await teacherPage.getByTestId('student-review-score-input').fill('85')
  await teacherPage.getByTestId('student-review-publish-button').click()
  await expect(teacherPage.locator('text=Проверка опубликована')).toBeVisible({ timeout: 15_000 })
  await teacherPage.waitForURL(/\/inbox/, { timeout: 15_000 })

  await teacherPage.getByTestId('queue-tab-checked').click()
  await expect(queueItemByTarget(teacherPage, target)).toBeVisible({ timeout: 15_000 })

  await studentPage.goto('/homeworks')
  await studentPage.waitForSelector('[data-testid="homework-card"]', { timeout: 20_000 })
  const studentCard = studentPage.getByTestId('homework-card').filter({ hasText: target.homeworkTitle }).first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByTestId('view-review-button').click()
  await expect(studentPage.getByTestId('review-overlay-1')).toBeVisible({ timeout: 15_000 })
  await expect(studentPage.getByTestId('comment-list-item').filter({ hasText: COMMENT_TEXT })).toBeVisible()
  await expect(studentPage.getByTestId('comment-editor')).toHaveCount(0)
  await expect(studentPage.getByLabel('Удалить комментарий')).toHaveCount(0)

  // The published region actually rendered on the second file, not just
  // listed in the sidebar as text.
  const studentSecondOverlay = secondFileOverlayLocator(studentPage)
  await studentSecondOverlay.scrollIntoViewIfNeeded()
  await expect(studentSecondOverlay.locator('rect')).toHaveCount(1)

  // Teardown: send this submission back to "revision" through the teacher
  // UI so the demo student has a "Пересдать" card again afterwards. The
  // same submit-homework-button testid renders for both not_submitted and
  // revision cards (see HomeworksPage.tsx), so the next smoke run's
  // createStudentSubmission finds it through the exact same selector —
  // closing the idempotency loop without touching the database directly.
  await teacherPage.getByTestId('queue-tab-checked').click()
  await queueItemByTarget(teacherPage, target).click()
  await teacherPage.waitForURL(/\/homeworks\/.+\/review\//, { timeout: 15_000 })
  await scrollToGradingCard(teacherPage)
  await teacherPage.getByTestId('student-review-revision-button').click()
  await expect(teacherPage.locator('text=Отправлено на доработку')).toBeVisible({ timeout: 15_000 })
  await teacherPage.waitForURL(/\/inbox/, { timeout: 15_000 })

  await studentPage.goto('/homeworks')
  await studentPage.waitForSelector('[data-testid="homework-card"]', { timeout: 20_000 })
  await expect(studentCard.getByTestId('submit-homework-button')).toHaveText('Пересдать', { timeout: 15_000 })
})

async function loginAsStudent(page: Page) {
  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await page.fill('input[type="email"]', STUDENT_EMAIL)
  await page.fill('input[type="password"]', STUDENT_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })
}

async function createStudentSubmission(teacherPage: Page, studentPage: Page): Promise<ReviewTarget> {
  await studentPage.goto('/homeworks')
  await studentPage.waitForSelector('[data-testid="homework-card"]', { timeout: 20_000 })

  const candidateCard = studentPage.locator('[data-testid="homework-card"]').filter({
    has: studentPage.locator('[data-testid="submit-homework-button"]'),
  }).first()
  let found = await candidateCard.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)

  if (!found) {
    // A prior run may have died mid-test, after uploading but before its
    // own teardown ran — leaving the submission stuck in "submitted" with
    // no UI path back to "not_submitted"/"revision" for the student. alex@demo.ru
    // is a dedicated e2e account (never touched by real students or manual
    // QA in parallel), so ANY item sitting in the teacher's pending queue
    // for this exact student is, by construction, that orphan — nothing
    // else can put one there between runs. Self-heal it the same way the
    // successful-run teardown would have.
    const healed = await healStuckSubmission(teacherPage)
    if (healed) {
      await studentPage.reload()
      found = await candidateCard.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
    }
  }

  if (!found) {
    throw new Error(
      'Нет доступных ДЗ для smoke: у демо-ученика (alex@demo.ru) не осталось ни одного ДЗ ' +
      'со статусом "не сдано" или "на доработке", и в очереди учителя нет висящей "submitted" ' +
      'сдачи от этого ученика для авто-восстановления. Починка данных вручную не нужна — ' +
      'разберись, почему self-heal не сработал.',
    )
  }

  const homeworkTitle = (await candidateCard.locator('h3').textContent())?.trim()
  if (!homeworkTitle) throw new Error('Не удалось определить заголовок ДЗ для e2e smoke')

  await candidateCard.getByTestId('submit-homework-button').click()
  await expect(studentPage.getByTestId('submit-homework-modal')).toBeVisible({ timeout: 10_000 })
  // Two files (PDF + JPG) — the whole point of this smoke is to prove the
  // continuous multi-file strip, not the single-file path.
  await studentPage.getByTestId('submit-homework-file-input').setInputFiles([REVIEW_FIXTURE_PDF, REVIEW_FIXTURE_JPG])
  await studentPage.getByTestId('submit-homework-submit').click()
  await expect(studentPage.locator('text=Работа отправлена')).toBeVisible({ timeout: 15_000 })

  const target: ReviewTarget = { studentName: STUDENT_NAME, homeworkTitle }
  await teacherPage.goto('/inbox')
  await teacherPage.getByTestId('queue-tab-pending').click()
  await expect(queueItemByTarget(teacherPage, target)).toBeVisible({ timeout: 20_000 })
  return target
}

async function healStuckSubmission(teacherPage: Page): Promise<boolean> {
  await teacherPage.goto('/inbox')
  await teacherPage.getByTestId('queue-tab-pending').click()
  await teacherPage.waitForLoadState('networkidle')

  const stuck = teacherPage.getByTestId('queue-item').filter({
    has: teacherPage.getByTestId('queue-item-student').filter({ hasText: STUDENT_NAME }),
  }).first()
  const found = await stuck.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)
  if (!found) return false

  await stuck.click()
  await teacherPage.waitForURL(/\/homeworks\/.+\/review\//, { timeout: 15_000 })
  await scrollToGradingCard(teacherPage)
  await teacherPage.getByTestId('student-review-revision-button').click()
  await expect(teacherPage.locator('text=Отправлено на доработку')).toBeVisible({ timeout: 15_000 })
  await teacherPage.waitForURL(/\/inbox/, { timeout: 15_000 })
  return true
}

function secondFileOverlayLocator(page: Page): Locator {
  return page.locator('[data-surface-key="2:1"]').locator('svg[data-testid^="review-overlay-"]')
}

async function openQueueReview(page: Page, target: ReviewTarget) {
  await page.goto('/inbox')
  await page.getByTestId('queue-tab-pending').click()
  const item = queueItemByTarget(page, target)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await page.waitForURL(/\/homeworks\/.+\/review\//, { timeout: 15_000 })
}

function queueItemByTarget(page: Page, target: ReviewTarget) {
  return page.getByTestId('queue-item').filter({
    has: page.getByTestId('queue-item-student').filter({ hasText: target.studentName }),
  }).filter({
    has: page.getByTestId('queue-item-homework').filter({ hasText: target.homeworkTitle }),
  }).first()
}

async function scrollToGradingCard(page: Page) {
  const scrollArea = page.getByTestId('review-document-scroll-area')
  const card = page.getByTestId('student-review-score-input')
  await expect(scrollArea).toBeVisible()
  // The document strip only renders each PDF page's canvas as it scrolls
  // into view (IntersectionObserver-driven), and the grading card sits
  // past the last page. Step the scroll container down until the card
  // shows up, or until it stops moving (fully scrolled) — either way we
  // then wait on the card itself so a slow last-page render can't race us.
  for (let i = 0; i < 20; i += 1) {
    if (await card.isVisible().catch(() => false)) break
    const before = await scrollArea.evaluate(el => el.scrollTop)
    await scrollArea.evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(150)
    const after = await scrollArea.evaluate(el => el.scrollTop)
    if (after === before && i > 0) break
  }
  await expect(card).toBeVisible({ timeout: 15_000 })
}

// Image surfaces don't know their aspect ratio until the <img> decodes
// (onLoad sets it), so the placeholder box reflows out from under a drag
// that started against the pre-load estimate. Poll until two consecutive
// reads agree before trusting the box for mouse coordinates.
async function stableBoundingBox(locator: Locator, attempts = 15, intervalMs = 200) {
  let previous: { x: number; y: number; width: number; height: number } | null = null
  for (let i = 0; i < attempts; i += 1) {
    const box = await locator.boundingBox()
    if (box && previous && box.x === previous.x && box.y === previous.y && box.width === previous.width && box.height === previous.height) {
      return box
    }
    previous = box
    await locator.page().waitForTimeout(intervalMs)
  }
  throw new Error('Bounding box оверлея не стабилизировался — вёрстка продолжает сдвигаться')
}

// Deterministic readiness check ahead of stableBoundingBox's polling
// safety net: for an image surface, wait for the actual <img> to report
// complete+naturalWidth (the thing whose onLoad triggers the reflow),
// then let one full layout/paint cycle land before reading coordinates.
// Pdf surfaces know their aspect ratio from metrics fetched before render,
// so there's no equivalent load event to wait on there.
async function waitForSurfaceReady(overlay: Locator) {
  const page = overlay.page()
  const img = overlay.locator('xpath=..').locator('img')
  if (await img.count()) {
    const handle = await img.elementHandle()
    if (handle) {
      await page.waitForFunction(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
        handle,
        { timeout: 15_000 },
      )
    }
  }
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function drawRegion(overlay: Locator) {
  const page = overlay.page()
  const attempts = 2
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await waitForSurfaceReady(overlay)
    const box = await stableBoundingBox(overlay)

    const startX = box.x + box.width * 0.2
    const startY = box.y + box.height * 0.2
    const endX = box.x + box.width * 0.55
    const endY = box.y + box.height * 0.34

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(endX, endY, { steps: 12 })
    await page.mouse.up()

    try {
      await expect(page.getByTestId('comment-editor')).toBeVisible({ timeout: 3_000 })
      return
    } catch (error) {
      lastError = error
      await page.mouse.up().catch(() => undefined) // in case the drag left a stray pointer down
    }
  }

  throw lastError instanceof Error ? lastError : new Error('drawRegion: comment-editor не появился после повторных попыток')
}
