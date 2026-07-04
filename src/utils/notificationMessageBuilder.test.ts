import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

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
  `${js}; return buildMessage`,
)(
  () => ({ text: 'variant assigned', replyMarkup: null }),
  () => ({ text: 'variant deadline', replyMarkup: null }),
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
