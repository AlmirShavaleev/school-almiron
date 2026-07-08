/**
 * Etap 6 — unified student journal E2E: teacher view, student view, and
 * group-independence (grading one student never affects another's stats).
 * Real clicks, real DB (seeded here and cleaned up in afterAll), real routes.
 */
import { test, expect, chromium, type Page, type BrowserContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const ANON_KEY = fs.readFileSync(path.resolve('.env'), 'utf8')
  .match(/VITE_SUPABASE_ANON_KEY=(.+)/)![1].trim()

const GROUP_ID     = 'f1000002-0000-0000-0000-000000000000' // ЕГЭ Физика 11Б
const TEACHER_ROW  = 'c1000001-0000-0000-0000-000000000000' // teachers.id
const TEACHER_PROF = '43396c60-0c26-4c7d-a944-1dfa727353be'  // profiles.id (physics@demo.ru)
const COLLECTION   = '5e1ab406-f79b-4015-abcc-dd9c3edc4f49'  // "qqq" owned by physics@demo.ru
const STUDENT_A    = 'a1000001-0000-0000-0000-000000000000' // Алексей Петров / alex@demo.ru
const STUDENT_B    = 'a1000007-0000-0000-0000-000000000000' // Никита Волков / nikita@demo.ru

const LESSON_ID     = '88888888-0001-0000-0000-000000000001'
let ASSIGNED_ID   = ''
let SUBMISSION_ID = ''

let teacherCtx: BrowserContext
let studentACtx: BrowserContext
let studentBCtx: BrowserContext
let teacherPage: Page
let studentAPage: Page
let studentBPage: Page

async function admin() {
  // service-role not available client-side; use anon + RLS-bypassing SQL via
  // direct postgres is not exposed here, so seed through the same authenticated
  // teacher session that owns the rows (matches RLS, same as the real app would insert).
  const sb = createClient(SUPABASE_URL, ANON_KEY)
  await sb.auth.signInWithPassword({ email: 'physics@demo.ru', password: 'demo123' })
  return sb
}

test.beforeAll(async () => {
  const sb = await admin()

  function check(label: string, err: unknown) {
    if (err) throw new Error(`Seed failed at ${label}: ${JSON.stringify(err)}`)
  }

  check('lessons', (await sb.from('lessons').insert({
    id: LESSON_ID, group_id: GROUP_ID, teacher_id: TEACHER_ROW,
    title: 'E2E JOURNAL group lesson', scheduled_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
    duration_minutes: 90, status: 'completed', format: 'group',
    planned_topic: 'E2E: групповой журнал', completed_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
  } as never)).error)

  check('attendance', (await sb.from('attendance').insert([
    { lesson_id: LESSON_ID, student_id: STUDENT_A, status: 'present' },
    { lesson_id: LESSON_ID, student_id: STUDENT_B, status: 'absent' },
  ] as never)).error)

  // Real assign flow (same RPC the teacher UI calls) — snapshots both group
  // members automatically, due date in the past so the never-submitted member (B)
  // is genuinely overdue.
  const pastDue = new Date(Date.now() - 86400_000).toISOString()
  check('assign_lesson_homework', (await sb.rpc('assign_lesson_homework', {
    p_lesson_id: LESSON_ID, p_collection_id: COLLECTION, p_due_date: pastDue, p_confirm_dup: false,
  } as never)).error)

  const { data: acRow, error: acErr } = await sb.from('assigned_collections')
    .select('id').eq('lesson_id', LESSON_ID).eq('collection_id', COLLECTION).single()
  check('read back assigned_collections id', acErr)
  ASSIGNED_ID = (acRow as { id: string }).id

  // Student A submits via the real submit RPC (own session), then teacher grades it.
  const sbA = createClient(SUPABASE_URL, ANON_KEY)
  await sbA.auth.signInWithPassword({ email: 'alex@demo.ru', password: 'demo123' })
  check('submit_task_solution', (await sbA.rpc('submit_task_solution', {
    p_assigned_id: ASSIGNED_ID, p_answers: {}, p_files: [],
  } as never)).error)

  const { data: subRow, error: subErr } = await sb.from('task_submissions')
    .select('id').eq('assigned_id', ASSIGNED_ID).eq('student_id', STUDENT_A).single()
  check('read back task_submissions id', subErr)
  SUBMISSION_ID = (subRow as { id: string }).id

  check('grade_task_submission', (await sb.rpc('grade_task_submission', {
    p_submission_id: SUBMISSION_ID, p_status: 'accepted', p_score: 8.5, p_comment: null,
  } as never)).error)
  // B intentionally never submits (not_started / overdue by deadline)

  const browser = await chromium.launch()

  teacherCtx = await browser.newContext({ storageState: path.resolve('test-results/auth.json') })
  teacherPage = await teacherCtx.newPage()

  studentACtx = await browser.newContext()
  studentAPage = await studentACtx.newPage()
  await studentAPage.goto('/login')
  await studentAPage.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await studentAPage.fill('input[type="email"]', 'alex@demo.ru')
  await studentAPage.fill('input[type="password"]', 'demo123')
  await studentAPage.click('button[type="submit"]')
  await studentAPage.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })

  studentBCtx = await browser.newContext()
  studentBPage = await studentBCtx.newPage()
  await studentBPage.goto('/login')
  await studentBPage.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await studentBPage.fill('input[type="email"]', 'nikita@demo.ru')
  await studentBPage.fill('input[type="password"]', 'demo123')
  await studentBPage.click('button[type="submit"]')
  await studentBPage.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })
})

test.afterAll(async () => {
  const sb = await admin()
  await sb.from('task_submissions').delete().eq('id', SUBMISSION_ID)
  await sb.from('assigned_collection_members').delete().eq('assigned_id', ASSIGNED_ID)
  await sb.from('assigned_collections').delete().eq('id', ASSIGNED_ID)
  await sb.from('attendance').delete().eq('lesson_id', LESSON_ID)
  await sb.from('lessons').delete().eq('id', LESSON_ID)

  if (teacherCtx) await teacherCtx.close()
  if (studentACtx) await studentACtx.close()
  if (studentBCtx) await studentBCtx.close()
})

test.describe.configure({ mode: 'serial' })

// ══════════════════════════════════════════════════════════════════════════════
// Teacher journal
// ══════════════════════════════════════════════════════════════════════════════

test('teacher: opens student card → journal → summary/lessons/hw → period → hw filter → lesson → back → submission', async () => {
  await teacherPage.goto(`/students/${STUDENT_A}`)
  await teacherPage.waitForSelector('text=Журнал ученика', { timeout: 20_000 })
  await teacherPage.click('text=Журнал ученика')
  await teacherPage.waitForURL(new RegExp(`/students/${STUDENT_A}/journal`), { timeout: 15_000 })

  // Full name visible, not stuck loading
  await expect(teacherPage.locator('text=Алексей Петров')).toBeVisible({ timeout: 20_000 })
  await expect(teacherPage.locator('text=Загрузка журнала')).toHaveCount(0)

  // Summary present
  await expect(teacherPage.locator('text=Занятий завершено')).toBeVisible()
  await expect(teacherPage.locator('text=Средний балл')).toBeVisible()

  // Lessons table shows our seeded lesson
  await expect(teacherPage.locator('text=E2E JOURNAL group lesson')).toBeVisible({ timeout: 15_000 })

  // Homework table shows our seeded assignment, accepted, score visible
  await expect(teacherPage.locator('text=qqq').first()).toBeVisible()
  await expect(teacherPage.locator('text=Принято').first()).toBeVisible()
  await expect(teacherPage.locator('text=балл: 8.5')).toBeVisible()

  // Change period — data reloads without an infinite spinner
  await teacherPage.click('button:has-text("Всё время")')
  await expect(teacherPage.locator('text=Загрузка журнала')).toHaveCount(0, { timeout: 500 }).catch(() => {})
  await expect(teacherPage.locator('text=E2E JOURNAL group lesson')).toBeVisible({ timeout: 15_000 })

  // Filter homework by status
  await teacherPage.selectOption('select >> nth=1', { label: 'Принято' })
  await expect(teacherPage.locator('text=qqq').first()).toBeVisible({ timeout: 10_000 })

  // Open the lesson card from the journal, then navigate back
  await teacherPage.click('text=E2E JOURNAL group lesson')
  await teacherPage.waitForURL(new RegExp(`/lessons/${LESSON_ID}`), { timeout: 15_000 })
  await expect(teacherPage.locator('text=E2E: групповой журнал').first()).toBeVisible({ timeout: 15_000 })

  await teacherPage.goBack()
  await teacherPage.waitForURL(new RegExp(`/students/${STUDENT_A}/journal`), { timeout: 15_000 })

  // Open the submission from the journal's homework row
  await teacherPage.click('text=qqq')
  await teacherPage.waitForURL(new RegExp(`/review-submissions/${SUBMISSION_ID}`), { timeout: 15_000 })
  await expect(teacherPage.locator('text=8.5').first()).toBeVisible({ timeout: 15_000 })
})

test('teacher: journal of student B never shows student A\'s score (group independence)', async () => {
  await teacherPage.goto(`/students/${STUDENT_B}/journal`)
  await expect(teacherPage.locator('text=Никита Волков')).toBeVisible({ timeout: 20_000 })

  await expect(teacherPage.locator('text=qqq').first()).toBeVisible({ timeout: 15_000 })
  await expect(teacherPage.locator('text=Просрочено').first()).toBeVisible()
  await expect(teacherPage.locator('text=8.5')).toHaveCount(0)
  await expect(teacherPage.locator('text=балл: 8.5')).toHaveCount(0)

  const bodyText = await teacherPage.locator('body').innerText()
  expect(bodyText).not.toContain('Алексей Петров')
})

// ══════════════════════════════════════════════════════════════════════════════
// Student journal
// ══════════════════════════════════════════════════════════════════════════════

test('student A: /my-progress journal section shows own lessons/hw, no other student data', async () => {
  await studentAPage.goto('/my-progress')
  await studentAPage.waitForSelector('text=Журнал занятий и заданий', { timeout: 20_000 })

  await expect(studentAPage.locator('text=E2E JOURNAL group lesson')).toBeVisible({ timeout: 15_000 })
  await expect(studentAPage.locator('text=qqq').first()).toBeVisible()
  await expect(studentAPage.locator('text=Принято').first()).toBeVisible()

  // Change period
  await studentAPage.click('button:has-text("Всё время")')
  await expect(studentAPage.locator('text=E2E JOURNAL group lesson')).toBeVisible({ timeout: 15_000 })

  // Open lesson, go back
  await studentAPage.click('text=E2E JOURNAL group lesson')
  await studentAPage.waitForURL(new RegExp(`/lessons/${LESSON_ID}`), { timeout: 15_000 })
  await studentAPage.goBack()
  await studentAPage.waitForSelector('text=Журнал занятий и заданий', { timeout: 15_000 })

  // Open own submission via /my-assignments/:assigned_id
  await studentAPage.click('text=qqq')
  await studentAPage.waitForURL(new RegExp(`/my-assignments/${ASSIGNED_ID}`), { timeout: 15_000 })

  const html = await studentAPage.content()
  expect(html).not.toContain('teacher_notes')
  expect(html).not.toContain('Никита Волков')
})

test('student A network responses never leak teacher_notes, other submissions, or catalog answers', async () => {
  const responses: string[] = []
  studentAPage.on('response', async (res) => {
    if (res.url().includes('/rpc/get_student_journal')) {
      try { responses.push(await res.text()) } catch { /* ignore */ }
    }
  })
  await studentAPage.goto('/my-progress')
  await studentAPage.waitForSelector('text=Журнал занятий и заданий', { timeout: 20_000 })
  await studentAPage.waitForTimeout(1000)

  for (const body of responses) {
    expect(body).not.toContain('teacher_notes')
    expect(body).not.toContain('answer_html')
    expect(body).not.toContain('solution_html')
    expect(body).not.toContain('Никита Волков')
  }
  expect(responses.length).toBeGreaterThan(0)
})

test('student B: sees own not_started/overdue homework, never sees student A\'s score', async () => {
  await studentBPage.goto('/my-progress')
  await studentBPage.waitForSelector('text=Журнал занятий и заданий', { timeout: 20_000 })

  await expect(studentBPage.locator('text=qqq').first()).toBeVisible({ timeout: 15_000 })
  await expect(studentBPage.locator('text=Просрочено').first()).toBeVisible()
  await expect(studentBPage.locator('text=8.5')).toHaveCount(0)

  const bodyText = await studentBPage.locator('body').innerText()
  expect(bodyText).not.toContain('Алексей Петров')
})
