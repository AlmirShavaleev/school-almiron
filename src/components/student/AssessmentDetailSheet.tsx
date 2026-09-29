import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { VerdictMark, MARK_OF_REVIEW_VERDICT } from '@/components/ui/VerdictMark'
import { REVIEW_TASK_VERDICT_LABEL } from '@/lib/homeworkReviewTasks'
import type { MockLessonResult } from '@/lib/mockExamLesson'
import {
  formatNumber, marksLine, mskShortDate, prevDelta, scoreTone, summarizeMarks,
  type AssessmentItem, type AssessmentMock, type AssessmentWork, type GroupStats,
} from '@/lib/courseAssessments'

/**
 * §241. Лист подробностей строки раздела «Контрольные, самостоятельные и
 * пробники» — открывается нажатием на строку с результатом.
 *
 * Пробник: вторичный и первичный, части, баллы по номерам (из
 * `my_mock_exam_result` — той же RPC, что у страницы пробника, база отдаёт
 * их только после отправки и конца окна), группа и «+N к прошлому».
 * Работа по времени: оценка, отметки по заданиям (строки таблицы проверки,
 * пришли в разделе — только после вердикта), группа.
 * Внизу — ссылка на саму работу.
 *
 * На телефоне — лист на весь экран с «‹ Назад» (как в макете), на компьютере —
 * окно по центру. Esc и «Назад» закрывают, фокус — на «Назад».
 */
export function AssessmentDetailSheet({ item, groupId, onClose }: {
  item: AssessmentItem
  groupId: string
  onClose: () => void
}) {
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = item.block === 'mock'
    ? `${item.mock.title} · ${mskShortDate(item.mock.starts_at)}`
    : `${item.block === 'check' ? 'Проверочная' : 'Контрольная'} · ${item.work.title}`

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-graphite-950/40 sm:items-center sm:p-6" onClick={onClose} data-testid="assessment-sheet-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="assessment-sheet"
        onClick={e => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden bg-slate-50 sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl sm:shadow-xl"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-3">
          <button
            ref={backRef}
            type="button"
            onClick={onClose}
            data-testid="assessment-sheet-back"
            className="inline-flex min-h-9 shrink-0 items-center gap-0.5 rounded-lg bg-primary-50 px-2.5 text-sm font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <ChevronLeft size={16} aria-hidden />Назад
          </button>
          <p className="min-w-0 truncate text-sm font-bold text-graphite-900">{title}</p>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {item.block === 'mock'
            ? <MockDetails mock={item.mock} groupId={groupId} />
            : <WorkDetails work={item.work} groupId={groupId} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Pair({ items }: { items: { label: string; value: string; caption: string; tone?: string; testid?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(i => (
        <div key={i.label} className="rounded-xl bg-white px-3 py-2.5 text-xs text-graphite-600" data-testid={i.testid}>
          {i.label}
          <b className={cn('block text-[22px] font-extrabold leading-tight text-primary-900 tabular-nums', i.tone)}>{i.value}</b>
          {i.caption}
        </div>
      ))}
    </div>
  )
}

function groupSentence(g: GroupStats | null | undefined, opts: { five?: boolean; mock?: boolean }): string | null {
  if (!g || g.avg == null) return null
  const parts: string[] = []
  parts.push(`${opts.five ? 'средняя оценка' : 'средний'} ${formatNumber(g.avg)}`)
  if (opts.mock && g.count != null) parts.push(`написали ${g.count}`)
  if (!opts.mock && g.submitted != null && g.in_group != null) parts.push(`сдали ${g.submitted} из ${g.in_group}`)
  if (g.best) parts.push('у тебя лучший результат в группе')
  else if (g.better_pct != null && g.better_pct > 0) parts.push(`ты лучше, чем ${g.better_pct} % группы`)
  return parts.join(' · ')
}

const TONE_CLS: Record<string, string> = {
  ok: 'text-verdict-ok-ink',
  part: 'text-verdict-part-ink',
  bad: 'text-verdict-bad-ink',
}

function MockDetails({ mock, groupId }: { mock: AssessmentMock; groupId: string }) {
  const [res, setRes] = useState<MockLessonResult | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.rpc('my_mock_exam_result' as never, { p_mock_exam_id: mock.id } as never)
        if (!cancelled) setRes((data ?? null) as MockLessonResult | null)
      } catch {
        /* подробности необязательны — итог уже есть в строке */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [mock.id])

  const ready = res && res.status === 'ready' ? res : null
  const part1Max = ready ? ready.tasks.filter(t => t.n <= ready.part1_last).reduce((s, t) => s + t.max, 0) : null
  const part2Max = ready ? ready.tasks.filter(t => t.n > ready.part1_last).reduce((s, t) => s + t.max, 0) : null
  const group = groupSentence(mock.group, { mock: true })
  const delta = prevDelta(mock.score, mock.prev_score)

  return (
    <>
      <Pair items={[
        { label: 'Вторичный', value: mock.score != null ? String(mock.score) : '—', caption: mock.max_score != null ? `из ${mock.max_score}` : '', testid: 'sheet-secondary' },
        { label: 'Первичный', value: mock.primary_score != null ? String(mock.primary_score) : '—', caption: mock.primary_max != null ? `из ${mock.primary_max}` : '', testid: 'sheet-primary' },
      ]} />
      {(mock.part1_score != null || mock.part2_score != null) && (
        <Pair items={[
          { label: 'Часть 1', value: mock.part1_score != null ? String(mock.part1_score) : '—', caption: part1Max ? `из ${part1Max}` : '', testid: 'sheet-part1' },
          { label: 'Часть 2', value: mock.part2_score != null ? String(mock.part2_score) : '—', caption: part2Max ? `из ${part2Max}` : '', testid: 'sheet-part2' },
        ]} />
      )}
      {(group || delta) && (
        <p className="rounded-xl bg-white px-3 py-2.5 text-[13px] text-graphite-600" data-testid="sheet-group">
          {group && <><b className="text-graphite-900">Группа:</b> {group}.</>}
          {delta && mock.prev_score != null && mock.score != null && (
            <> Прошлый пробник — {mock.prev_score}, {mock.score === mock.prev_score ? 'сейчас столько же' : `сейчас ${mock.score > mock.prev_score ? '+' : '−'}${Math.abs(mock.score - mock.prev_score)}`}.</>
          )}
        </p>
      )}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-graphite-500"><Loader2 size={14} className="animate-spin" aria-hidden />Баллы по заданиям…</p>
      ) : ready && ready.tasks.length > 0 ? (
        <>
          <p className="text-xs font-semibold text-graphite-600">Баллы по заданиям</p>
          <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-7" data-testid="sheet-mock-tasks">
            {ready.tasks.map(t => {
              const full = t.points != null && t.points >= t.max && t.max > 0
              const zero = t.points === 0
              const cls = t.points == null ? 'bg-slate-100 text-graphite-500'
                : full ? 'bg-verdict-ok-tint text-verdict-ok-ink'
                  : zero ? 'bg-verdict-bad-tint text-verdict-bad-ink'
                    : 'bg-verdict-part-tint text-verdict-part-ink'
              return (
                <li key={t.n} className={cn('rounded-lg py-1 text-center text-[11px] leading-tight', cls)} data-testid="sheet-mock-task">
                  <span className="text-graphite-600">{t.n}</span>
                  <b className="block text-[13px] tabular-nums">{t.points == null ? '—' : t.max > 1 ? `${t.points}/${t.max}` : t.points}</b>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      <Link
        to={`/my-course/${groupId}/mock/${mock.id}`}
        data-testid="sheet-open-work"
        className="mt-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary-50 px-4 text-sm font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        Открыть работу и решение<ArrowRight size={15} aria-hidden />
      </Link>
    </>
  )
}

function WorkDetails({ work, groupId }: { work: AssessmentWork; groupId: string }) {
  const marks = summarizeMarks(work.tasks)
  const five = work.grade_scale === 'five'
  const tone = scoreTone(work.score, work.grade_scale)
  const group = groupSentence(work.group, { five })
  return (
    <>
      <Pair items={[
        {
          label: five ? 'Оценка' : work.grade_scale === 'hundred' ? 'Баллы' : 'Результат',
          value: work.score != null ? String(work.score) : 'проверено',
          caption: five ? 'пятибалльная' : work.grade_scale === 'hundred' ? 'из 100' : '',
          tone: tone ? TONE_CLS[tone] : undefined,
          testid: 'sheet-grade',
        },
        {
          label: 'По заданиям',
          value: marks ? `${marks.correct} из ${marks.total}` : '—',
          caption: marks ? (marks.partial > 0 ? `верно · частично ${marks.partial}` : 'верно') : 'таблицы нет',
          testid: 'sheet-marks',
        },
      ]} />
      {group && (
        <p className="rounded-xl bg-white px-3 py-2.5 text-[13px] text-graphite-600" data-testid="sheet-group">
          <b className="text-graphite-900">Группа:</b> {group}.
        </p>
      )}
      {work.tasks && work.tasks.length > 0 && (
        <>
          <p className="text-xs font-semibold text-graphite-600">По заданиям{marks ? ` — ${marksLine(marks)}` : ''}</p>
          <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-7" data-testid="sheet-work-tasks">
            {work.tasks.map(t => (
              <li key={t.no} className="flex flex-col items-center gap-1 rounded-lg bg-white py-1.5 text-[11px] text-graphite-600" data-testid="sheet-work-task" data-verdict={t.verdict}>
                {t.no}
                <VerdictMark state={MARK_OF_REVIEW_VERDICT[t.verdict]} size={16} label={`№${t.no}: ${REVIEW_TASK_VERDICT_LABEL[t.verdict]}`} />
              </li>
            ))}
          </ul>
        </>
      )}
      <Link
        to={`/my-course/${groupId}/topic/${work.topic_id}`}
        data-testid="sheet-open-work"
        className="mt-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary-50 px-4 text-sm font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        Открыть разбор, решение и критерии<ArrowRight size={15} aria-hidden />
      </Link>
    </>
  )
}
