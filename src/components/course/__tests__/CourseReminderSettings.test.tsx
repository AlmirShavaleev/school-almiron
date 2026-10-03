import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/**
 * §264. Настройки напоминаний: у учителя на курс (`course_reminder_settings`) и у ученика у себя
 * (`notification_prefs.remind_*`). Подменён только `supabase.from`: что читается, что пишется при нажатии, откат при
 * ошибке. Примеры сообщений — тем же модулем, что очередь (без эмодзи).
 */
type Row = Record<string, unknown> | null
const db = {
  rows: {} as Record<string, Row>,
  upserts: [] as [string, Record<string, unknown>, unknown][],
  upsertError: null as { message: string } | null,
  selectError: null as { message: string } | null,
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: db.rows[table] ?? null, error: db.selectError }) }) }),
      upsert: (row: Record<string, unknown>, opts: unknown) => { db.upserts.push([table, row, opts]); return Promise.resolve({ data: null, error: db.upsertError }) },
    }),
  },
}))
import { CourseReminderSettings } from '@/components/course/CourseReminderSettings'
import { StudentReminderPrefs } from '@/components/student/StudentReminderPrefs'

beforeEach(() => { db.rows = {}; db.upserts = []; db.upsertError = null; db.selectError = null })

const sw = (id: string) => screen.getByTestId(id)
const checked = (id: string) => sw(id).getAttribute('aria-checked')

describe('CourseReminderSettings (учитель, вкладка «Настройки» курса)', () => {
  it('нет строки — по умолчанию всё включено, кроме «Пробник завтра»; шесть видов с «когда / кому»', async () => {
    render(<CourseReminderSettings courseId="c-1" />)
    await waitFor(() => expect(sw('reminder-toggle-hw_due_tomorrow').hasAttribute('disabled')).toBe(false))
    expect(['hw_due_tomorrow', 'hw_overdue', 'check_soon', 'no_photo', 'streak', 'mock_tomorrow'].map(k => checked(`reminder-toggle-${k}`)))
      .toEqual(['true', 'true', 'true', 'true', 'true', 'false'])
    expect(screen.getByTestId('reminder-row-check_soon').textContent).toContain('за 1 час до начала')
    expect(screen.getByTestId('reminder-row-no_photo').textContent).toContain('открыл, но без фото')
    expect(screen.getByText(/Не больше 2 напоминаний в день/)).toBeTruthy()
  })

  it('нажатие сохраняет строку курса целиком (upsert по course_id)', async () => {
    db.rows.course_reminder_settings = { course_id: 'c-1', streak: false, mock_tomorrow: true }
    render(<CourseReminderSettings courseId="c-1" />)
    await waitFor(() => expect(checked('reminder-toggle-streak')).toBe('false'))
    expect(checked('reminder-toggle-mock_tomorrow')).toBe('true')
    fireEvent.click(sw('reminder-toggle-hw_overdue'))
    await screen.findByTestId('reminder-settings-saved')
    expect(db.upserts).toHaveLength(1)
    const [table, row, opts] = db.upserts[0]
    expect(table).toBe('course_reminder_settings')
    expect(opts).toEqual({ onConflict: 'course_id' })
    expect(row).toMatchObject({ course_id: 'c-1', hw_due_tomorrow: true, hw_overdue: false, check_soon: true, no_photo: true, streak: false, mock_tomorrow: true })
    expect(checked('reminder-toggle-hw_overdue')).toBe('false')
  })

  it('ошибка записи (нет прав) — переключатель возвращается, сообщение', async () => {
    db.upsertError = { message: 'new row violates row-level security policy' }
    render(<CourseReminderSettings courseId="c-1" />)
    await waitFor(() => expect(sw('reminder-toggle-check_soon').hasAttribute('disabled')).toBe(false))
    fireEvent.click(sw('reminder-toggle-check_soon'))
    await screen.findByTestId('reminder-settings-error')
    expect(checked('reminder-toggle-check_soon')).toBe('true')
  })

  it('примеры сообщений — тексты очереди, без эмодзи', async () => {
    render(<CourseReminderSettings courseId="c-1" />)
    const samples = await screen.findByTestId('reminder-samples')
    expect(samples.textContent).toContain('Завтра срок ДЗ «Динамика. Законы Ньютона». Ещё не сдано.')
    expect(samples.textContent).toContain('Через 45 минут проверочная «Движение по окружности», 08:45–09:30.')
    expect(samples.textContent).toContain('Серия 6 дней! Реши сегодня одну задачу — и будет 7.')
    expect(samples.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})

describe('StudentReminderPrefs (ученик, «Настройки» → «Уведомления»)', () => {
  it('выключает вид у себя: upsert своей строки notification_prefs с remind_*', async () => {
    db.rows.notification_prefs = { user_id: 'p-1', telegram: true, remind_streak: false }
    render(<StudentReminderPrefs profileId="p-1" telegramOn />)
    await waitFor(() => expect(checked('student-reminder-toggle-streak')).toBe('false'))
    expect(checked('student-reminder-toggle-mock_tomorrow')).toBe('true')
    fireEvent.click(sw('student-reminder-toggle-hw_due_tomorrow'))
    await waitFor(() => expect(db.upserts).toHaveLength(1))
    const [table, row, opts] = db.upserts[0]
    expect(table).toBe('notification_prefs')
    expect(opts).toEqual({ onConflict: 'user_id' })
    expect(row).toMatchObject({ user_id: 'p-1', remind_hw_due_tomorrow: false, remind_streak: false, remind_check_soon: true })
    expect(row).not.toHaveProperty('telegram')
  })
  it('без Telegram — подсказка подключить его', async () => {
    render(<StudentReminderPrefs profileId="p-1" telegramOn={false} />)
    expect(await screen.findByText(/подключите его ниже/)).toBeTruthy()
  })
})
