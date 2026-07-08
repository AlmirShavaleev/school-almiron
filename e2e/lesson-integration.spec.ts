/**
 * Etap 5 — lesson integration E2E: individual + group scenarios.
 * Real browser clicks for all Etap-5-specific interactions (summary, materials,
 * homework assignment, submit/return/resubmit/accept). Lesson rows themselves are
 * seeded directly in the DB (real rows, ids below, cleaned up manually after the
 * run) to keep the test focused — the pre-existing CreateLessonModal form isn't
 * Etap-5 code and is out of scope for this spec.
 */
import { test, expect, chromium, type Page, type BrowserContext } from '@playwright/test'
import path from 'path'

const COLLECTION_TITLE = 'qqq' // owned by physics@demo.ru, reused across Etap 1-5 tests

// Seeded via direct SQL before this run — see final report for cleanup confirmation.
const INDIVIDUAL_LESSON_ID = 'cfb28b2c-5a85-4596-b51f-249ed851d7c0'
const GROUP_LESSON_ID      = 'f4abc6e6-7853-4e17-9cc3-3fd8a65fcb2a'

let teacherCtx: BrowserContext
let studentCtx: BrowserContext
let teacherPage: Page
let studentPage: Page

test.beforeAll(async () => {
  const browser = await chromium.launch()
  teacherCtx = await browser.newContext({ storageState: path.resolve('test-results/auth.json') })
  teacherPage = await teacherCtx.newPage()

  studentCtx = await browser.newContext()
  studentPage = await studentCtx.newPage()
  await studentPage.goto('/login')
  await studentPage.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await studentPage.fill('input[type="email"]', 'alex@demo.ru')
  await studentPage.fill('input[type="password"]', 'demo123')
  await studentPage.click('button[type="submit"]')
  await studentPage.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })
  await studentPage.waitForSelector('text=Мои задания', { timeout: 20_000 })
})

test.afterAll(async () => {
  await teacherCtx.close()
  await studentCtx.close()
})

test.describe.configure({ mode: 'serial' })

// ══════════════════════════════════════════════════════════════════════════════
// Individual scenario
// ══════════════════════════════════════════════════════════════════════════════

test('individual: fill summary → add material → assign homework → student sees, submits → teacher returns → resubmit → accept', async () => {
  await teacherPage.goto(`/lessons/${INDIVIDUAL_LESSON_ID}`)
  await teacherPage.waitForSelector('text=Итоги занятия', { timeout: 20_000 })

  const summarySection = teacherPage.locator('[data-testid="lesson-summary-section"]')
  const materialsSection = teacherPage.locator('[data-testid="lesson-materials-section"]')
  const homeworkSection = teacherPage.locator('[data-testid="lesson-homework-section"]')

  // Fill summary (scoped — page also has a legacy "Заметки урока" card with its own "Редактировать")
  await summarySection.locator('button:has-text("Редактировать")').click()
  await summarySection.locator('textarea').nth(0).fill('Прошли квадратные уравнения') // 1st textarea = "Итоги занятия" (lesson_summary)
  await summarySection.locator('button:has-text("Сохранить")').click()
  await expect(summarySection.locator('text=Прошли квадратные уравнения')).toBeVisible({ timeout: 10_000 })

  // Add a link material, visible to student
  await materialsSection.locator('button:has-text("Добавить")').click()
  await materialsSection.locator('input[placeholder="Название (необязательно)"]').fill('Конспект')
  await materialsSection.locator('input[placeholder="URL"]').fill('https://example.com/notes.pdf')
  await materialsSection.locator('button:has-text("Добавить"):below(:text("Видно ученику"))').click()
  await expect(materialsSection.locator('text=Конспект').first()).toBeVisible({ timeout: 10_000 })

  // Assign homework
  await homeworkSection.locator('button:has-text("Добавить домашнее задание")').click()
  await teacherPage.waitForSelector('select', { timeout: 10_000 })
  await teacherPage.selectOption('select', { label: COLLECTION_TITLE })
  await teacherPage.click('button:has-text("Назначить")')
  await expect(teacherPage.locator('text=Домашнее задание назначено')).toBeVisible({ timeout: 10_000 })
  await teacherPage.click('button:has-text("Закрыть")')

  // Student opens the SAME lesson
  await studentPage.goto(`/lessons/${INDIVIDUAL_LESSON_ID}`)
  await studentPage.waitForSelector('text=Прошли квадратные уравнения', { timeout: 20_000 })
  await expect(studentPage.locator('text=Конспект').first()).toBeVisible()
  // teacher_notes never rendered for student (no edit control exists on student view)
  await expect(studentPage.locator('button:has-text("Редактировать")')).toHaveCount(0)

  // Student opens homework from the lesson card
  await studentPage.click('text=Открыть задание')
  await studentPage.waitForURL(/\/my-assignments\/[0-9a-f-]+$/, { timeout: 10_000 })
  await studentPage.waitForSelector('textarea', { timeout: 15_000 })
  await studentPage.fill('textarea >> nth=0', 'Ответ ученика')
  await studentPage.click('button:has-text("Отправить")')
  await expect(studentPage.locator('text=Решение отправлено')).toBeVisible({ timeout: 10_000 })

  // Teacher opens submission from the lesson card and returns it
  await teacherPage.goto(`/lessons/${INDIVIDUAL_LESSON_ID}`)
  await teacherPage.waitForSelector('text=На проверке', { timeout: 20_000 })
  await teacherPage.click('a:has-text("Открыть")')
  await teacherPage.waitForSelector('button:has-text("Вернуть на доработку")', { timeout: 10_000 })
  await teacherPage.click('button:has-text("Вернуть на доработку")')
  await expect(teacherPage.locator('text=Статус обновлён')).toBeVisible({ timeout: 10_000 })
  const submissionUrl = teacherPage.url()

  // Student resubmits
  await studentPage.goto(`/lessons/${INDIVIDUAL_LESSON_ID}`)
  await studentPage.waitForSelector('text=Возвращено на доработку', { timeout: 20_000 })
  await studentPage.click('text=Открыть задание')
  await studentPage.waitForSelector('textarea', { timeout: 10_000 })
  await studentPage.fill('textarea >> nth=0', 'Исправленный ответ')
  await studentPage.click('button:has-text("Отправить заново")')
  await expect(studentPage.locator('text=Решение отправлено')).toBeVisible({ timeout: 10_000 })

  // Teacher accepts
  await teacherPage.goto(submissionUrl)
  await teacherPage.waitForSelector('button:has-text("Принять")', { timeout: 15_000 })
  await teacherPage.click('button:has-text("Принять")')
  await expect(teacherPage.locator('text=Статус обновлён')).toBeVisible({ timeout: 10_000 })

  // Lesson card reflects final state, lesson itself is untouched (still "Завершено")
  await teacherPage.goto(`/lessons/${INDIVIDUAL_LESSON_ID}`)
  await expect(teacherPage.locator('text=Завершено').first()).toBeVisible({ timeout: 20_000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// Group scenario
// ══════════════════════════════════════════════════════════════════════════════

test('group: assign homework → roster snapshot → one submits, others not_started → grading one does not affect others', async () => {
  await teacherPage.goto(`/lessons/${GROUP_LESSON_ID}`)
  await teacherPage.waitForSelector('text=Домашнее задание', { timeout: 20_000 })

  await teacherPage.click('button:has-text("Добавить домашнее задание")')
  await teacherPage.waitForSelector('select', { timeout: 10_000 })
  await teacherPage.selectOption('select', { label: COLLECTION_TITLE })
  await teacherPage.click('button:has-text("Назначить")')
  await expect(teacherPage.locator('text=Домашнее задание назначено')).toBeVisible({ timeout: 10_000 })
  await teacherPage.click('button:has-text("Закрыть")')

  // Group roster summary shows all 3 members not_started
  await expect(teacherPage.locator('text=Всего: 3')).toBeVisible({ timeout: 15_000 })
  await expect(teacherPage.locator('text=Не начали: 3')).toBeVisible()

  // Student (alex, group member) sees the lesson + homework
  await studentPage.goto(`/lessons/${GROUP_LESSON_ID}`)
  await studentPage.waitForSelector('text=Открыть задание', { timeout: 20_000 })
  await studentPage.click('text=Открыть задание')
  await studentPage.waitForURL(/\/my-assignments\/[0-9a-f-]+$/, { timeout: 10_000 })
  await studentPage.waitForSelector('textarea', { timeout: 15_000 })
  await studentPage.fill('textarea >> nth=0', 'Ответ алекса')
  await studentPage.click('button:has-text("Отправить")')
  await expect(studentPage.locator('text=Решение отправлено')).toBeVisible({ timeout: 10_000 })

  // Teacher's lesson card now shows 1 submitted, 2 still not_started
  await teacherPage.goto(`/lessons/${GROUP_LESSON_ID}`)
  await expect(teacherPage.locator('text=Сдали: 1')).toBeVisible({ timeout: 20_000 })
  await expect(teacherPage.locator('text=Не начали: 2')).toBeVisible()

  // Teacher accepts alex's submission via the roster row
  await teacherPage.click('a:has-text("Открыть")')
  await teacherPage.waitForSelector('button:has-text("Принять")', { timeout: 10_000 })
  await teacherPage.click('button:has-text("Принять")')
  await expect(teacherPage.locator('text=Статус обновлён')).toBeVisible({ timeout: 10_000 })

  // Back on lesson card: 1 accepted, other 2 UNCHANGED (still not_started)
  await teacherPage.goto(`/lessons/${GROUP_LESSON_ID}`)
  await expect(teacherPage.locator('text=Принято: 1')).toBeVisible({ timeout: 20_000 })
  await expect(teacherPage.locator('text=Не начали: 2')).toBeVisible()
})
