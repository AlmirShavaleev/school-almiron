import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useCourseSummary } from '@/hooks/useCourseSummary'
import { ZONE_LABEL, type CatalogZone } from '@/lib/catalogRewards'
import {
  defaultDir, deltaText, formatAvgGrade, saggedReason, seenText, sortStudents, streakText, studentsWord, summaryHeader,
  type CourseSummary, type SortDir, type SummaryMark, type SummarySortKey, type SummaryStudent,
} from '@/lib/courseSummary'

/**
 * §264. Вкладка курса «Сводка» (макет §264, экран Г): шапка с четырьмя метками (прогноз ср., ДЗ вовремя, проверочные
 * ср., «просели за неделю») и таблица учеников с сортировкой по колонкам; строка ведёт в карточку ученика (§261).
 *
 * Данные — один вызов `course_summary_for_staff`; всё, что считается, — `lib/courseSummary.ts` теми же правилами, что
 * карточка ученика: прогноз — модель §255 и её правило показа, «вовремя» — §259, оценки — §261.
 */
export function CourseSummaryTab({ courseId }: { courseId: string }) {
  const { data, loading, error, reload } = useCourseSummary(courseId)

  if (!data) {
    return (
      <section data-testid="course-summary" aria-busy={loading} className="platform-surface rounded-card p-4 sm:p-5">
        {error && !loading ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500">
            <span data-testid="course-summary-error">Не удалось загрузить сводку класса.</span>
            <button type="button" onClick={reload} className="font-semibold text-primary-700 hover:underline">Повторить</button>
          </div>
        ) : (
          <div className="h-28 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
        )}
      </section>
    )
  }
  return <CourseSummaryBody data={data} />
}

const COLUMNS: { key: SummarySortKey; label: string; hint?: string }[] = [
  { key: 'name', label: 'Ученик' },
  { key: 'forecast', label: 'Прогноз ЕГЭ' },
  { key: 'delta', label: 'за 30 дн.' },
  { key: 'assessments', label: 'Проверочные', hint: 'последние три' },
  { key: 'homework', label: 'ДЗ вовремя' },
  { key: 'catalog', label: 'Каталог 7 дн.', hint: 'верно решено с проверкой' },
  { key: 'streak', label: 'Серия' },
  { key: 'weak', label: 'Слабые номера' },
  { key: 'seen', label: 'Был' },
]

export function CourseSummaryBody({ data }: { data: CourseSummary }) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ key: SummarySortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })
  const [onlySagged, setOnlySagged] = useState(false)
  const head = useMemo(() => summaryHeader(data.students), [data])
  const rows = useMemo(() => {
    const list = onlySagged ? data.students.filter(s => s.sagged) : data.students
    return sortStudents(list, sort.key, sort.dir)
  }, [data, sort, onlySagged])

  const onSort = (key: SummarySortKey) =>
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) }))

  return (
    <section data-testid="course-summary" className="flex flex-col gap-3.5">
      <div className="platform-surface flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-card p-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[19px] font-extrabold leading-tight text-graphite-950">Сводка класса · {data.courseTitle}</h2>
          <div className="text-sm text-graphite-500">{studentsWord(data.students.length)} · за 30 дней</div>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="course-summary-chips">
          {data.forecastEnabled && (
            <Chip tone="acc" testId="summary-chip-forecast" title={head.forecastCount ? `по ${studentsWord(head.forecastCount)} с прогнозом` : 'ни у кого пока не хватает данных'}>
              прогноз ср. {head.forecastAvg ?? '—'}
            </Chip>
          )}
          <Chip tone="ok" testId="summary-chip-homework" title="сдано в срок из ДЗ, срок которых прошёл">
            ДЗ вовремя {head.hwOnTimePct != null ? `${head.hwOnTimePct} %` : '—'}
          </Chip>
          <Chip tone="gold" testId="summary-chip-assessments">проверочные ср. {formatAvgGrade(head.assessAvg)}</Chip>
          <button
            type="button"
            data-testid="summary-chip-sagged"
            aria-pressed={onlySagged}
            onClick={() => setOnlySagged(v => !v)}
            disabled={head.sagged === 0 && !onlySagged}
            title={onlySagged ? 'Показать всех' : 'Показать только просевших'}
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold transition-shadow',
              'bg-verdict-bad-tint text-verdict-bad-ink disabled:cursor-default',
              onlySagged && 'ring-2 ring-verdict-bad',
            )}
          >
            просели за неделю · {head.sagged}
          </button>
        </div>
      </div>

      <div className="platform-surface overflow-hidden rounded-card">
        {data.students.length === 0 ? (
          <p className="m-0 p-4 text-sm text-graphite-500">В курсе пока нет учеников.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm tabular-nums" data-testid="course-summary-table">
              <thead>
                <tr>
                  {COLUMNS.map(c => {
                    const active = sort.key === c.key
                    if (c.key === 'forecast' && !data.forecastEnabled) return null
                    if (c.key === 'delta' && !data.forecastEnabled) return null
                    if (c.key === 'weak' && !data.forecastEnabled) return null
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className="bg-graphite-50 px-3 py-2 text-left text-[11.5px] font-semibold text-graphite-400"
                      >
                        <button
                          type="button"
                          data-testid={`summary-sort-${c.key}`}
                          onClick={() => onSort(c.key)}
                          title={c.hint}
                          className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-graphite-700', active && 'text-graphite-800')}
                        >
                          {c.label}
                          {active && (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <Row key={s.studentId} s={s} data={data} onOpen={() => navigate(`/students/${s.studentId}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="m-0 text-[12.5px] text-graphite-500">
        «Просели за неделю» — прогноз ниже, чем 7 дней назад, или за 7 дней ни одной сдачи и решения. Строка открывает
        карточку ученика.
      </p>
    </section>
  )
}

function Row({ s, data, onOpen }: { s: SummaryStudent; data: CourseSummary; onOpen: () => void }) {
  const f = s.forecast
  return (
    <tr
      data-testid="summary-row"
      data-student={s.studentId}
      data-sagged={s.sagged ? 'true' : 'false'}
      onClick={onOpen}
      className="cursor-pointer hover:bg-primary-50/50"
    >
      <Td className="min-w-[10rem]">
        <Link
          to={`/students/${s.studentId}`}
          onClick={e => e.stopPropagation()}
          className="font-semibold text-graphite-900 hover:text-primary-700 hover:underline"
        >
          {s.name}
        </Link>
        {s.sagged && (
          <span
            data-testid="summary-sagged-mark"
            title={saggedReason(s)}
            className="ml-1.5 inline-flex rounded-full bg-verdict-bad-tint px-1.5 py-px align-middle text-[10.5px] font-bold text-verdict-bad-ink"
          >
            просел
          </span>
        )}
      </Td>
      {data.forecastEnabled && (
        <Td>
          {f.kind === 'ready'
            ? <span className="font-bold text-graphite-950">{f.score}</span>
            : <span className="whitespace-nowrap text-graphite-400">{f.kind === 'few' ? 'мало данных' : '—'}</span>}
        </Td>
      )}
      {data.forecastEnabled && (
        <Td>
          {f.kind === 'ready' && f.monthDelta != null ? (
            <span className={cn('font-bold', f.monthDelta > 0 ? 'text-verdict-ok-ink' : f.monthDelta < 0 ? 'text-verdict-bad-ink' : 'text-graphite-500')}>
              {deltaText(f.monthDelta)}
            </span>
          ) : <span className="text-graphite-400">—</span>}
        </Td>
      )}
      <Td>
        {s.marks.length === 0 ? <span className="text-graphite-400">—</span>
          : s.marks.every(m => m.tone === 'missed') ? <span className="whitespace-nowrap text-graphite-400">не писал</span>
            : <span className="inline-flex items-center gap-1">{s.marks.map((m, i) => <Mark key={i} m={m} />)}</span>}
      </Td>
      <Td className="whitespace-nowrap">
        {s.hwTotal > 0 ? <span className={cn(s.hwOnTime / s.hwTotal < 0.5 && 'font-bold text-verdict-bad-ink')}>{s.hwOnTime} / {s.hwTotal}</span>
          : <span className="text-graphite-400">—</span>}
      </Td>
      <Td>
        <span title={`за 7 дней: решено ${s.catalogTried}, верно ${s.catalogCorrect}`} className={cn(s.catalogCorrect === 0 && 'text-graphite-400')}>
          {s.catalogCorrect}
        </span>
      </Td>
      <Td className="whitespace-nowrap">
        <span className={cn(s.streak === 0 && 'text-graphite-400')}>{streakText(s.streak)}</span>
      </Td>
      {data.forecastEnabled && (
        <Td>
          {s.weak.length === 0 ? <span className="text-graphite-400">—</span> : (
            <span className="inline-flex gap-1 whitespace-nowrap">
              {s.weak.map(w => (
                <span
                  key={w.n}
                  data-testid="summary-weak"
                  data-zone={w.zone}
                  title={`№${w.n}${w.title ? ` «${w.title}»` : ''}: ${ZONE_LABEL[w.zone]}, верно ${Math.round(w.share * 100)} %`}
                  className={cn('inline-block min-w-[30px] rounded-md px-1 py-0.5 text-center text-xs font-extrabold', ZONE_TONE[w.zone])}
                >
                  {w.n}
                </span>
              ))}
            </span>
          )}
        </Td>
      )}
      <Td className="whitespace-nowrap">
        <span className={cn(s.lastSeen == null && 'text-graphite-400')}>{seenText(s.lastSeen, data.today)}</span>
      </Td>
    </tr>
  )
}

const ZONE_TONE: Record<CatalogZone, string> = {
  growth: 'bg-verdict-bad-tint text-verdict-bad-ink',
  progress: 'bg-verdict-part-tint text-verdict-part-ink',
  confident: 'bg-verdict-ok-tint text-verdict-ok-ink',
}

const MARK_TONE: Record<SummaryMark['tone'], string> = {
  five: 'bg-verdict-ok-tint text-verdict-ok-ink',
  four: 'bg-primary-50 text-primary-700',
  three: 'bg-verdict-part-tint text-verdict-part-ink',
  two: 'bg-verdict-bad-tint text-verdict-bad-ink',
  hundred: 'bg-graphite-100 text-graphite-700',
  wait: 'bg-graphite-100 text-graphite-500 font-semibold text-[11px]',
  missed: 'bg-verdict-none-tint text-verdict-none-ink',
}

function Mark({ m }: { m: SummaryMark }) {
  return (
    <span title={m.title} className={cn('inline-grid h-[24px] min-w-[24px] place-items-center rounded-lg px-1 font-extrabold', MARK_TONE[m.tone])}>
      {m.text}
    </span>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('border-t border-graphite-100 px-3 py-2 align-middle text-graphite-800', className)}>{children}</td>
}

function Chip({ tone, testId, title, children }: { tone: 'acc' | 'ok' | 'gold'; testId: string; title?: string; children: React.ReactNode }) {
  const cls = tone === 'acc' ? 'bg-primary-50 text-primary-700' : tone === 'ok' ? 'bg-verdict-ok-tint text-verdict-ok-ink' : 'bg-gold-50 text-gold-700'
  return (
    <span data-testid={testId} title={title} className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', cls)}>
      {children}
    </span>
  )
}
