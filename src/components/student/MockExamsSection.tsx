import { useEffect, useState } from 'react'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  clockOffset, mockSectionItems, mskDayLong, mskTime,
  type MockLessonListRow, type MockLessonStatus, type MockSectionItem,
} from '@/lib/mockExamLesson'
import { formatSpan } from '@/lib/mockExamLive'

/**
 * §224. Раздел «Пробники» в программе курса ученика — над разделами курса.
 * Это не строка `modules`: список приходит одной RPC `my_mock_exams(группа)`,
 * в базе для раздела ничего не заводится. У каждой группы он свой.
 *
 * Порядок: идёт сейчас → ближайшие → прошедшие. У идущего — главная кнопка
 * экрана («Начать» / «Продолжить»), одна; у ближайшего — дата, время,
 * длительность и отсчёт, если меньше суток; у прошедшего — «ждёт проверки»
 * или итог (итог приходит только после конца окна, как в §221). Время — по
 * часам базы (`server_now`), не телефона.
 *
 * Раздела нет вовсе, если у группы нет пробников со временем.
 */
export function MockExamsSection({ exams, onOpen }: {
  exams: MockLessonListRow[]
  onOpen: (examId: string) => void
}) {
  const now = useServerTicker(exams[0]?.server_now ?? null)
  if (exams.length === 0) return null
  const items = mockSectionItems(exams, now)
  return (
    <section data-testid="mock-exams-section" aria-labelledby="mock-exams-title">
      <h2 id="mock-exams-title" className="mb-2 flex items-center gap-2 text-base font-bold text-gray-900">
        <ClipboardCheck size={17} className="text-primary-600" aria-hidden />Пробники
      </h2>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {items.map(item => <MockRow key={item.exam.id} item={item} now={now} onOpen={() => onOpen(item.exam.id)} />)}
      </div>
    </section>
  )
}

function MockRow({ item, now, onOpen }: { item: MockSectionItem<MockLessonListRow>; now: number; onOpen: () => void }) {
  const { exam, status, group, primary } = item
  const line = rowLine(exam, status, now)
  const tone = TONE[status]
  const action = actionLabel(exam, status)
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', group === 'now' && 'bg-primary-50/50', group === 'now' && 'border-l-[3px] border-l-primary-600')}
      data-testid="mock-section-row"
      data-status={status}
      data-group={group}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-graphite-900">{exam.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-graphite-600">
          <span className={cn('whitespace-nowrap rounded px-1.5 py-px font-medium', tone)} data-testid="mock-section-status">{STATUS_WORD[status]}</span>
          <span data-testid="mock-section-line">{line}</span>
        </p>
      </div>
      {primary ? (
        <button
          type="button"
          onClick={onOpen}
          data-testid="mock-section-primary"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 sm:w-auto"
        >
          {action}<ChevronRight size={16} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          data-testid="mock-section-open"
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 sm:min-h-0 sm:py-1"
        >
          {action}<ChevronRight size={15} aria-hidden />
        </button>
      )}
    </div>
  )
}

const STATUS_WORD: Record<MockLessonStatus, string> = {
  upcoming: 'скоро',
  open: 'идёт',
  submitted: 'сдан',
  time_up: 'время вышло',
  checking: 'ждёт проверки',
  missed: 'не сдан',
  result: 'итог',
}

const TONE: Record<MockLessonStatus, string> = {
  upcoming: 'bg-slate-100 text-graphite-700',
  open: 'bg-primary-600 text-white',
  submitted: 'bg-emerald-50 text-emerald-800',
  time_up: 'bg-amber-50 text-amber-900',
  checking: 'bg-slate-100 text-graphite-700',
  missed: 'bg-red-50 text-red-800',
  result: 'bg-emerald-100 text-emerald-900',
}

function ms(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : NaN
}

function hoursLabel(mins: number | undefined, startsAt: string, endsAt: string): string {
  const m = mins ?? Math.round((ms(endsAt) - ms(startsAt)) / 60000)
  if (!Number.isFinite(m) || m <= 0) return ''
  const h = Math.floor(m / 60)
  const r = m % 60
  return h === 0 ? `${r} мин` : r === 0 ? `${h} ч` : `${h} ч ${r} мин`
}

/** Подробности строки словами — у каждого состояния своё. */
function rowLine(e: MockLessonListRow, st: MockLessonStatus, now: number): string {
  switch (st) {
    case 'open':
      return `осталось ${formatSpan(ms(e.ends_at) - now)} · до ${mskTime(e.ends_at)}`
    case 'submitted':
      return `фото второй части можно догрузить до ${mskTime(e.photos_until)}`
    case 'time_up':
      return `бланк закрыт · фото — до ${mskTime(e.photos_until)}`
    case 'upcoming': {
      const left = ms(e.starts_at) - now
      const dur = hoursLabel(e.duration_minutes, e.starts_at, e.ends_at)
      const when = `${mskDayLong(e.starts_at)}, ${mskTime(e.starts_at)}${dur ? ` · ${dur}` : ''}`
      return left < 24 * 3600_000 ? `${when} · через ${formatSpan(left)}` : when
    }
    case 'checking':
      return `${mskDayLong(e.starts_at)} · работа у преподавателя`
    case 'missed':
      return `${mskDayLong(e.starts_at)} · работы нет`
    case 'result':
      return e.score != null
        ? `${e.score}${e.max_score != null ? ` из ${e.max_score}` : ''} · ${mskDayLong(e.starts_at)}`
        : mskDayLong(e.starts_at)
  }
}

function actionLabel(e: MockLessonListRow, st: MockLessonStatus): string {
  switch (st) {
    case 'open': return e.has_work ? 'Продолжить' : 'Начать'
    case 'submitted':
    case 'time_up': return 'Догрузить фото'
    case 'result': return 'Разбор'
    default: return 'Открыть'
  }
}

/** «Сейчас» по часам базы, раз в 30 секунд — разделу хватает минут. */
function useServerTicker(serverNow: string | null): number {
  const [offset] = useState(() => (serverNow ? clockOffset(serverNow, Date.now()) : 0))
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 30_000)
    return () => clearInterval(id)
  }, [offset])
  return now
}
