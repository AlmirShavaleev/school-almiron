import { Fragment, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { MockExamHistoryChart } from '@/components/student/MockExamHistoryChart'
import { Sticker } from '@/components/student/skin/Sticker'
import { useMyCourseMemberships } from '@/hooks/useMyCourseMemberships'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { useServerNow } from '@/hooks/useServerNow'
import { isEgeSubject, type EgeSubject } from '@/lib/egeScales'
import {
  formatCountdown, mockSectionItems, mskDayLong, mskTime,
  type MockLessonListRow, type MockSectionItem,
} from '@/lib/mockExamLesson'
import { deltaToPrevious, durationLabel, untilLabel } from '@/lib/mockExamV3'
import { cn } from '@/utils/cn'

/**
 * §228. «Пробники» ученика — пункт меню (экран 4 макета): все пробники по
 * всем группам ученика, сверху идущий. Тот же список по одной группе — в
 * разделе «Пробники» внутри курса (§224), он остаётся.
 *
 * Данные — та же `my_mock_exams(группа)` (§221/§224), по вызову на группу:
 * окно, своя сдача, итог — только когда результат уже виден (отправлен и окно
 * закрылось). Время — по часам базы (`server_now`), не телефона. Строка — ссылка
 * на страницу пробника в курсе; «Прошедшие» — итог и разница с прошлым
 * пробником той же группы, если итог виден; иначе «ждёт проверки».
 */
interface Row extends MockLessonListRow {
  group: string
  course: string
  subject: string | null
  examType: string | null
}

export function MyMockExamsPage() {
  const [search] = useSearchParams()
  if (import.meta.env.DEV && search.get('demo') === '1') return <MockExamsDemo />
  return <StudentMockExams />
}

function StudentMockExams() {
  const { courses, loading } = useMyCourseMemberships()
  const groups = useMemo(() => courses.flatMap(course => course.groups.map(group => ({
    id: group.groupId,
    label: [...new Set([course.title, group.groupTitle].filter(Boolean))].join(' · '),
    subject: course.subject,
    examType: course.examType,
  }))), [courses])
  const byGroup = useMyMockExams(groups.map(g => g.id))
  const rows: Row[] = useMemo(() => groups.flatMap(g => (byGroup[g.id] ?? []).map(e => ({
    ...e, group: g.id, course: g.label, subject: g.subject, examType: g.examType,
  }))), [groups, byGroup])
  const forecastSubjects = useMemo(() => [...new Set(
    courses.filter(course => course.examType === 'ege').map(course => course.subject).filter(isEgeSubject),
  )], [courses])
  const now = useServerNow(rows[0]?.server_now ?? null, 1000)
  const loaded = !loading && groups.every(g => byGroup[g.id] !== undefined)
  return <MockExamsContent rows={rows} now={now} loaded={loaded} forecastSubjects={forecastSubjects} />
}

const demoNow = '2026-11-27T12:00:00Z'
const demoRows: Row[] = import.meta.env.DEV ? [
  { day: '2026-11-06', score: 68 },
  { day: '2026-11-20', score: 82 },
].map(({ day, score }, index) => ({
  id: `demo-${index + 1}`, title: `Демо-пробник №${index + 1}`, group: 'demo', course: 'Математика ЕГЭ',
  subject: 'math', examType: 'ege', starts_at: `${day}T08:00:00Z`, ends_at: `${day}T12:00:00Z`,
  photos_until: `${day}T12:15:00Z`, submitted_at: `${day}T11:55:00Z`, has_work: true, notified: true,
  score, max_score: 100, server_now: demoNow,
})) : []
const demoSubjects = ['math'] as const

function MockExamsDemo() {
  return <MockExamsContent rows={demoRows} now={Date.parse(demoNow)} loaded forecastSubjects={demoSubjects} demo />
}

function MockExamsContent({ rows, now, loaded, forecastSubjects, demo = false }: {
  rows: Row[]; now: number; loaded: boolean; forecastSubjects: readonly EgeSubject[]; demo?: boolean
}) {
  const items = mockSectionItems(rows, now)
  const sections: { key: 'now' | 'upcoming' | 'past'; title: string }[] = [
    { key: 'now', title: 'Сейчас' },
    { key: 'upcoming', title: 'Скоро' },
    { key: 'past', title: 'Прошедшие' },
  ]
  const showHistory = items.length > 0 || forecastSubjects.length > 0

  return (
    <div className="mx-auto flex max-w-[1140px] flex-col gap-5 pb-8 sm:gap-6" data-testid="my-mock-exams">
      <header className="flex min-w-0 items-center justify-between gap-4">
        <div>
          <h1 className="stu-h1">Пробники</h1>
          {demo && (
            <p className="stu-muted mt-2 text-sm">
              Демо · пример результатов и прогноза по математике{' '}
              <Link to="/my-mock-exams" className="stu-blue stu-focus underline">К моим результатам</Link>
            </p>
          )}
        </div>
        <Sticker name="plan-rocket" size={68} />
      </header>
      {!loaded ? (
        <div role="status" className="stu-muted flex h-40 items-center justify-center gap-2"><Loader2 size={18} className="animate-spin" aria-hidden />Загрузка…</div>
      ) : !showHistory ? (
        <p className="stu-card stu-muted p-4 text-[15px]" data-testid="my-mock-exams-empty">
          Пробников пока нет. Когда преподаватель назначит пробник, он появится здесь и в разделе «Пробники» курса.
        </p>
      ) : sections.map(sec => {
        const list = items.filter(i => i.group === sec.key)
        return (
          <Fragment key={sec.key}>
            {sec.key === 'past' && <MockExamHistoryChart exams={rows} forecastSubjects={forecastSubjects} demo={demo} />}
            {list.length > 0 && (
              <section className="grid min-w-0 gap-3" aria-labelledby={`my-mock-${sec.key}-heading`} data-testid={`my-mock-${sec.key}`}>
                <h2 id={`my-mock-${sec.key}-heading`} className="stu-h2">{sec.title}</h2>
                <div className="grid min-w-0 gap-3 md:grid-cols-2">
                  {list.map(item => <Card key={item.exam.id} item={item} now={now} all={rows} demo={demo} />)}
                </div>
              </section>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

function Card({ item, now, all, demo }: { item: MockSectionItem<Row>; now: number; all: Row[]; demo: boolean }) {
  const e = item.exam
  const to = `/my-course/${e.group}/mock/${e.id}`
  const state = { from: 'my-mock-exams' }
  if (item.group === 'now') {
    const open = item.status === 'open'
    return (
      <div className="stu-card grid content-start gap-2 p-4 sm:p-5" data-testid="my-mock-card" data-status={item.status}>
        <div className="flex items-center justify-between gap-3">
          <span className="stu-tag t-blue">{open ? 'Идёт' : 'Загрузка фото'}</span>
          <time className="stu-muted text-sm">{open ? `до ${mskTime(e.ends_at)}` : `до ${mskTime(e.photos_until)}`}</time>
        </div>
        <b className="stu-h3 break-words">{e.title}</b>
        <p className="stu-muted text-sm">{e.course}</p>
        {open ? (
          <div className="stu-blue mt-1 text-3xl font-extrabold leading-none tabular-nums" data-testid="my-mock-countdown">{formatCountdown(new Date(e.ends_at).getTime() - now)}</div>
        ) : (
          <span className="text-[15px]">{item.status === 'submitted' ? 'Работа сдана — фото второй части можно догрузить.' : 'Время вышло — бланк закрыт, фото ещё можно догрузить.'}</span>
        )}
        <Link to={to} state={state} data-testid="my-mock-open"
          className={cn('stu-btn mt-2 justify-self-start', item.primary ? 'stu-btn-p' : 'stu-btn-g')}
          data-primary={item.primary || undefined}>
          {open ? (e.has_work ? 'Продолжить' : 'Начать') : 'Открыть'} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    )
  }
  if (item.group === 'upcoming') {
    const left = new Date(e.starts_at).getTime() - now
    return (
      <Link to={to} state={state} className="stu-card stu-focus stu-mock-link grid gap-2 p-4 sm:p-5" data-testid="my-mock-card" data-status={item.status}>
        <span className="flex items-start justify-between gap-3">
          <b className="stu-h3 min-w-0 break-words">{e.title}</b>
          <span className="stu-tag t-or">{untilLabel(left)}</span>
        </span>
        <time dateTime={e.starts_at} className="stu-muted text-sm">{weekdayDay(e.starts_at)}, {mskTime(e.starts_at)}{e.duration_minutes ? ` · ${durationLabel(e.duration_minutes)}` : ''}</time>
        <span className="stu-muted text-sm">{e.course}</span>
      </Link>
    )
  }
  const score = item.status === 'result' ? e.score : null
  const delta = score != null ? deltaToPrevious(all.filter(exam => exam.notified && (exam.max_score ?? null) === (e.max_score ?? null)), e.id) : null
  const result = (
    <>
      <span className="flex min-w-0 items-center justify-between gap-3">
        {score != null ? (
          <>
            <Sticker name="mock-medal" size={48} />
            <span className="text-right tabular-nums" data-testid="my-mock-score">
              <span className="text-2xl font-extrabold">{score}</span>
              {e.max_score ? <span className="stu-muted text-xs"> из {e.max_score}</span> : null}
              {delta != null && delta !== 0 && <span className={cn('ml-2 text-xs font-bold', delta > 0 ? 'text-[var(--greenInk)]' : 'text-[var(--redInk)]')} data-testid="my-mock-delta">{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span>}
            </span>
          </>
        ) : (
          <span className={cn('stu-tag', item.status === 'checking' ? 't-or' : 't-grey')} data-testid="my-mock-pill">
            {item.status === 'missed' ? 'не сдан' : item.status === 'result' ? 'результат' : 'ждёт проверки'}
          </span>
        )}
      </span>
      <span className="grid min-w-0 gap-1">
        <b className="stu-h3 break-words">{e.title}</b>
        <time dateTime={e.starts_at} className="stu-muted text-sm">{mskDayLong(e.starts_at)}</time>
        <span className="stu-muted break-words text-sm">{e.course}</span>
      </span>
    </>
  )
  const className = 'stu-card grid content-start gap-3 p-4 sm:p-5'
  return demo
    ? <article className={className} data-testid="my-mock-card" data-status={item.status}>{result}</article>
    : <Link to={to} state={state} className={cn(className, 'stu-focus stu-mock-link')} data-testid="my-mock-card" data-status={item.status}>{result}</Link>
}

/** «сб, 10 октября» по Москве. */
function weekdayDay(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short' })
  return `${wd}, ${mskDayLong(iso)}`
}
