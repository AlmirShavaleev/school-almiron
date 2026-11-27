import { memo, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Sticker } from '@/components/student/skin/Sticker'
import { useMyForecastRanges } from '@/hooks/useMyForecastRanges'
import { isEgeSubject, type EgeSubject } from '@/lib/egeScales'
import type { MockLessonListRow } from '@/lib/mockExamLesson'
import { EXAM_LABELS, SUBJECT_LABELS } from '@/utils/format'

interface ExamHistoryRow extends MockLessonListRow {
  subject: string | null
  examType: string | null
}

interface ScoreSeries {
  key: string
  subjectCode: string | null
  subject: string
  examType: string | null
  max: number | null
  results: { startsAt: string; score: number }[]
}

const pointDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', year: '2-digit',
})

function scoreSeries(exams: ExamHistoryRow[], forecastSubjects: readonly EgeSubject[]) {
  const series = new Map<string, ScoreSeries>()
  const seen = new Set<string>()
  for (const exam of exams) {
    if (!exam.notified || exam.score == null || seen.has(exam.id)) continue
    seen.add(exam.id)
    const max = exam.max_score && exam.max_score > 0 ? exam.max_score : null
    const key = JSON.stringify([exam.subject, exam.examType, max])
    let group = series.get(key)
    if (!group) {
      group = {
        key, max, examType: exam.examType, subjectCode: exam.subject, results: [],
        subject: exam.subject ? SUBJECT_LABELS[exam.subject] ?? exam.subject : 'Предмет не указан',
      }
      series.set(key, group)
    }
    group.results.push({ startsAt: exam.starts_at, score: exam.score })
  }
  for (const subjectCode of forecastSubjects) {
    if ([...series.values()].some(group => group.subjectCode === subjectCode && group.examType === 'ege')) continue
    const key = JSON.stringify([subjectCode, 'ege', 100])
    series.set(key, { key, subjectCode, subject: SUBJECT_LABELS[subjectCode], examType: 'ege', max: 100, results: [] })
  }
  for (const group of series.values()) {
    group.results.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  }
  return [...series.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'ru'))
}

const tick = { fontSize: 11, fill: 'var(--ink2)' }
const demoForecast = { score: 86, low: 82, high: 90 }

export const MockExamHistoryChart = memo(function MockExamHistoryChart({ exams, forecastSubjects, demo }: {
  exams: ExamHistoryRow[]
  forecastSubjects: readonly EgeSubject[]
  demo: boolean
}) {
  const [selection, setSelection] = useState('')
  const series = useMemo(() => scoreSeries(exams, forecastSubjects), [exams, forecastSubjects])
  const hasForecastSubjects = series.some(group => group.examType === 'ege' && isEgeSubject(group.subjectCode))
  const forecast = useMyForecastRanges(!demo && hasForecastSubjects)

  const current = series.find(group => group.key === selection) ?? series[0]
  const points = current?.results.map(result => ({ label: pointDate.format(new Date(result.startsAt)), value: result.score })) ?? []
  const best = points.length ? Math.max(...points.map(point => point.value)) : null
  const supportsForecast = current?.examType === 'ege' && isEgeSubject(current.subjectCode)
  const projected = demo ? demoForecast : forecast?.find(row => row.subject === current?.subjectCode)
  const estimate = projected?.score ?? null
  const range = projected?.low != null && projected.high != null && projected.low !== projected.high
    ? `${projected.low}–${projected.high}` : null

  return (
    <section className="stu-card grid gap-4 p-4 sm:p-6" aria-labelledby="my-mock-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sticker name="plan-target" size={46} />
          <div className="min-w-0">
            <h2 id="my-mock-history-heading" className="stu-h2">Динамика результатов</h2>
            {series.length === 1 && <p className="stu-muted mt-1 text-sm">{current.subject}</p>}
          </div>
        </div>
        {series.length > 1 && (
          <label className="stu-muted flex min-w-0 max-w-full items-center gap-2 text-sm">
            Предмет
            <select
              value={current.key} onChange={event => setSelection(event.target.value)}
              className="stu-focus min-h-11 min-w-0 max-w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-2 text-sm font-semibold text-[var(--ink)]"
            >
              {series.map(group => (
                <option key={group.key} value={group.key}>
                  {group.subject}
                  {series.some(other => other.key !== group.key && other.subject === group.subject) &&
                    ` · ${[group.examType && (EXAM_LABELS[group.examType] ?? group.examType), group.max ? `из ${group.max}` : 'баллы'].filter(Boolean).join(' · ')}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {current ? (
        <div className="grid min-w-0 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          {points.length ? (
            <div className="min-w-0" role="img" aria-label={`Результаты · ${current.subject}: ${points.map(point => `${point.label}: ${point.value}`).join('; ')}`}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={points} margin={{ top: 21, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis domain={current.max == null ? undefined : [0, current.max]} tick={tick} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
                  <Tooltip cursor={{ fill: 'var(--bg2)' }} contentStyle={{ background: 'var(--card)', borderColor: 'var(--line)', borderRadius: 12 }}
                    labelStyle={{ color: 'var(--ink)' }} />
                  <Bar dataKey="value" name="Баллы" fill="var(--blueInk)" radius={[6, 6, 0, 0]} maxBarSize={52} minPointSize={2} isAnimationActive={false}>
                    {points.length <= 6 && <LabelList dataKey="value" position="top" fill="var(--ink)" fontSize={12} fontWeight={700} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="stu-muted text-sm">По этому предмету пока нет опубликованных результатов.</p>}
          <div className="grid min-w-0 gap-2">
            {best !== null && (
              <div className="flex min-w-0 items-center gap-2 rounded-2xl bg-[var(--bg2)] p-3">
                <Sticker name="mock-crown" size={44} />
                <div className="min-w-0">
                  <p className="stu-muted text-xs font-semibold">Лучший результат</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none" data-testid="mock-history-best">
                    {best}{current.max !== null && <span className="stu-muted text-xs font-semibold"> из {current.max}</span>}
                  </p>
                </div>
              </div>
            )}
            {supportsForecast && (
              <div className="rounded-2xl bg-[var(--blueS)] p-3">
                <p className="text-xs font-semibold text-[var(--blueInk)]">Прогноз ЕГЭ</p>
                <p className="mt-1 text-sm font-semibold" data-testid="mock-history-forecast">
                  {estimate != null ? <><strong className="text-2xl tabular-nums">{estimate}</strong><span className="stu-muted text-xs"> из 100</span></>
                    : forecast === null ? 'Загружаем…' : 'Пока мало данных'}
                </p>
                {estimate != null && range && <p className="stu-muted mt-1 text-xs">Диапазон {range}</p>}
              </div>
            )}
          </div>
        </div>
      ) : <p className="stu-muted text-sm">График появится после публикации первого результата.</p>}
    </section>
  )
})
