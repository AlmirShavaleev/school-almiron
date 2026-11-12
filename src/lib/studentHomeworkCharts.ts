import type { QueueRow } from './homeworkQueue'
import type { TopicHomeworkReviewRow } from './topicHomework'

export function homeworkChartData(works: QueueRow[], reviews: TopicHomeworkReviewRow[], days: number, subject: string, now = Date.now()) {
  const start = days ? now - days * 86400000 : -Infinity
  const eligible = works.filter(w => (!w.topicKind || w.topicKind === 'lesson') && (subject === 'all' || w.subject === subject))
  const rows = eligible.filter(w => {
    const at = Date.parse(w.attempt.submitted_at ?? '')
    return at >= start && at <= now
  })
  const latest = new Map<string, TopicHomeworkReviewRow>()
  for (const r of reviews) {
    if (!latest.has(r.attempt_id) || r.created_at > latest.get(r.attempt_id)!.created_at) latest.set(r.attempt_id, r)
  }
  const points = rows.flatMap(w => {
    const r = latest.get(w.attempt.id)
    const max = w.gradeScale === 'five' ? 5 : w.gradeScale === 'hundred' ? 100 : null
    if (w.attempt.status !== 'accepted' || r?.decision !== 'accepted' || r.score == null || !max || r.score < 0 || r.score > max) return []
    return [{ id: w.attempt.id, title: w.homeworkTitle, at: w.attempt.submitted_at!, score: r.score, max, scale: w.gradeScale! }]
  }).sort((a, b) => a.at.localeCompare(b.at))
  const counts = ['accepted', 'submitted', 'returned_for_revision'].map(status => ({ status, count: rows.filter(w => w.attempt.status === status).length }))
  const notices: string[] = []
  const revision = counts[2].count
  if (revision) notices.push(`На доработке: ${revision}. Откройте работы и проверьте, понятны ли ученику замечания.`)
  if (counts[1].count) notices.push(`Ожидают проверки: ${counts[1].count}.`)
  const dates = eligible.map(w => Date.parse(w.attempt.submitted_at ?? '')).filter(t => Number.isFinite(t) && t <= now)
  if (dates.length) {
    const silent = Math.floor((now - Math.max(...dates)) / 86400000)
    if (silent >= 14) notices.push(`Последняя сдача ДЗ по выбранному предмету — ${silent} дн. назад. Проверьте расписание и наличие заданий.`)
  }
  if (points.length < 2) notices.push('Для динамики нужны хотя бы две принятые работы с оценками одной шкалы.')
  return { rows, points, counts, notices }
}
