import { useMemo, useState } from 'react'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS } from '@/utils/format'
import { shortDay } from '@/lib/studentHome'
import { ZONE_LABEL, type CatalogZone } from '@/lib/catalogRewards'
import type { DeadlineTone } from '@/lib/homeworkDeadline'
import { useStudentOverview } from '@/hooks/useStudentOverview'
import {
  DASH, activityCells, bySubject, defaultSubjectKey, formatGrade, overviewTiles, pointsLabel, recentHomeworks,
  subjectKey, zoneCells, zoneLegend, assessmentSummary,
  type AssessmentRow, type OverviewTile, type StudentOverview as Overview,
} from '@/lib/studentOverview'

/**
 * §261. «Ученик целиком» — карточка ученика у учителя (макет, экран А): шесть плиток и блоки «Проверочные и
 * контрольные», «Домашние задания», «Номера ЕГЭ, часть 1», «Активность», «Что делать до следующей встречи».
 *
 * Данные — ОДИН вызов `student_overview_for_staff` (хук `useStudentOverview`); всё, что считается, считается
 * функциями `lib/studentOverview.ts`, которые зовут общие правила проекта: прогноз — модель §255
 * (`buildForecastView`, показ только при покрытии), «вовремя» — §259 (`homeworkDeadline`), зоны — база.
 *
 * Заменяет прежние разрозненные строки карточки («Каталог за 7 дней», «Достижения: N из 79», статистику номеров):
 * то же самое теперь живёт в плитках и блоке «Активность», без второй копии.
 *
 * «Что делать до следующей встречи» здесь — только чтение последней сохранённой записи отчёта (та же таблица
 * `student_report_next_steps`); правят её во вкладке «Отчёт», куда ведёт ссылка, — второй копии данных нет.
 */
export function StudentOverview({ studentId, onOpenReport }: { studentId: string; onOpenReport: () => void }) {
  const { data, loading, error, reload } = useStudentOverview(studentId)

  if (!data) {
    return (
      <section data-testid="student-overview" aria-busy={loading} className="platform-surface rounded-card p-4 sm:p-5">
        {error && !loading ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500">
            <span data-testid="student-overview-error">Не удалось загрузить сводку по ученику.</span>
            <button type="button" onClick={reload} className="font-semibold text-primary-700 hover:underline">Повторить</button>
          </div>
        ) : (
          <div className="h-28 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
        )}
      </section>
    )
  }
  return <OverviewBody data={data} onOpenReport={onOpenReport} />
}

export function OverviewBody({ data, onOpenReport }: { data: Overview; onOpenReport: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const keys = useMemo(() => data.subjects.map(subjectKey), [data])
  const key = picked && keys.includes(picked) ? picked : defaultSubjectKey(data.subjects)
  const subject = key ? key.split(':')[0] : ''
  const tiles = useMemo(() => overviewTiles(data, key), [data, key])
  const assessments = useMemo(() => bySubject(data.assessments, key), [data, key])
  const homeworks = useMemo(() => recentHomeworks(bySubject(data.homeworks, key), data.now.getTime()), [data, key])

  return (
    <section data-testid="student-overview" className="flex flex-col gap-4">
      {data.subjects.length > 1 && (
        <div role="group" aria-label="Предмет" className="flex flex-wrap gap-1.5">
          {data.subjects.map(s => {
            const k = subjectKey(s)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={k === key}
                data-testid={`overview-subject-${k}`}
                onClick={() => setPicked(k)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-bold transition-colors',
                  k === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-graphite-200 bg-white text-graphite-600 hover:border-primary-400',
                )}
              >
                {SUBJECT_LABELS[s.subject] ?? s.subject} {s.examType.toUpperCase()}
              </button>
            )
          })}
        </div>
      )}

      <div data-testid="overview-tiles" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {tiles.map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Проверочные и контрольные" aside={assessmentAside(assessments)} testId="overview-assessments">
          {assessments.length === 0 ? (
            <Empty>Проверочных и контрольных пока не было.</Empty>
          ) : (
            <Table head={['Дата', 'Работа', 'Баллы', 'Оценка', 'Класс']}>
              {assessments.map((a, i) => (
                <tr key={`${a.title}-${i}`} data-testid="overview-assessment-row">
                  <Td className="whitespace-nowrap tabular-nums">{a.date ? shortDay(a.date) : DASH}</Td>
                  <Td className="min-w-[9rem]">{a.title}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{pointsLabel(a.points, a.pointsMax) ?? DASH}</Td>
                  <Td><Mark row={a} /></Td>
                  <Td className="whitespace-nowrap text-graphite-500 tabular-nums">
                    {a.classAvg != null ? `ср. ${formatGrade(a.classAvg, a.gradeScale ?? 'five')}` : DASH}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Block>

        <Block title="Домашние задания" aside="последние 6" testId="overview-homeworks">
          {homeworks.length === 0 ? (
            <Empty>Домашних заданий со сроком или сдачей пока нет.</Empty>
          ) : (
            <Table head={['Тема', 'Срок', 'Сдал', 'Балл']}>
              {homeworks.map((h, i) => (
                <tr key={`${h.row.title}-${i}`} data-testid="overview-homework-row">
                  <Td className="min-w-[9rem]">{h.row.title}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{h.row.dueAt ? shortDay(h.row.dueAt) : DASH}</Td>
                  <Td><Chip tone={h.tone}>{h.label}</Chip></Td>
                  <Td className="whitespace-nowrap tabular-nums">{h.scoreText}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Block>

        <ZonesBlock data={data} subject={subject} />
        <ActivityBlock data={data} />
      </div>

      <Block
        title="Что делать до следующей встречи"
        aside={data.nextSteps ? `из отчёта ${periodText(data.nextSteps.from, data.nextSteps.to)}` : 'попадёт в отчёт родителю'}
        testId="overview-next-steps"
      >
        {data.nextSteps ? (
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-graphite-800">
            {data.nextSteps.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        ) : (
          <Empty>Пока не записано. Три строки пишутся во вкладке «Отчёт для родителя» и печатаются на листе.</Empty>
        )}
        <div>
          <button type="button" onClick={onOpenReport} className="text-sm font-semibold text-primary-700 hover:underline">
            {data.nextSteps ? 'Изменить во вкладке «Отчёт»' : 'Написать во вкладке «Отчёт»'}
          </button>
        </div>
      </Block>
    </section>
  )
}

function periodText(from: string, to: string): string {
  return from && to ? `${shortDay(from)} — ${shortDay(to)}` : ''
}

function assessmentAside(rows: readonly AssessmentRow[]): string | undefined {
  const s = assessmentSummary(rows)
  return s.avg ? `средняя ${formatGrade(s.avg.value, s.avg.scale)}` : undefined
}

function Tile({ tile }: { tile: OverviewTile }) {
  return (
    <div data-testid={`overview-tile-${tile.key}`} className="platform-surface min-w-0 rounded-card p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-graphite-400">{tile.label}</div>
      <div className={cn('mt-1 text-[26px] font-extrabold leading-tight tabular-nums', tile.dashed ? 'text-graphite-400' : 'text-graphite-950')}>
        {tile.value}
      </div>
      <div className="text-[12.5px] leading-snug text-graphite-500">{tile.note}</div>
      {tile.bar && (
        <div
          className="relative mt-2 h-1.5 rounded-full bg-graphite-100"
          role="img"
          aria-label={`${tile.bar.value} из 100${tile.bar.goal != null ? `, цель ${tile.bar.goal}` : ''}`}
        >
          <i className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.min(100, Math.max(0, tile.bar.value))}%` }} />
          {tile.bar.goal != null && (
            <em className="absolute -top-[3px] h-3 w-0.5 bg-gold-500" style={{ left: `${Math.min(100, Math.max(0, tile.bar.goal))}%` }} />
          )}
        </div>
      )}
    </div>
  )
}

function Block({ title, aside, testId, children }: { title: string; aside?: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="platform-surface flex min-w-0 flex-col gap-2.5 rounded-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-extrabold text-graphite-950">{title}</h2>
        {aside && <span className="text-[12.5px] text-graphite-400">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-sm text-graphite-500">{children}</p>
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border-b border-graphite-100 px-2 py-1.5 text-left text-[11.5px] font-semibold text-graphite-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('border-b border-graphite-100 px-2 py-1.5 align-top text-graphite-800', className)}>{children}</td>
}

const TONE: Record<DeadlineTone, string> = {
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  late: 'bg-verdict-part-tint text-verdict-part-ink',
  bad: 'bg-verdict-bad-tint text-verdict-bad-ink',
  wait: 'bg-verdict-unk-tint text-verdict-unk-ink',
  none: 'bg-verdict-none-tint text-verdict-none-ink',
}

function Chip({ tone, children }: { tone: DeadlineTone; children: React.ReactNode }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', TONE[tone])}>{children}</span>
}

/** Оценка квадратиком: 5 — зелёный, 4 — синий, 3 — охра, 2 — красный; цифра на месте всегда (не только цвет). */
function Mark({ row }: { row: AssessmentRow }) {
  if (row.status !== 'accepted' || row.score == null) {
    const text = row.status === 'submitted' ? 'ждёт' : row.status === 'returned_for_revision' ? 'доработка' : row.status ? DASH : 'не писал'
    return <span className="whitespace-nowrap text-xs text-graphite-400">{text}</span>
  }
  const v = row.score
  const tone = row.gradeScale !== 'five' ? 'bg-graphite-100 text-graphite-700'
    : v >= 5 ? 'bg-verdict-ok-tint text-verdict-ok-ink'
      : v >= 4 ? 'bg-primary-50 text-primary-700'
        : v >= 3 ? 'bg-verdict-part-tint text-verdict-part-ink'
          : 'bg-verdict-bad-tint text-verdict-bad-ink'
  return <span className={cn('inline-grid h-[26px] min-w-[26px] place-items-center rounded-lg px-1 font-extrabold', tone)}>{String(v).replace('.', ',')}</span>
}

const ZONE_TONE: Record<CatalogZone, string> = {
  growth: 'bg-verdict-bad-tint text-verdict-bad-ink',
  progress: 'bg-verdict-part-tint text-verdict-part-ink',
  confident: 'bg-verdict-ok-tint text-verdict-ok-ink',
}

function ZonesBlock({ data, subject }: { data: Overview; subject: string }) {
  const cells = zoneCells(data.forecast, subject)
  const legend = zoneLegend(data.forecast?.catalogRules ?? null)
  const days = data.forecast?.catalogRules?.windowDays
  return (
    <Block title="Номера ЕГЭ, часть 1" aside={days ? `по проверенным ответам за ${days} дней` : undefined} testId="overview-zones">
      {cells.length === 0 ? (
        <Empty>Зоны номеров считаются для ЕГЭ по математике и физике.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {cells.map(c => (
              <div
                key={c.n}
                data-testid="overview-zone"
                data-zone={c.zone}
                title={`№${c.n}: ${ZONE_LABEL[c.zone]}`}
                className={cn('min-w-[44px] rounded-lg px-1.5 py-1 text-center text-[13px] font-extrabold', ZONE_TONE[c.zone])}
              >
                {c.n}
                <small className="block text-[10.5px] font-semibold opacity-90">{c.share != null ? `${Math.round(c.share * 100)} %` : DASH}</small>
              </div>
            ))}
          </div>
          {legend && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-graphite-500">
              {(['growth', 'progress', 'confident'] as const).map(z => (
                <span key={z}><span className={cn('rounded-full px-2 py-0.5 font-bold', ZONE_TONE[z])}>{ZONE_LABEL[z]}</span> {legend[z]}</span>
              ))}
            </div>
          )}
        </>
      )}
    </Block>
  )
}

function ActivityBlock({ data }: { data: Overview }) {
  const cells = activityCells(data.activity.days, data.today)
  const solved = cells.filter(c => c.solved).length
  const weekly = data.activity.weekly[0] ?? null
  const ach = data.achievements
  const line = [
    data.activity.daily.assigned > 0 ? `задача дня: ${data.activity.daily.done} из ${data.activity.daily.assigned}` : null,
    weekly ? `цель недели: ${weekly.progress} из ${weekly.target}` : null,
    `каталог за 7 дней: решено ${data.activity.catalog.weekTried}, верно ${data.activity.catalog.weekCorrect}`,
  ].filter(Boolean).join(' · ')
  return (
    <Block title="Активность" aside={`дни с решением за 2 недели: ${solved}`} testId="overview-activity">
      <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-[3px]" role="img" aria-label={`Решал ${solved} дней из 14`}>
        {cells.map(c => (
          <i
            key={c.day}
            data-solved={c.solved ? 'true' : 'false'}
            title={`${shortDay(c.day)}: ${c.solved ? 'решал' : 'не решал'}`}
            className={cn('block aspect-square rounded', c.solved ? 'bg-primary-500' : 'bg-graphite-100')}
          />
        ))}
      </div>
      <p className="m-0 text-[13px] text-graphite-500">{line.charAt(0).toUpperCase() + line.slice(1)}</p>
      {ach && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="overview-achievements">
          {ach.latest.map((name, i) => (
            <span key={i} className="rounded-full bg-gold-50 px-2 py-0.5 text-xs font-bold text-gold-700">{name}</span>
          ))}
          <span className="text-[12.5px] text-graphite-400">{ach.earned} из {ach.total} наград</span>
        </div>
      )}
    </Block>
  )
}
