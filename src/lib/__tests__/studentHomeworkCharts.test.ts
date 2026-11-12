import { describe, it, expect } from 'vitest'
import { homeworkChartData } from '../studentHomeworkCharts'
import type { QueueRow } from '../homeworkQueue'
import type { TopicHomeworkReviewRow } from '../topicHomework'
const now = Date.parse('2026-11-13T12:00:00Z')
function work(id: string, status = 'accepted', subject = 'physics', at = '2026-11-10T12:00:00Z'): QueueRow {
  return { attempt: { id, status, submitted_at: at }, subject, gradeScale: 'hundred', topicKind: 'lesson', homeworkTitle: id } as QueueRow
}
function review(id: string, score: number | null, decision = 'accepted'): TopicHomeworkReviewRow {
  return { id, attempt_id: id, score, decision, created_at: '2026-11-11' } as TopicHomeworkReviewRow
}
describe('динамика ДЗ', () => {
  it('сохраняет настоящий ноль, исключает отсутствие оценки и непринятые работы', () => {
    const d = homeworkChartData([work('zero'), work('none'), work('pending', 'submitted')], [review('zero', 0), review('none', null), review('pending', 90)], 30, 'all', now)
    expect(d.points.map(p => p.score)).toEqual([0])
    expect(d.counts.map(c => c.count)).toEqual([2, 1, 0])
  })
  it('применяет период и предмет, не принимает будущие даты', () => {
    const d = homeworkChartData([work('p'), work('m','accepted','math'), work('old','accepted','physics','2025-01-01'), work('future','accepted','physics','2027-01-01')], [], 30, 'physics', now)
    expect(d.rows.map(w => w.attempt.id)).toEqual(['p'])
  })
  it('берёт последний вердикт и исключает контрольные из графика ДЗ', () => {
    const control = { ...work('c'), topicKind: 'control' as const }
    const d = homeworkChartData([work('a'), control], [review('a', 50), { ...review('a', 80), created_at: '2026-11-12' }], 0, 'all', now)
    expect(d.points.map(p => p.score)).toEqual([80])
    expect(d.rows).toHaveLength(1)
  })
  it('сигнал перерыва использует историю, даже когда в периоде нет работ', () => {
    const d = homeworkChartData([work('a','accepted','physics','2026-09-01')], [], 30, 'all', now)
    expect(d.rows).toHaveLength(0)
    expect(d.notices.join(' ')).toContain('Последняя сдача')
  })
})
