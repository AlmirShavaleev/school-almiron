/**
 * Etap 4 — full assignment lifecycle E2E.
 * Real browser clicks only (no fiber/state manipulation).
 *
 * Cycle: teacher assigns → student opens → student submits →
 *        teacher returns → student resubmits → teacher accepts.
 *
 * Run: npx playwright test e2e/assignment-cycle.spec.ts
 */
import { test, expect, chromium, type Page, type BrowserContext } from '@playwright/test'
import path from 'path'

const COLLECTION_TITLE = 'qqq' // owned by physics@demo.ru (teacher), used across Etap 1-4 tests

test.describe.configure({ mode: 'serial' })

let teacherCtx: BrowserContext
let studentCtx: BrowserContext
let teacherPage: Page
let studentPage: Page

test.beforeAll(async () => {
  const browser = await chromium.launch()

  // Teacher context reuses the auth state saved by global-setup.ts
  teacherCtx = await browser.newContext({ storageState: path.resolve('test-results/auth.json') })
  teacherPage = await teacherCtx.newPage()

  // Student: log in directly on its own page (avoids storageState race —
  // capturing state immediately after the redirect can miss the session
  // before Supabase finishes persisting it to localStorage).
  studentCtx = await browser.newContext()
  studentPage = await studentCtx.newPage()
  await studentPage.goto('/login')
  await studentPage.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await studentPage.fill('input[type="email"]', 'alex@demo.ru')
  await studentPage.fill('input[type="password"]', 'demo123')
  await studentPage.click('button[type="submit"]')
  await studentPage.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })
  // Wait for the dashboard shell to actually render (session fully hydrated)
  await studentPage.waitForSelector('text=Мои задания', { timeout: 20_000 })
})

test.afterAll(async () => {
  await teacherCtx.close()
  await studentCtx.close()
})

test('full cycle: assign → open → submit → return → resubmit → accept', async () => {
  // ── 1. Teacher assigns "qqq" to student Алексей Петров ─────────────────────
  await teacherPage.goto('/assign-homework')
  await teacherPage.waitForSelector('select', { timeout: 20_000 })

  await teacherPage.selectOption('select >> nth=0', { label: COLLECTION_TITLE })
  await teacherPage.click('button:has-text("Ученику")')
  await teacherPage.waitForSelector('select >> nth=1', { timeout: 10_000 })
  await teacherPage.selectOption('select >> nth=1', { label: 'Алексей Петров' })
  await teacherPage.click('button:has-text("Назначить")')
  await expect(teacherPage.locator('text=Работа назначена')).toBeVisible({ timeout: 10_000 })

  // ── 2. Student sees it in "Мои задания" with "Не начал" ─────────────────────
  await studentPage.goto('/my-assignments')
  await studentPage.waitForSelector('[data-testid="assignment-card"]', { timeout: 20_000 })
  const card = studentPage.locator('[data-testid="assignment-card"]').first()
  await expect(card).toContainText('Не начал')

  // ── 3. Student opens it, sees task statement, answers, submits ─────────────
  await card.click()
  await studentPage.waitForURL(/\/my-assignments\/[0-9a-f-]+$/, { timeout: 10_000 })
  await studentPage.waitForSelector('textarea', { timeout: 15_000 })

  // Sees at least one task statement (rendered via TaskDisplayCard)
  await expect(studentPage.locator('.catalog-html').first()).toBeVisible({ timeout: 15_000 })

  await studentPage.fill('textarea >> nth=0', 'Первый ответ')
  await studentPage.click('button:has-text("Отправить")')
  await expect(studentPage.locator('text=Решение отправлено')).toBeVisible({ timeout: 10_000 })
  await expect(studentPage.locator('text=На проверке')).toBeVisible()

  const assignmentUrl = studentPage.url()

  // ── 4. Teacher opens the submission and returns it for rework ──────────────
  await teacherPage.goto('/review-submissions')
  await teacherPage.waitForSelector('[data-testid="submission-row"]', { timeout: 20_000 })
  await teacherPage.locator('[data-testid="submission-row"]').first().click()
  await teacherPage.waitForSelector('text=Вернуть на доработку', { timeout: 10_000 })
  await teacherPage.click('button:has-text("Вернуть на доработку")')
  await expect(teacherPage.locator('text=Статус обновлён')).toBeVisible({ timeout: 10_000 })

  const submissionUrl = teacherPage.url()

  // ── 5. Student sees "Возвращено", edits answer, resubmits ──────────────────
  await studentPage.goto(assignmentUrl)
  await studentPage.waitForSelector('text=Возвращено на доработку', { timeout: 15_000 })
  await studentPage.fill('textarea >> nth=0', 'Исправленный ответ')
  await studentPage.click('button:has-text("Отправить заново")')
  await expect(studentPage.locator('text=Решение отправлено')).toBeVisible({ timeout: 10_000 })

  // ── 6. Teacher re-opens same submission and accepts ─────────────────────────
  await teacherPage.goto(submissionUrl)
  await teacherPage.waitForSelector('button:has-text("Принять")', { timeout: 15_000 })
  await teacherPage.click('button:has-text("Принять")')
  await expect(teacherPage.locator('text=Статус обновлён')).toBeVisible({ timeout: 10_000 })

  // ── 7. Student sees "Принято" and can no longer edit ────────────────────────
  await studentPage.goto(assignmentUrl)
  await studentPage.waitForSelector('text=Принято', { timeout: 15_000 })
  await expect(studentPage.locator('button:has-text("Отправить")')).toHaveCount(0)
  await expect(studentPage.locator('textarea >> nth=0')).toBeDisabled()
})
