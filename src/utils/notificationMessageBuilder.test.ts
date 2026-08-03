import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildLinkButton, escapeHtml, formatDay, formatWhen } from '../../supabase/functions/_shared/variant-telegram'

type Message = { text: string; replyMarkup: unknown }
type Builder = (item: { event_type: string; payload: Record<string, unknown> }, appUrl: string) => Message

const source = readFileSync('supabase/functions/process-notification-queue/index.ts', 'utf8')
const start = source.indexOf('function buildMessage(')
const end = source.indexOf('\nDeno.serve(', start)
const functionSource = source.slice(start, end)
const js = ts.transpileModule(functionSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

const buildMessage = new Function(
  'buildVariantAssignedTelegramMessage',
  'buildVariantDeadlineTelegramMessage',
  'buildLinkButton',
  'escapeHtml',
  'formatWhen',
  'formatDay',
  `${js}; return buildMessage`,
)(
  () => ({ text: 'variant assigned', replyMarkup: null }),
  () => ({ text: 'variant deadline', replyMarkup: null }),
  // Настоящие реализации живут в _shared/variant-telegram.ts и покрыты
  // отдельно в variantTelegramQueue.test.ts; здесь важно лишь то, что
  // buildMessage их зовёт и возвращает пригодный объект.
  buildLinkButton,
  escapeHtml,
  formatWhen,
  formatDay,
) as Builder

const events = [
  'new_homework', 'lesson_reminder', 'lesson_rescheduled', 'lesson_cancelled',
  'homework_reviewed', 'collection_assigned', 'collection_submitted',
  'collection_resubmitted', 'collection_reviewed', 'variant_assigned',
  'variant_deadline_changed', 'unknown_event',
]

describe('process-notification-queue buildMessage', () => {
  it.each(events)('%s returns an object with non-empty text', (event_type) => {
    const result = buildMessage({
      event_type,
      payload: {
        title: 'Тест', due_date: '01.01.2027', due_at: '2027-01-01T10:00:00Z',
        old_scheduled_at: 'old', new_scheduled_at: 'new', scheduled_at: 'now',
        reminder_type: '24h', status: 'accepted', student_name: 'Ученик',
      },
    }, 'https://school.example')

    expect(result).toEqual(expect.objectContaining({ text: expect.any(String) }))
    expect(result.text.length).toBeGreaterThan(0)
    expect(result).toHaveProperty('replyMarkup')
  })
})

// Ссылка кнопкой, а не <a href> в тексте: Telegram молча проглатывает якорь с
// относительным href и печатает его содержимое обычным текстом — сообщение
// уходит со статусом 200, и поломка не видна нигде. Прод, 2026-08-03.
describe('ссылки в карточках', () => {
  const linkedEvents: Array<[string, Record<string, unknown>]> = [
    ['new_homework',             { title: 'Тема', due_date: '01.01.2027', link: '/my-course/g/topic/t' }],
    ['topic_homework_submitted', { title: 'Тема', student_name: 'Ученик', link: '/homework-queue' }],
    ['topic_homework_reviewed',  { title: 'Тема', decision: 'accepted', link: '/my-course/g/topic/t' }],
    ['collection_assigned',      { title: 'Сборник', link: '/collections/1' }],
    ['collection_submitted',     { title: 'Сборник', link: '/collections/1' }],
    ['collection_reviewed',      { title: 'Сборник', status: 'accepted', link: '/collections/1' }],
    ['variant_graded',           { title: 'Работа проверена', body: 'Балл: 5', link: '/student/variants/a1' }],
    ['lesson_reminder',          { title: 'Занятие', reminder_type: '24h', zoom_link: 'https://zoom.us/j/1' }],
  ]

  it.each(linkedEvents)('%s отдаёт ссылку кнопкой, а не текстом', (event_type, payload) => {
    const result = buildMessage({ event_type, payload }, 'https://school.example')

    expect(result.replyMarkup).not.toBeNull()
    const url = (result.replyMarkup as { inline_keyboard: Array<Array<{ url: string }>> })
      .inline_keyboard[0][0].url
    expect(url).toMatch(/^https:\/\//)
    expect(result.text).not.toContain('<a href')
  })

  it.each(linkedEvents.filter(([e]) => e !== 'lesson_reminder'))(
    '%s без APP_URL не оставляет мёртвую ссылку', (event_type, payload) => {
      const result = buildMessage({ event_type, payload }, '')

      expect(result.replyMarkup).toBeNull()
      expect(result.text).not.toContain('<a href')
      expect(result.text).not.toContain('→</a>')
    })

  it('support_request: тема, контекст и счётчик скриншотов; кнопки нет', () => {
    const result = buildMessage({
      event_type: 'support_request',
      payload: {
        subject:     'Рамка не тянется',
        author_name: 'Альмир Ученик',
        author_role: 'Ученик',
        page_path:   '/homework-queue',
        created_at:  '03.08.2026 11:43',
        message:     'Рамка не тянется за нижний край, если 1 < k < 2',
        attachments: ['uid/f/1-shot.png', 'uid/f/2-shot.png'],
      },
    }, 'https://school.example')

    expect(result.text).toContain('Рамка не тянется')
    expect(result.text).toContain('Альмир Ученик · Ученик')
    expect(result.text).toContain('/homework-queue')
    expect(result.text).toContain('03.08.2026 11:43')
    expect(result.text).toContain('1 &lt; k &lt; 2')
    expect(result.text).toContain('Скриншотов: 2')
    expect(result.replyMarkup).toBeNull()
  })

  it('support_request без скриншотов не пишет про вложения', () => {
    const result = buildMessage({
      event_type: 'support_request',
      payload: { subject: 'Тема', author_name: 'Кто-то', author_role: 'Ученик', message: 'Текст обращения' },
    }, 'https://school.example')

    expect(result.text).not.toContain('Скриншотов')
  })

  // Дедлайн приходит датой без времени либо null. Год печатается только если
  // он не текущий: в базе нашлись работы с годом 0020 и 0002, и спрятанный
  // год сделал бы такую дату правдоподобной.
  it('new_homework: дата без года в текущем году', () => {
    const year = new Date().getUTCFullYear()
    const result = buildMessage({
      event_type: 'new_homework',
      payload: { title: 'Тема', course_title: 'Курс', due_date: `${year}-08-12` },
    }, 'https://school.example')

    expect(result.text).toContain('Сдать до 12 августа')
    expect(result.text).not.toContain(String(year))
  })

  it('new_homework: чужой год печатается, а не прячется', () => {
    const result = buildMessage({
      event_type: 'new_homework',
      payload: { title: 'Тема', course_title: 'Курс', due_date: '0020-08-12' },
    }, 'https://school.example')

    // Локаль сокращает 0020 до «20 г.» — важно, что год вообще виден:
    // без него «12 августа» выглядело бы нормальной датой.
    expect(result.text).toMatch(/12 августа\s+\d+\s*г\./)
  })

  it('new_homework без дедлайна не печатает «Сдать до»', () => {
    const result = buildMessage({
      event_type: 'new_homework',
      payload: { title: 'Тема', course_title: 'Курс', due_date: null },
    }, 'https://school.example')

    expect(result.text).toContain('Без дедлайна')
    expect(result.text).not.toContain('Сдать до')
  })

  it('текст от пользователя экранируется, иначе Telegram роняет разбор', () => {
    const result = buildMessage({
      event_type: 'topic_homework_reviewed',
      payload: {
        title: 'Задача 1 & 2',
        decision: 'returned_for_revision',
        comment: 'Условие p < 2 & V > 0 разобрано неверно',
      },
    }, 'https://school.example')

    expect(result.text).toContain('Задача 1 &amp; 2')
    expect(result.text).toContain('p &lt; 2 &amp; V &gt; 0')
    expect(result.text).not.toMatch(/[^&;]< 2/)
  })
})
