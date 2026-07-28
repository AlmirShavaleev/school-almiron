import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { AUTH_FILE } from './global-setup'

/**
 * Сквозной smoke новой ветки ДЗ (topic_homework): преподаватель выдаёт ДЗ по
 * теме курса → ученик вступает в курс по ссылке и сдаёт → преподаватель
 * возвращает на доработку → ученик пересдаёт → преподаватель принимает с
 * баллом → ученик видит оценку и комментарий в теме и в журнале.
 *
 * БАЗА БОЕВАЯ — тот же принцип, что и в e2e/pdf-fixtures.ts:
 *   1. Всё созданное этим спеком помечено префиксом [E2E].
 *   2. Удаляется в teardown ТОЛЬКО по этому префиксу (перечитан из базы, а
 *      не доверяем переменной в памяти).
 *   3. Anon-клиент + реальный логин physics@demo.ru — под теми же RLS, что и
 *      обычный преподаватель.
 *   4. Allow-list проекта — тот же guard, что в pdf-fixtures.ts.
 *
 * Известное ограничение: файлы в Storage (topic-homework / topic-homework-
 * attempts) после удаления курса становятся сиротами — каскад чистит только
 * таблицы, не bucket. Тот же компромисс уже принят в review-cycle.spec.ts.
 */

// ─── Allow-list проекта (скопировано из e2e/pdf-fixtures.ts) ─────────────────

function loadDotEnvOnce() {
  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key || key.startsWith('#') || process.env[key] !== undefined) continue
    process.env[key] = line.slice(eq + 1).trim()
  }
}
loadDotEnvOnce()

const E2E_PREFIX = '[E2E]'
const ALLOWED_PROJECT_REF = 'kthfozyfruorwjhvvsbw'

function getProjectRef(url: string): string {
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (!match) throw new Error(`Cannot parse Supabase project ref from URL: ${url}`)
  return match[1]
}

function assertAllowedProject() {
  const url = process.env.VITE_SUPABASE_URL
  if (!url) throw new Error('VITE_SUPABASE_URL is not set — cannot run topic-homework-cycle E2E fixtures')
  const ref = getProjectRef(url)
  if (ref !== ALLOWED_PROJECT_REF) {
    throw new Error(
      `Refusing to run topic-homework-cycle E2E fixture lifecycle against project "${ref}" — ` +
      `only "${ALLOWED_PROJECT_REF}" is allow-listed. If this is intentional, update ` +
      `ALLOWED_PROJECT_REF in e2e/topic-homework-cycle.spec.ts.`,
    )
  }
}

let seedClient: SupabaseClient | null = null

async function getSeedClient(): Promise<SupabaseClient> {
  assertAllowedProject()
  if (seedClient) return seedClient

  const url = process.env.VITE_SUPABASE_URL!
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set — cannot run topic-homework-cycle E2E fixtures')

  const c = createClient(url, anonKey)
  const { error } = await c.auth.signInWithPassword({ email: 'physics@demo.ru', password: 'demo123' })
  if (error) throw new Error(`topic-homework-cycle seed auth failed: ${error.message}`)

  seedClient = c
  return c
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const STUDENT_EMAIL = 'alex@demo.ru'
const STUDENT_PASSWORD = 'demo123'
const HOMEWORK_PDF = path.resolve('e2e/fixtures/test-material.pdf')

// Фикстуры gitignored и генерируются на лету — тот же приём, что в
// lesson-materials-upload.spec.ts: спек не должен требовать ручного шага.
if (!fs.existsSync(HOMEWORK_PDF)) {
  execSync('node e2e/fixtures/make-fixtures.mjs', { cwd: process.cwd(), stdio: 'inherit' })
}

interface SeedResult {
  courseId: string
  topicId: string
  courseTitle: string
  topicTitle: string
}

let seed: SeedResult | null = null

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const c = await getSeedClient()

  const runTag = Date.now().toString(36)
  const courseTitle = `${E2E_PREFIX} Цикл ДЗ ${runTag}`
  // runTag и в теме: очередь и журнал фильтруются по названию темы, а строки
  // прошлых прогонов могут пережить teardown (см. фолбэк ниже) — фильтр по
  // одному лишь [E2E] тогда находит несколько строк и роняет strict mode.
  const topicTitle = `${E2E_PREFIX} Тема ДЗ ${runTag}`

  const { data: userData, error: userErr } = await c.auth.getUser()
  if (userErr || !userData.user) throw new Error(`topic-homework-cycle: cannot resolve teacher user: ${userErr?.message}`)

  const { data: course, error: courseErr } = await c
    .from('courses')
    .insert({
      title: courseTitle,
      subject: 'physics',
      exam_type: 'ege',
      owner_id: userData.user.id,
      duration_weeks: 4,
      is_active: true,
      is_draft: false,
    })
    .select('id, title')
    .single()
  if (courseErr || !course) throw new Error(`topic-homework-cycle: failed to seed course: ${courseErr?.message}`)

  // Триггер courses_default_module сам создал модуль «Основной» — перечитываем.
  const { data: modules, error: modulesErr } = await c
    .from('modules')
    .select('id, title')
    .eq('course_id', course.id)
    .order('order_index')
  if (modulesErr || !modules || modules.length === 0) {
    throw new Error(`topic-homework-cycle: default module not found for course ${course.id}: ${modulesErr?.message}`)
  }
  const moduleId = modules[0].id as string

  const { data: topic, error: topicErr } = await c
    .from('topics')
    .insert({
      module_id: moduleId,
      title: topicTitle,
      order_index: 0,
      available_from: null,
    })
    .select('id, title')
    .single()
  if (topicErr || !topic) throw new Error(`topic-homework-cycle: failed to seed topic: ${topicErr?.message}`)

  seed = {
    courseId:  course.id as string,
    topicId:   topic.id as string,
    courseTitle,
    topicTitle,
  }
})

test.afterAll(async () => {
  if (!seed) return
  const c = await getSeedClient()

  // Подстраховка: перечитываем title из базы и удаляем только если он
  // действительно начинается с [E2E] — не доверяем seed.courseTitle из памяти.
  const { data: row, error: fetchErr } = await c
    .from('courses')
    .select('id, title')
    .eq('id', seed.courseId)
    .maybeSingle()

  if (fetchErr) {
    console.error(`[topic-homework-cycle] teardown: failed to look up course ${seed.courseId}:`, fetchErr)
    return
  }
  if (!row) {
    console.log(`[topic-homework-cycle] teardown: course ${seed.courseId} already gone`)
    return
  }
  if (!row.title.startsWith(E2E_PREFIX)) {
    console.error(`[topic-homework-cycle] teardown: refusing to delete course ${seed.courseId} — title "${row.title}" does not start with ${E2E_PREFIX}`)
    return
  }

  // ON DELETE CASCADE сносит модуль -> тему -> topic_homework -> attempts/reviews
  // -> группы -> членства. Файлы Storage остаются сиротами (см. комментарий в шапке).
  const { error: deleteErr } = await c.from('courses').delete().eq('id', seed.courseId)
  if (!deleteErr) {
    console.log(`[topic-homework-cycle] teardown: deleted course ${seed.courseId} ("${row.title}")`)
    return
  }

  // Полное удаление невозможно: триггер «Сданную попытку удалить нельзя»
  // (23514, миграция topic_homework) защищает сданные/принятые попытки даже от
  // каскада — курс, в котором хоть раз сдали ДЗ, под RLS не удаляется вовсе.
  // Это продуктовое свойство (история не затирается, §2 PROJECT_STATE), а не
  // баг теста. Фолбэк-уборка того, что реально мешает следующим прогонам:
  //   1) отчисляем учеников (course_member_remove) — иначе у демо-ученика
  //      копятся членства, [E2E]-строки остаются в его журнале, и фильтры
  //      следующего прогона находят несколько строк;
  //   2) архивируем курс (is_active=false) — чтобы не мозолил список курсов.
  // Скелет курса с попытками остаётся — вычищать его может только админ с
  // отключёнными триггерами (session_replication_role=replica).
  console.warn(`[topic-homework-cycle] teardown: cascade delete blocked (${deleteErr.code} ${deleteErr.message}) — falling back to unenroll+archive`)

  const { data: memberRows } = await c
    .from('group_students')
    .select('student_id, groups!inner(course_id)')
    .eq('groups.course_id', seed.courseId)
  const studentIds = Array.from(new Set((memberRows ?? []).map(r => (r as { student_id: string }).student_id)))
  for (const studentId of studentIds) {
    const { error: removeErr } = await (c as SupabaseClient).rpc('course_member_remove', {
      p_course_id: seed.courseId,
      p_student_id: studentId,
    })
    if (removeErr) console.error(`[topic-homework-cycle] teardown: course_member_remove(${studentId}) failed:`, removeErr)
  }

  const { error: archiveErr } = await c.from('courses').update({ is_active: false }).eq('id', seed.courseId)
  if (archiveErr) {
    console.error(`[topic-homework-cycle] teardown: failed to archive course ${seed.courseId}:`, archiveErr)
  } else {
    console.log(`[topic-homework-cycle] teardown: unenrolled ${studentIds.length} student(s), archived course ${seed.courseId} ("${row.title}")`)
  }
})

// ─── Test ─────────────────────────────────────────────────────────────────────

test('teacher assigns homework, student submits/revises/is graded, and the grade shows up in journal', async () => {
  test.slow()
  test.setTimeout(300_000)

  if (!seed) throw new Error('Seed did not run — course/topic fixture is missing')
  const { courseId, topicId, topicTitle } = seed

  const browser = await chromium.launch()
  let teacherCtx: BrowserContext | null = null
  let studentCtx: BrowserContext | null = null

  try {
    teacherCtx = await browser.newContext({ storageState: AUTH_FILE })
    studentCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } })

    const teacherPage = await teacherCtx.newPage()
    const studentPage = await studentCtx.newPage()
    teacherPage.on('dialog', d => d.accept())
    studentPage.on('dialog', d => d.accept())

    let joinToken = ''

    await test.step('teacher: open course students tab and grab the student join link', async () => {
      await teacherPage.goto(`/course-program?courseId=${courseId}&tab=students`)
      const joinCard = teacherPage.locator('[data-testid="join-link-card"][data-role="student"]')
      await expect(joinCard).toBeVisible({ timeout: 20_000 })

      const joinUrl = await joinCard.locator('[data-testid="join-link-url"]').inputValue()
      const marker = '/join/'
      const idx = joinUrl.indexOf(marker)
      expect(idx).toBeGreaterThan(-1)
      joinToken = joinUrl.slice(idx + marker.length)
      expect(joinToken.length).toBeGreaterThan(0)
    })

    await test.step('teacher: open topic materials and publish the homework', async () => {
      // Смена вкладки — кликом, не через goto: гидратация из URL одноразовая.
      await teacherPage.locator('[data-testid="course-tab-program"]').click()

      const topicRow = teacherPage.locator('[data-testid="program-topic-row"]').filter({ hasText: topicTitle })
      await expect(topicRow).toBeVisible({ timeout: 15_000 })
      await topicRow.click()

      const modal = teacherPage.locator('[data-testid="topic-materials-modal"]')
      await expect(modal).toBeVisible({ timeout: 10_000 })

      await teacherPage.locator('[data-testid="topic-tile-hw"]').click()

      // Дедлайн +7 дней от сегодня, формат YYYY-MM-DD.
      const due = new Date()
      due.setDate(due.getDate() + 7)
      const dueStr = due.toISOString().slice(0, 10)

      // Публикация должна быть недоступна, пока не загружен файл задания.
      const publishToggle = teacherPage.locator('[data-testid="hw-publish-toggle"]')
      await expect(publishToggle).toBeDisabled()

      await teacherPage.locator('[data-testid="hw-task-files-input"]').setInputFiles(HOMEWORK_PDF)
      await expect(teacherPage.locator('[data-testid="hw-task-file"]')).toHaveCount(1, { timeout: 15_000 })

      await teacherPage.getByLabel('Шкала баллов').selectOption('five')
      await teacherPage.getByLabel('Дедлайн').fill(dueStr)

      await expect(publishToggle).toBeEnabled({ timeout: 10_000 })
      await publishToggle.click()

      // Свежий курс — учеников ещё нет, ждём предупреждение «Оповещать некого…».
      const notify = teacherPage.locator('[data-testid="hw-notify-message"]')
      await expect(notify).toBeVisible({ timeout: 15_000 })
      await expect(notify).toHaveAttribute('data-tone', 'warning')
      await expect(notify).toContainText('Оповещать некого')
      await expect(publishToggle).toHaveAttribute('data-published', 'true')

      await teacherPage.locator('[data-testid="topic-modal-close"]').click()
      await expect(modal).toHaveCount(0)
    })

    let groupId = ''

    await test.step('student: join the course via the link', async () => {
      await studentPage.goto('/login')
      await studentPage.locator('[data-testid="login-email"]').fill(STUDENT_EMAIL)
      await studentPage.locator('[data-testid="login-password"]').fill(STUDENT_PASSWORD)
      await studentPage.locator('[data-testid="login-submit"]').click()
      await studentPage.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })

      await studentPage.goto('/join/' + joinToken)
      await expect(studentPage.locator('[data-testid="join-accept"]')).toBeVisible({ timeout: 15_000 })
      await studentPage.locator('[data-testid="join-accept"]').click()
      await expect(studentPage.locator('[data-testid="join-success"]')).toBeVisible({ timeout: 20_000 })

      await studentPage.locator('[data-testid="join-open-course"]').click()
      await studentPage.waitForURL(/\/my-course\/.+/, { timeout: 15_000 })

      const match = studentPage.url().match(/\/my-course\/([^/?#]+)/)
      expect(match).toBeTruthy()
      groupId = match![1]
      expect(groupId.length).toBeGreaterThan(0)
    })

    await test.step('student: submit the first attempt', async () => {
      await studentPage.goto(`/my-course/${groupId}/topic/${topicId}`)
      await expect(studentPage.locator('[data-testid="hw-start-attempt"]')).toBeVisible({ timeout: 20_000 })
      await studentPage.locator('[data-testid="hw-start-attempt"]').click()

      await studentPage.locator('[data-testid="hw-attempt-file-input"]').setInputFiles(HOMEWORK_PDF)
      const submitBtn = studentPage.locator('[data-testid="hw-submit-attempt"]')
      await expect(submitBtn).toBeEnabled({ timeout: 10_000 })
      await submitBtn.click()

      await expect(studentPage.getByText('Работа отправлена, ждёт проверки преподавателя.')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('teacher: return the first attempt for revision', async () => {
      await teacherPage.goto('/homework-queue')
      const card = teacherPage.locator('[data-testid="queue-attempt-card"]', { hasText: topicTitle })
      await expect(card).toBeVisible({ timeout: 20_000 })

      await card.locator('[data-testid="review-comment-input"]').fill('Перерисуй график, задача 2')
      await card.locator('[data-testid="review-return-button"]').click()
      await expect(card).toHaveCount(0, { timeout: 15_000 })
    })

    await test.step('student: see the revision request and resubmit', async () => {
      await studentPage.reload()

      const returnedRow = studentPage.locator('[data-testid="hw-attempt-row"][data-status="returned_for_revision"]')
      await expect(returnedRow).toBeVisible({ timeout: 20_000 })
      await expect(returnedRow.locator('[data-testid="hw-review-comment"]')).toContainText('Перерисуй график, задача 2')

      const startBtn = studentPage.locator('[data-testid="hw-start-attempt"]')
      await expect(startBtn).toBeVisible({ timeout: 10_000 })
      await expect(startBtn).toHaveText('Сдать заново')
      await startBtn.click()

      await studentPage.locator('[data-testid="hw-attempt-file-input"]').setInputFiles(HOMEWORK_PDF)
      const submitBtn = studentPage.locator('[data-testid="hw-submit-attempt"]')
      await expect(submitBtn).toBeEnabled({ timeout: 10_000 })
      await submitBtn.click()

      await expect(studentPage.getByText('Работа отправлена, ждёт проверки преподавателя.')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('teacher: accept the resubmission with a score', async () => {
      await teacherPage.goto('/homework-queue')
      const card = teacherPage.locator('[data-testid="queue-attempt-card"]', { hasText: topicTitle })
      await expect(card).toBeVisible({ timeout: 20_000 })

      await card.locator('[data-testid="review-score-input"]').fill('4')
      await card.locator('[data-testid="review-accept-button"]').click()
      await expect(card).toHaveCount(0, { timeout: 15_000 })
    })

    await test.step('student: see the grade and comment on the topic page', async () => {
      await studentPage.reload()

      await expect(studentPage.locator('[data-testid="hw-grade"]')).toContainText('4 / 5', { timeout: 20_000 })
      await expect(studentPage.locator('[data-testid="hw-attempt-row"][data-status="accepted"]')).toBeVisible()
      await expect(studentPage.getByText('Принято', { exact: true }).first()).toBeVisible()
    })

    await test.step('student: see the grade in the progress journal', async () => {
      await studentPage.goto('/my-progress')
      const journalRow = studentPage.locator('[data-testid="journal-homework-row"]', { hasText: topicTitle })
      await expect(journalRow).toBeVisible({ timeout: 20_000 })
      await expect(journalRow).toContainText('Принято')
      await expect(journalRow).toContainText('4 / 5')
    })
  } finally {
    await teacherCtx?.close()
    await studentCtx?.close()
    await browser.close()
  }
})
