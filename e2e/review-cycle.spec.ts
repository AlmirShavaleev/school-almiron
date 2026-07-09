import { test, expect, chromium, type BrowserContext, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { AUTH_FILE } from './global-setup'

test.describe.configure({ mode: 'serial' })

const STUDENT_EMAIL = 'alex@demo.ru'
const STUDENT_PASSWORD = 'demo123'
const STUDENT_NAME = 'Алексей Петров'
const COMMENT_SUFFIX = `(e2e ${Date.now().toString(36)})`
const COMMENT_TEXT = `Проверь знаки ${COMMENT_SUFFIX}`
const REVIEW_FIXTURE = path.resolve('doc_web/data/uploads/02847eb2.pdf')

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

test('teacher review cycle persists draft, publishes, returns to queue, and is visible to student', async () => {
  test.slow()

  const target = await ensureLegacyPdfSubmission(teacherPage, studentPage)

  await openQueueReview(teacherPage, target)
  await expect(teacherPage.getByTestId('student-review-page')).toBeVisible()
  await expect(teacherPage.getByTestId('review-overlay-1')).toBeVisible()

  await drawRegion(teacherPage.getByTestId('review-overlay-1'))
  await teacherPage.getByTestId('comment-category-calc').click()
  await teacherPage.getByRole('button', { name: 'Проверь знаки' }).click()
  await teacherPage.getByTestId('comment-editor-text').fill(COMMENT_TEXT)
  await teacherPage.getByTestId('comment-editor-save').click()
  await expect(teacherPage.getByTestId('comment-list-item').filter({ hasText: COMMENT_TEXT })).toBeVisible()

  await teacherPage.getByTestId('student-review-back-button').click()
  await teacherPage.waitForURL(/\/inbox/)

  await openQueueReview(teacherPage, target)
  await expect(teacherPage.getByTestId('comment-list-item').filter({ hasText: COMMENT_TEXT })).toBeVisible()

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

  const resubmitButton = studentCard.getByTestId('submit-homework-button')
  if (await resubmitButton.count()) {
    await resubmitButton.click()
    await expect(studentPage.getByTestId('submit-homework-modal')).toBeVisible()
    await studentPage.getByTestId('submit-homework-text').fill(`Пересдача ${COMMENT_SUFFIX}`)
    await studentPage.getByTestId('submit-homework-file-input').setInputFiles(REVIEW_FIXTURE)
    await studentPage.getByTestId('submit-homework-submit').click()
    await expect(studentPage.locator('text=Работа отправлена')).toBeVisible({ timeout: 15_000 })

    await teacherPage.goto('/inbox')
    await teacherPage.getByTestId('queue-tab-pending').click()
    await expect(queueItemByTarget(teacherPage, target)).toBeVisible({ timeout: 15_000 })
  }
})

async function loginAsStudent(page: Page) {
  await page.goto('/login')
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await page.fill('input[type="email"]', STUDENT_EMAIL)
  await page.fill('input[type="password"]', STUDENT_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })
}

async function ensureLegacyPdfSubmission(teacherPage: Page, studentPage: Page): Promise<ReviewTarget> {
  const existing = await findLegacyPdfQueueItem(teacherPage)
  if (existing) return existing

  const created = await createStudentSubmission(studentPage)
  await teacherPage.goto('/inbox')
  await teacherPage.getByTestId('queue-tab-pending').click()
  await expect(queueItemByTarget(teacherPage, created)).toBeVisible({ timeout: 20_000 })
  return created
}

async function findLegacyPdfQueueItem(page: Page): Promise<ReviewTarget | null> {
  await page.goto('/inbox')
  await page.getByTestId('queue-tab-pending').click()
  await page.waitForLoadState('networkidle')

  const legacyItems = page.locator('[data-testid="queue-item"][data-source="legacy"]')
  const count = await legacyItems.count()
  for (let index = 0; index < count; index += 1) {
    const item = legacyItems.nth(index)
    const target = await targetFromQueueItem(item)
    await item.click()
    await page.waitForURL(/\/homeworks\/.+\/review\//, { timeout: 15_000 })
    await expect(page.getByTestId('student-review-page')).toBeVisible({ timeout: 15_000 })
    if (await page.getByTestId('review-overlay-1').isVisible().catch(() => false)) {
      await page.getByTestId('student-review-back-button').click()
      await page.waitForURL(/\/inbox/, { timeout: 15_000 })
      return target
    }
    await page.getByTestId('student-review-back-button').click()
    await page.waitForURL(/\/inbox/, { timeout: 15_000 })
  }

  return null
}

async function createStudentSubmission(page: Page): Promise<ReviewTarget> {
  await page.goto('/homeworks')
  await page.waitForSelector('[data-testid="homework-card"]', { timeout: 20_000 })

  const candidateCard = page.locator('[data-testid="homework-card"]').filter({
    has: page.locator('[data-testid="submit-homework-button"]'),
  }).first()
  await expect(candidateCard).toBeVisible({ timeout: 15_000 })

  const homeworkTitle = (await candidateCard.locator('h3').textContent())?.trim()
  if (!homeworkTitle) throw new Error('Не удалось определить заголовок ДЗ для e2e smoke')

  await candidateCard.getByTestId('submit-homework-button').click()
  await expect(page.getByTestId('submit-homework-modal')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('submit-homework-text').fill(`Smoke review cycle ${COMMENT_SUFFIX}`)
  await page.getByTestId('submit-homework-file-input').setInputFiles(REVIEW_FIXTURE)
  await page.getByTestId('submit-homework-submit').click()
  await expect(page.locator('text=Работа отправлена')).toBeVisible({ timeout: 15_000 })

  return {
    studentName: STUDENT_NAME,
    homeworkTitle,
  }
}

async function openQueueReview(page: Page, target: ReviewTarget) {
  await page.goto('/inbox')
  await page.getByTestId('queue-tab-pending').click()
  const item = queueItemByTarget(page, target)
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()
  await page.waitForURL(/\/homeworks\/.+\/review\//, { timeout: 15_000 })
}

async function targetFromQueueItem(item: Locator): Promise<ReviewTarget> {
  const studentName = ((await item.getByTestId('queue-item-student').textContent()) || '').trim()
  const homeworkTitle = ((await item.getByTestId('queue-item-homework').textContent()) || '').trim()
  if (!studentName || !homeworkTitle) throw new Error('Не удалось считать данные queue item для e2e smoke')
  return { studentName, homeworkTitle }
}

function queueItemByTarget(page: Page, target: ReviewTarget) {
  return page.getByTestId('queue-item').filter({
    has: page.getByTestId('queue-item-student').filter({ hasText: target.studentName }),
  }).filter({
    has: page.getByTestId('queue-item-homework').filter({ hasText: target.homeworkTitle }),
  }).first()
}

async function drawRegion(overlay: Locator) {
  const box = await overlay.boundingBox()
  if (!box) throw new Error('Не удалось получить размеры overlay для region drag')

  const startX = box.x + box.width * 0.2
  const startY = box.y + box.height * 0.2
  const endX = box.x + box.width * 0.55
  const endY = box.y + box.height * 0.34

  const page = overlay.page()
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByTestId('comment-editor')).toBeVisible({ timeout: 10_000 })
}
