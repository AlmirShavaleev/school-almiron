import { useId, useState } from 'react'
import type { QueueRow } from '@/lib/homeworkQueue'
import type { TopicHomeworkReviewRow } from '@/lib/topicHomework'
import { homeworkChartData } from '@/lib/studentHomeworkCharts'
import { SUBJECT_LABELS } from '@/utils/format'
import '@/components/charts/schoolCharts.css'

const labels: Record<string, string> = { accepted: 'Принято', submitted: 'На проверке', returned_for_revision: 'На доработке' }
export function StudentHomeworkCharts({ works, reviews }: { works: QueueRow[]; reviews: TopicHomeworkReviewRow[] }) {
  const [days, setDays] = useState(30)
  const [subject, setSubject] = useState('all')
  const [scale, setScale] = useState('hundred')
  const id = useId().replace(/:/g, '')
  const subjects = [...new Set(works.map(w => w.subject).filter((s): s is string => !!s))]
  const data = homeworkChartData(works, reviews, days, subject)
  const available = [...new Set(data.points.map(p => p.scale))]
  const chosen = available.includes(scale as 'five' | 'hundred') ? scale : available[0]
  const points = data.points.filter(p => p.scale === chosen)
  const max = chosen === 'five' ? 5 : 100
  const date = (at: string) => new Date(at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })
  const xy = points.map((p, i) => ({ ...p, x: 40 + (points.length === 1 ? .5 : i / (points.length - 1)) * 520, y: 170 - p.score / max * 140 }))
  return <section className="space-y-4" aria-label="Динамика домашних работ">
    <div className="flex flex-wrap gap-3 items-center">
      <h3 className="font-semibold mr-auto">Динамика ДЗ</h3>
      <label className="text-sm">Период <select className="rounded-lg border p-2" value={days} onChange={e => setDays(Number(e.target.value))}><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={0}>Всё время</option></select></label>
      <label className="text-sm">Предмет <select className="rounded-lg border p-2" value={subject} onChange={e => setSubject(e.target.value)}><option value="all">Все предметы</option>{subjects.map(s => <option key={s} value={s}>{SUBJECT_LABELS[s] ?? s}</option>)}</select></label>
    </div>
    <div className="rounded-2xl bg-blue-50 p-4">
      <h4 className="font-semibold mb-2">На что обратить внимание</h4>
      {data.notices.length ? <ul className="list-disc pl-5 text-sm space-y-1">{data.notices.map(n => <li key={n}>{n}</li>)}</ul> : <p className="text-sm">В выбранных работах нет ожидания проверки или доработки. Это не оценка освоения всего курса.</p>}
    </div>
    <div className="school-chart-card">
      <div className="flex flex-wrap justify-between gap-2">
        <h4 className="font-semibold">Результаты принятых ДЗ</h4>
        {available.length > 1 && <label>Шкала <select value={chosen} onChange={e => setScale(e.target.value)}><option value="hundred">100 баллов</option><option value="five">5 баллов</option></select></label>}
      </div>
      <p className="text-xs text-gray-500 my-2">По дате последней сдачи, слева направо. Шкалы 5 и 100 баллов считаются отдельно. Точка открывает работу.</p>
      {!points.length ? <p className="py-8 text-sm text-gray-500">За этот период нет принятых ДЗ с оценками.</p> : <>
        <svg viewBox="0 0 600 205" className="w-full" aria-label={`Оценки из ${max} баллов`}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#315af4" stopOpacity=".23" /><stop offset="1" stopColor="#315af4" stopOpacity="0" /></linearGradient></defs>
          {[0, max / 2, max].map(v => <g key={v}><line x1="40" x2="570" y1={170-v/max*140} y2={170-v/max*140} stroke="#e8edf8" /><text x="5" y={175-v/max*140} fontSize="12" fill="#64748b">{v}</text></g>)}
          {xy.length > 1 && <><path d={`M40 170 L${xy.map(p => `${p.x} ${p.y}`).join(' L')} L560 170 Z`} fill={`url(#${id})`} /><polyline points={xy.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#315af4" strokeWidth="3" /></>}
          {xy.map(p => <a key={p.id} href={`/homework-queue?attempt=${encodeURIComponent(p.id)}`} aria-label={`${p.title}: ${p.score} из ${max}, ${date(p.at)}`}><title>{p.title}: {p.score} из {max} · {date(p.at)}</title><circle cx={p.x} cy={p.y} r="9" fill="transparent" /><circle cx={p.x} cy={p.y} r="4" fill="#315af4" /></a>)}
          <text x="40" y="198" fontSize="12" fill="#64748b">{date(points[0].at)}</text><text x="560" y="198" textAnchor="end" fontSize="12" fill="#64748b">{date(points[points.length-1].at)}</text>
        </svg>
        {points.length === 1 && <p className="text-sm text-gray-500">Пока одна оценка — динамика ещё не определена.</p>}
        <details className="mt-2"><summary className="cursor-pointer text-sm text-primary-600">Все точки: {points.length}</summary><ul className="max-h-60 overflow-auto text-sm space-y-2 mt-2">{points.map(p => <li key={p.id}><a className="text-primary-600 underline" href={`/homework-queue?attempt=${encodeURIComponent(p.id)}`}>{date(p.at)} · {p.title} · {p.score}/{p.max}</a></li>)}</ul></details>
      </>}
    </div>
    <div className="school-chart-card">
      <h4 className="font-semibold">Статусы сданных ДЗ</h4>
      <p className="text-xs text-gray-500 mt-1 mb-3">Каждая работа учитывается один раз, по последней сданной попытке в периоде. Несданные задания сюда не входят.</p>
      {data.counts.map((c, i) => <div key={c.status} className="mb-3"><div className="flex justify-between text-sm"><span>{labels[c.status]}</span><b>{c.count}</b></div><div className="h-2 rounded-full bg-slate-100 mt-1"><div className="h-2 rounded-full" style={{ width: `${data.rows.length ? c.count / data.rows.length * 100 : 0}%`, background: ['#315af4', '#f28c28', '#e6aa20'][i] }} /></div></div>)}
      {!data.rows.length && <p className="text-sm text-gray-500">В выбранном периоде сданных работ нет.</p>}
    </div>
  </section>
}
