/**
 * 13.10, владелец: «с аккаунта ученика убрать ссылки на ДЗ в моём курсе».
 * ДЗ «урочных» курсов (раздел «Мой курс»: темы с lesson_format или режим «по
 * прохождению») не попадают ни на «Домашние задания», ни в кнопки главной, ни
 * в бейдж меню. ДЗ школьных групп — как было. База подменена на уровне
 * `@/lib/supabase`: проверяются настоящие хуки и одно общее правило.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { TopicJournalHomework } from '@/lib/topicJournal'

type Filters = Record<string, unknown>
type Res = { data?: unknown; count?: number | null; error?: unknown }

const db = vi.hoisted(() => ({
  tables: {} as Record<string, (f: Record<string, unknown>) => { data?: unknown; count?: number | null; error?: unknown }>,
  calls: [] as string[],
}))

vi.mock('@/lib/supabase', () => {
  function chain(table: string) {
    const f: Filters = {}
    const c: Record<string, unknown> = {}
    const pass = (k: string) => (col: string, a?: unknown, b?: unknown) => { f[`${k}:${col}`] = b === undefined ? a : [a, b]; return c }
    for (const k of ['eq', 'not', 'in', 'is', 'order', 'limit']) c[k] = pass(k)
    c.select = (cols: string, opts?: unknown) => { f.select = cols; f.opts = opts; return c }
    c.maybeSingle = () => c
    c.then = (ok: (r: Res) => unknown, bad?: (e: unknown) => unknown) => {
      db.calls.push(table)
      try {
        const r = db.tables[table]?.(f) ?? { data: [], count: 0, error: null }
        return Promise.resolve({ data: null, count: null, error: null, ...r }).then(ok, bad)
      } catch (e) {
        return Promise.reject(e).then(ok, bad)
      }
    }
    return c
  }
  return { supabase: { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }) } }
})

// Курсы ученика: школьная группа cS и «урочный» cL.
vi.mock('@/lib/studentTopicAccess', async (orig) => ({
  ...(await orig<object>()),
  fetchGroupIdByCourse: vi.fn(async () => new Map([['cS', 'gS'], ['cL', 'gL']])),
}))
const journal = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('@/hooks/useStudentTopicJournal', () => ({
  useStudentTopicJournal: () => ({ journal: { homework: journal.rows, tests: [], summary: {} }, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useMyCourseMemberships', () => ({
  useMyCourseMemberships: () => ({
    courses: [
      { courseId: 'cS', title: 'Физика ЕГЭ 11А класс', subject: 'physics', examType: 'ege', groups: [] },
      { courseId: 'cL', title: 'Физика ЕГЭ (новый)', subject: 'physics', examType: 'ege', groups: [] },
    ],
    loading: false, error: null, reload: vi.fn(),
  }),
}))

import { fetchLessonCourseIds, isLessonProgram, resetLessonCourseCache } from '../lessonCourses'
import { useStudentTodo } from '@/hooks/useStudentTodo'
import { useSidebarBadges } from '@/hooks/useSidebarBadges'
import { useMyTopicHomework } from '@/hooks/useMyTopicHomework'
import { useAuthStore } from '@/store/authStore'

/** Урочный курс — cL (темы с lesson_format); cP — в режиме «по прохождению». */
function lessonDb() {
  db.tables.topics = (f) => ({ count: f['eq:module.course_id'] === 'cL' ? 7 : 0 })
  db.tables.course_unlock_modes = () => ({ data: [] })
}

const topicOf = (course: string, id: string) => ({ id: `t-${id}`, title: `Тема ${id}`, is_open: true, available_from: null, module: { id: 'm', course: { id: course, title: course, subject: 'physics' } } })

beforeEach(() => {
  resetLessonCourseCache()
  db.tables = {}
  db.calls = []
  journal.rows = []
  useAuthStore.setState({
    profile: { id: 'p1', email: 's@t.ru', full_name: 'Аня', role: 'student', created_at: '', updated_at: '' },
    loading: false,
  } as never)
})

describe('признак «урочного» курса', () => {
  it('по программе: есть урок нового формата или режим «по прохождению»', () => {
    expect(isLessonProgram([{ lesson_format: null }, { lesson_format: 'training' }])).toBe(true)
    expect(isLessonProgram([{ lesson_format: null }, {}])).toBe(false)
    expect(isLessonProgram([], 'progress')).toBe(true)
  })

  it('по базе: темы с lesson_format или course_unlock_modes = progress; сбой — «не урочный»', async () => {
    db.tables.topics = (f) => ({ count: f['eq:module.course_id'] === 'cL' ? 3 : 0 })
    db.tables.course_unlock_modes = () => ({ data: [{ course_id: 'cP' }] })
    expect([...(await fetchLessonCourseIds(['cS', 'cL', 'cP']))].sort()).toEqual(['cL', 'cP'])
    resetLessonCourseCache()
    db.tables.topics = () => ({ error: { message: 'нет доступа' } })
    db.tables.course_unlock_modes = () => { throw new Error('сеть') }
    expect([...(await fetchLessonCourseIds(['cS', 'cL']))]).toEqual([])
  })
})

describe('кнопки главной (useStudentTodo)', () => {
  it('ДЗ, попытки и тесты урочного курса не считаются; школьные — как были', async () => {
    lessonDb()
    db.tables.students = () => ({ data: { id: 'st1' } })
    db.tables.topic_homework = () => ({
      data: [
        { id: 'hwS', title: 'ДЗ школы', due_at: null, topic: topicOf('cS', 'S') },
        { id: 'hwL', title: 'ДЗ урока', due_at: null, topic: topicOf('cL', 'L') },
      ],
    })
    db.tables.topic_homework_attempts = () => ({
      data: [
        { id: 'aS', homework_id: 'hwS', student_id: 'st1', status: 'returned_for_revision', attempt_number: 1, created_at: '2026-10-10T10:00:00Z', homework: { id: 'hwS', title: 'ДЗ школы', grade_scale: 'five', topic: topicOf('cS', 'S') } },
        { id: 'aL', homework_id: 'hwL', student_id: 'st1', status: 'returned_for_revision', attempt_number: 1, created_at: '2026-10-10T10:00:00Z', homework: { id: 'hwL', title: 'ДЗ урока', grade_scale: 'five', topic: topicOf('cL', 'L') } },
      ],
    })
    db.tables.topic_homework_reviews = () => ({ data: [] })
    db.tables.topic_test_assignments = () => ({
      data: [
        { id: 'taS', test_id: 'tS', topic_id: 't-S', topic: { id: 't-S', title: 'Тема S', module: { course_id: 'cS' } }, test: { id: 'tS', title: 'Тест школы' } },
        { id: 'taL', test_id: 'tL', topic_id: 't-L', topic: { id: 't-L', title: 'Тема L', module: { course_id: 'cL' } }, test: { id: 'tL', title: 'Тест урока' } },
      ],
    })
    db.tables.topic_test_attempts = () => ({ data: [] })
    const { result } = renderHook(() => useStudentTodo('p1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const dump = JSON.stringify(result.current.todo)
    expect(dump).toContain('hwS')
    expect(dump).toContain('Тест школы')
    expect(dump).not.toContain('hwL')
    expect(dump).not.toContain('Тест урока')
  })
})

describe('бейдж меню «Домашние задания»', () => {
  it('возвращённые работы урочного курса не считаются', async () => {
    lessonDb()
    db.tables.notifications = () => ({ count: 0 })
    db.tables.student_achievements = () => ({ count: 0 })
    const ret = (course: string) => ({ id: course, homework: { topic: { module: { course_id: course } } } })
    db.tables.topic_homework_attempts = () => ({ data: [ret('cS'), ret('cL'), ret('cL')] })
    const { result } = renderHook(() => useSidebarBadges())
    await waitFor(() => expect(result.current['/my-homework']).toBe(1))
  })
})

describe('страница «Домашние задания» (useMyTopicHomework)', () => {
  const row = (id: string, course: string): TopicJournalHomework => ({
    homework_id: id, title: 'ДЗ', topic_id: `t-${id}`, topic_title: 'Тема', module_title: null,
    course_id: course, course_title: course, due_at: null, grade_scale: 'five', status: 'not_started',
    score: null, comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false,
  })

  it('ни строк, ни переключателя урочного курса; школьные — на месте', async () => {
    lessonDb()
    db.tables.students = () => ({ data: { id: 'st1' } })
    db.tables.courses = () => ({ data: [{ id: 'cS', subject: 'physics' }] })
    journal.rows = [row('h1', 'cS'), row('h2', 'cL'), row('h3', 'cL')]
    const { result } = renderHook(() => useMyTopicHomework())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalRows).toBe(1)
    expect(result.current.buckets.todo.map(r => r.homework_id)).toEqual(['h1'])
    expect(result.current.courseOptions.map(o => o.id)).toEqual(['cS'])
  })
})
