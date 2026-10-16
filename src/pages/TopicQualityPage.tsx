import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronRight, Download, Loader2, Star } from 'lucide-react'
import { useCourseProgram, type Module } from '@/hooks/useCourseProgram'
import { fetchTopicRatingsSummary, formatTopicRatingAvg, type TopicRatingSummary } from '@/lib/topicRatings'
import {
  buildQualityRows, feedbackCsv, fetchCourseFeedback, sortByProblem,
  type FeedbackRow, type QualityRow,
} from '@/lib/topicFeedback'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * «Качество уроков» — какой материал в теме плохой (письмо
 * ЛК_стиль_урок_опрос_качества.md, 16.10).
 *
 * По каждой теме курса: средняя оценка 1–10 (§271) и ответы опроса — %
 * «понятно частично или нет», сложность задач урока, % «решил сам меньше
 * половины ДЗ», частые «где трудно» с номерами задач, найденные ошибки (со
 * ссылкой на ученика) и пожелания. Худшие темы сверху. CSV — для методиста.
 *
 * Курсы — как в «Оценках уроков»: по каркасам («общая копилка» §276), если их
 * не видно — свои курсы. Ответы отдаёт `topic_feedback_for_course` — только
 * персоналу курса.
 */
export function TopicQualityPage() {
  const { courses, loading: coursesLoading, loadModules } = useCourseProgram()
  const [params, setParams] = useSearchParams()
  const [expanded, setExpanded] = useState<string | null>(null)

  const orderedCourses = useMemo(() => {
    const templates = courses.filter(c => c.is_template)
    return templates.length > 0 ? templates : courses
  }, [courses])
  const requested = params.get('course')
  const courseId = orderedCourses.some(c => c.id === requested) ? requested : orderedCourses[0]?.id ?? null
  const course = orderedCourses.find(c => c.id === courseId) ?? null

  const loadModulesRef = useRef(loadModules)
  useEffect(() => { loadModulesRef.current = loadModules })

  const [data, setData] = useState<{
    courseId: string; modules: Module[]; feedback: FeedbackRow[]; ratings: TopicRatingSummary[]; error: string | null
  } | null>(null)

  useEffect(() => {
    if (!courseId) return
    let cancelled = false
    Promise.all([
      loadModulesRef.current(courseId).catch(() => null),
      fetchCourseFeedback(courseId),
      fetchTopicRatingsSummary(courseId),
    ]).then(([modules, feedback, ratings]) => {
      if (cancelled) return
      setData({
        courseId,
        modules: modules ?? [],
        feedback: feedback.rows,
        ratings: ratings.rows,
        error: modules == null ? 'Не удалось загрузить программу курса' : feedback.error,
      })
    })
    return () => { cancelled = true }
  }, [courseId])

  const loading = coursesLoading || (!!courseId && data?.courseId !== courseId)
  const current = data && data.courseId === courseId ? data : null
  const rows = useMemo(
    () => current ? sortByProblem(buildQualityRows(current.modules, current.feedback, current.ratings)) : [],
    [current],
  )
  const answered = rows.filter(r => r.answers > 0).length
  const totalAnswers = current?.feedback.length ?? 0

  function downloadCsv() {
    if (!current) return
    const topics = new Map(current.modules.flatMap(m => m.topics.map(t => [t.id, { title: t.title, moduleTitle: m.title }] as const)))
    const blob = new Blob([feedbackCsv(current.feedback, topics)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `опрос-уроков-${(course?.title ?? 'курс').replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-6xl space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Качество уроков</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ответы учеников на опрос по уроку и оценки 1–10. Сверху — темы, где больше всего проблем: непонятно,
          ДЗ не решают сами, задачи слишком сложные, низкая оценка, найдены ошибки.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 sm:w-80">
          <span className="mb-1 block text-xs font-medium text-gray-500">Курс</span>
          <select
            data-testid="topic-quality-course"
            value={courseId ?? ''}
            disabled={coursesLoading || orderedCourses.length === 0}
            onChange={e => {
              setExpanded(null)
              setParams(prev => { const next = new URLSearchParams(prev); next.set('course', e.target.value); return next }, { replace: true })
            }}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            {orderedCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={!current || totalAnswers === 0}
          data-testid="topic-quality-csv"
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:self-auto"
        >
          <Download size={15} aria-hidden />Выгрузить CSV
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />Загрузка…
        </div>
      ) : !courseId ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">Нет курсов, к которым у вас есть доступ</div>
      ) : current?.error ? (
        <div data-testid="topic-quality-error" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />{current.error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">В курсе пока нет уроков</div>
      ) : (
        <>
          <p data-testid="topic-quality-stats" className="text-sm text-gray-600">
            {totalAnswers} {plural(totalAnswers, 'ответ', 'ответа', 'ответов')} · опрос прошли по {answered} из {rows.length} {plural(rows.length, 'урока', 'уроков', 'уроков')}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500">
                  <th className="px-4 py-2.5 text-left font-medium">Урок</th>
                  <th className="w-24 px-3 py-2.5 text-center font-medium">Оценка</th>
                  <th className="w-20 px-3 py-2.5 text-center font-medium">Ответов</th>
                  <th className="w-24 px-3 py-2.5 text-center font-medium">Непонятно</th>
                  <th className="w-36 px-3 py-2.5 text-center font-medium">Задачи урока</th>
                  <th className="w-28 px-3 py-2.5 text-center font-medium">ДЗ сам &lt; ½</th>
                  <th className="px-3 py-2.5 text-left font-medium">Где трудно</th>
                  <th className="w-20 px-3 py-2.5 text-center font-medium">Ошибки</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <QualityRowView key={row.topicId} row={row} open={expanded === row.topicId}
                    onToggle={() => setExpanded(e => e === row.topicId ? null : row.topicId)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const bad = (pct: number | null) => pct != null && pct >= 40

function QualityRowView({ row, open, onToggle }: { row: QualityRow; open: boolean; onToggle: () => void }) {
  const has = row.answers > 0
  const details = row.errors.length > 0 || row.wishes.length > 0
  const diffTotal = row.difficulty.easy + row.difficulty.ok + row.difficulty.hard
  return (
    <Fragment>
      <tr data-testid="topic-quality-row" data-topic-id={row.topicId} className={cn('border-b border-gray-100 align-top last:border-0', row.score >= 60 && 'bg-red-50/50')}>
        <td className="px-4 py-2.5">
          <button type="button" onClick={onToggle} disabled={!details} aria-expanded={open} className="group flex w-full items-start gap-1.5 text-left disabled:cursor-default">
            {details
              ? open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-gray-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-gray-400" />
              : <span className="w-[14px] shrink-0" />}
            <span className="min-w-0">
              <span className={cn('block font-medium', has ? 'text-gray-900 group-hover:text-primary-700' : 'text-gray-600')}>{row.title}</span>
              <span className="block text-xs text-gray-400">{row.moduleTitle}</span>
            </span>
          </button>
        </td>
        <td className="px-3 py-2.5 text-center">
          {row.avgRating != null ? (
            <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
              <Star size={12} aria-hidden className="fill-amber-400 text-amber-400" />{formatTopicRatingAvg(row.avgRating)}
              <span className="text-xs font-normal text-gray-400">({row.ratings})</span>
            </span>
          ) : <span className="text-xs text-gray-400">—</span>}
        </td>
        <td className="px-3 py-2.5 text-center tabular-nums text-gray-700">{has ? row.answers : '—'}</td>
        <td className={cn('px-3 py-2.5 text-center tabular-nums', bad(row.unclearPct) ? 'font-semibold text-red-700' : 'text-gray-700')} data-testid="topic-quality-unclear">
          {row.unclearPct != null ? `${row.unclearPct} %` : '—'}
        </td>
        <td className="px-3 py-2.5">
          {diffTotal > 0 ? (
            <div className="mx-auto w-32" aria-label={`Легко ${row.difficulty.easy}, в самый раз ${row.difficulty.ok}, сложно ${row.difficulty.hard}`}>
              <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
                <span className="bg-sky-300" style={{ width: `${(row.difficulty.easy / diffTotal) * 100}%` }} />
                <span className="bg-emerald-400" style={{ width: `${(row.difficulty.ok / diffTotal) * 100}%` }} />
                <span className="bg-red-400" style={{ width: `${(row.difficulty.hard / diffTotal) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] tabular-nums text-gray-500">
                <span>лег {row.difficulty.easy}</span><span>ок {row.difficulty.ok}</span><span>слож {row.difficulty.hard}</span>
              </div>
            </div>
          ) : <span className="block text-center text-xs text-gray-400">—</span>}
        </td>
        <td className={cn('px-3 py-2.5 text-center tabular-nums', bad(row.hwLowPct) ? 'font-semibold text-red-700' : 'text-gray-700')} data-testid="topic-quality-hwlow">
          {row.hwLowPct != null ? `${row.hwLowPct} %` : '—'}
        </td>
        <td className="px-3 py-2.5 text-xs text-gray-700" data-testid="topic-quality-hard">
          {row.hardTop.length > 0 ? row.hardTop.map(h => `${h.label} (${h.n})`).join(', ') : <span className="text-gray-400">—</span>}
        </td>
        <td className={cn('px-3 py-2.5 text-center tabular-nums', row.errors.length > 0 ? 'font-semibold text-red-700' : 'text-gray-400')}>
          {row.errors.length || '—'}
        </td>
      </tr>
      {open && details && (
        <tr data-testid="topic-quality-details" className="border-b border-gray-100 bg-gray-50/60">
          <td colSpan={8} className="space-y-3 px-4 py-3 text-sm">
            {row.errors.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Найденные ошибки</p>
                <ul className="space-y-1">
                  {row.errors.map((e, i) => (
                    <li key={i} className="text-gray-800">
                      <span className="font-medium">{[e.where, e.task && `№ ${e.task}`].filter(Boolean).join(', ') || 'Ошибка'}</span>
                      {e.text && <> — {e.text}</>}
                      {' · '}
                      {e.studentId ? <Link to={`/students/${e.studentId}`} className="text-primary-700 hover:underline">{e.studentName}</Link> : e.studentName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {row.wishes.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Что улучшить</p>
                <ul className="space-y-1">
                  {row.wishes.map((w, i) => <li key={i} className="text-gray-800">«{w.text}» <span className="text-gray-400">— {w.studentName}</span></li>)}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}
