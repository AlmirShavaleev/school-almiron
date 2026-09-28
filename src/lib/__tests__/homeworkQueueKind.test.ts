import { describe, expect, it } from 'vitest'
import { QUEUE_SELECT, reviewHeaderMeta, toQueueRows } from '../homeworkQueue'
import { topicSections, topicGroups } from '../topicProgress'

/**
 * §240. Очередь знает тип темы работы; автосдача подписана в шапке проверки.
 * «Ответы и критерии» не заводят группу ДЗ — как в `topic_done_events()`.
 */

const raw = (kind?: string, attempt: Record<string, unknown> = {}) => ({
  id: 'a1', homework_id: 'h1', student_id: 's1', attempt_number: 1, status: 'submitted',
  submitted_at: '2026-10-02T07:45:00.000Z', created_at: '', updated_at: '', ...attempt,
  homework: {
    id: 'h1', title: 'Контрольная работа', grade_scale: 'five', due_at: null,
    topic: { id: 't1', title: 'Кинематика', ...(kind === undefined ? {} : { kind }), module: { id: 'm1', course: { id: 'c1', title: '10А' } } },
  },
})

describe('очередь: тип темы (§240)', () => {
  it('тема читается целиком — тип едет без явного столбца', () => {
    expect(QUEUE_SELECT).toContain('topic:topics!inner(*,')
  })

  it('тип из темы; без столбца (старая база) — урок', () => {
    expect(toQueueRows([raw('control')])[0].topicKind).toBe('control')
    expect(toQueueRows([raw('check')])[0].topicKind).toBe('check')
    expect(toQueueRows([raw()])[0].topicKind).toBe('lesson')
  })

  it('шапка проверки: «сдано автоматически … в 10:45» по Москве, без «в срок»', () => {
    const [row] = toQueueRows([raw('control', { auto_submitted: true })])
    const meta = reviewHeaderMeta(row, [{ mime_type: 'image/jpeg', file_name: 'p1.jpg' }])
    expect(meta).toContain('сдано автоматически 2 октября в 10:45')
    expect(meta).not.toContain('в срок')
    expect(meta).toContain('1 фото')
  })

  it('сданное самим — прежняя строка', () => {
    const [row] = toQueueRows([raw('control')])
    expect(reviewHeaderMeta(row, [])).toMatch(/^Кинематика · 10А · сдано 2 октября в \d\d:\d\d$/)
  })
})

describe('«тема пройдена»: критерии не заводят группу ДЗ (§240)', () => {
  it('тема только с критериями — без группы ДЗ; с ДЗ — группа есть', () => {
    const onlyCriteria = topicSections({ hasVideo: false, sectionCounts: { criteria: 1 }, hasHomework: false, hasTest: false })
    expect(topicGroups(onlyCriteria)).toEqual([])
    const withHw = topicSections({ hasVideo: false, sectionCounts: { criteria: 1 }, hasHomework: true, hasTest: false })
    expect(topicGroups(withHw)).toEqual(['homework'])
  })
})
