import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useMyCourseMemberships } from '@/hooks/useMyCourseMemberships'
import { useMyMockExams } from '@/hooks/useMyMockExams'
import { useServerNow } from '@/hooks/useServerNow'
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
interface Row extends MockLessonListRow { group: string; course: string }

export function MyMockExamsPage() {
  const { courses, loading } = useMyCourseMemberships()
  const groups = courses.flatMap(c => c.groups.map(g => ({ id: g.groupId, label: `${c.title} · ${g.groupTitle}` })))
  const byGroup = useMyMockExams(groups.map(g => g.id))
  const rows: Row[] = groups.flatMap(g => (byGroup[g.id] ?? []).map(e => ({ ...e, group: g.id, course: g.label })))
  const now = useServerNow(rows[0]?.server_now ?? null, 1000)
  const items = mockSectionItems(rows, now)
  const sections: { key: 'now' | 'upcoming' | 'past'; title: string }[] = [
    { key: 'now', title: 'Сейчас' },
    { key: 'upcoming', title: 'Скоро' },
    { key: 'past', title: 'Прошедшие' },
  ]
  const loaded = !loading && groups.every(g => byGroup[g.id] !== undefined)

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3.5" data-testid="my-mock-exams">
      <h1 className="px-1 text-2xl font-semibold text-graphite-900">Пробники</h1>
      {!loaded ? (
        <div className="flex h-40 items-center justify-center gap-2 text-graphite-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
      ) : items.length === 0 ? (
        <p className="rounded-[18px] bg-white px-4 py-4 text-[15px] text-graphite-600 shadow-card" data-testid="my-mock-exams-empty">
          Пробников пока нет. Когда преподаватель назначит пробник, он появится здесь и в разделе «Пробники» курса.
        </p>
      ) : sections.map(sec => {
        const list = items.filter(i => i.group === sec.key)
        if (list.length === 0) return null
        return (
          <section key={sec.key} className="flex flex-col gap-2.5" data-testid={`my-mock-${sec.key}`}>
            <h2 className="px-1 text-[13px] font-bold uppercase tracking-[.05em] text-graphite-500">{sec.title}</h2>
            {list.map(item => <Card key={item.exam.id} item={item} now={now} all={rows} />)}
          </section>
        )
      })}
    </div>
  )
}

function Card({ item, now, all }: { item: MockSectionItem<Row>; now: number; all: Row[] }) {
  const e = item.exam
  const to = `/my-course/${e.group}/mock/${e.id}`
  const state = { from: 'my-mock-exams' }
  if (item.group === 'now') {
    const open = item.status === 'open'
    return (
      <div className="flex flex-col gap-2 rounded-[18px] bg-gradient-to-br from-[#2f6bff] to-[#1f55e0] px-4 py-3.5 text-white shadow-card" data-testid="my-mock-card" data-status={item.status}>
        <span className="text-[13px] text-[#d6e2ff]">{e.course} · {open ? `до ${mskTime(e.ends_at)}` : `фото до ${mskTime(e.photos_until)}`}</span>
        <b className="text-[17px]">{e.title}</b>
        {open ? (
          <div className="font-mono text-[34px] font-extrabold leading-none tracking-[-.02em] tabular-nums" data-testid="my-mock-countdown">{formatCountdown(new Date(e.ends_at).getTime() - now)}</div>
        ) : (
          <span className="text-[15px]">{item.status === 'submitted' ? 'Работа сдана — фото второй части можно догрузить.' : 'Время вышло — бланк закрыт, фото ещё можно догрузить.'}</span>
        )}
        <Link to={to} state={state} data-testid="my-mock-open"
          className={cn('mt-1 inline-flex min-h-12 items-center justify-center rounded-full text-[15px] font-bold',
            item.primary ? 'bg-gold-300 text-graphite-900 hover:brightness-105' : 'border-[1.5px] border-white/70 text-white hover:bg-white/10')}
          data-primary={item.primary || undefined}>
          {open ? (e.has_work ? 'Продолжить' : 'Начать') : 'Открыть'}
        </Link>
      </div>
    )
  }
  if (item.group === 'upcoming') {
    const left = new Date(e.starts_at).getTime() - now
    return (
      <Link to={to} state={state} className="flex flex-col gap-1.5 rounded-[18px] bg-white px-4 py-3.5 shadow-card hover:ring-1 hover:ring-primary-200" data-testid="my-mock-card" data-status={item.status}>
        <span className="flex items-center justify-between gap-2">
          <b className="text-[15px] text-graphite-900">{e.title}</b>
          <span className="whitespace-nowrap rounded-full bg-verdict-unk-tint px-2.5 py-[3px] text-xs font-semibold text-verdict-unk-ink">{untilLabel(left)}</span>
        </span>
        <span className="text-[13px] text-graphite-500">{weekdayDay(e.starts_at)}, {mskTime(e.starts_at)}{e.duration_minutes ? ` · ${durationLabel(e.duration_minutes)}` : ''}</span>
        <span className="text-[13px] text-graphite-400">{e.course}</span>
      </Link>
    )
  }
  const delta = deltaToPrevious(all, e.id)
  return (
    <Link to={to} state={state} className="flex flex-col gap-1.5 rounded-[18px] bg-white px-4 py-3.5 shadow-card hover:ring-1 hover:ring-primary-200" data-testid="my-mock-card" data-status={item.status}>
      <span className="flex items-center justify-between gap-2">
        <b className="text-[15px] text-graphite-900">{e.title}</b>
        {e.score != null ? (
          <span className="whitespace-nowrap" data-testid="my-mock-score">
            <b className="text-lg text-graphite-900">{e.score}</b>
            {delta != null && delta !== 0 && <span className={cn('ml-1.5 font-bold', delta > 0 ? 'text-verdict-ok-ink' : 'text-verdict-bad-ink')} data-testid="my-mock-delta">{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span>}
          </span>
        ) : (
          <span className={cn('whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold',
            item.status === 'missed' ? 'bg-verdict-none-tint text-verdict-none-ink' : 'bg-verdict-unk-tint text-verdict-unk-ink')} data-testid="my-mock-pill">
            {item.status === 'missed' ? 'не сдан' : item.status === 'result' ? 'результат' : 'ждёт проверки'}
          </span>
        )}
      </span>
      <span className="text-[13px] text-graphite-500">{mskDayLong(e.starts_at)}{e.score != null && e.max_score ? ` · из ${e.max_score}` : ''}</span>
      <span className="text-[13px] text-graphite-400">{e.course}</span>
    </Link>
  )
}

/** «сб, 10 октября» по Москве. */
function weekdayDay(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short' })
  return `${wd}, ${mskDayLong(iso)}`
}
