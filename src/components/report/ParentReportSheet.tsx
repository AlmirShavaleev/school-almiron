import {
  DASH,
  averageScore,
  cleanSteps,
  egeTagLabel,
  formatDelta,
  formatFullDate,
  formatPeriod,
  formatShortDate,
  groupAverage,
  onTime,
  polylinePoints,
  sortSubjects,
  sparkPoints,
  targetLabel,
  topicBasis,
  topicsForList,
  watchTime,
  worksBreakdown,
  type ProgressReport,
  type ReportSubject,
  type ReportTopic,
} from '@/lib/parentReport'
import { SUBJECT_LABELS } from '@/utils/format'

/**
 * §217. Лист для родителя — ровно то, что уносят домой.
 *
 * ГЛАВНОЕ ПРО ЭТОТ ФАЙЛ: внутренней заметки преподавателя
 * (`report.teacher_note`) здесь НЕТ И НЕ ДОЛЖНО БЫТЬ. Не «скрыта стилем», не
 * `hidden`, не `display:none` — её нет в разметке вовсе. Стиль отключают
 * расширением браузера, «Просмотреть код» и сохранением страницы; отсутствие
 * узла отключить нельзя. На это стоит тест
 * (`__tests__/ParentReportSheet.test.tsx`).
 *
 * Сюда же не попадают: находки ИИ, комментарии проверки, рамки на работах,
 * имена и результаты других учеников и само слово «ИИ» — родителю важно, что
 * оценку поставил преподаватель.
 *
 * Прогноза балла на экзамене нет ни в каком виде (решение владельца): цель и
 * текущий средний рядом — этого достаточно, а прогноз на бумаге в руках
 * родителя превращается в обещание.
 *
 * Печатает браузер. Своей кнопки печати нет намеренно — их две не бывает, а
 * системный диалог умеет и поля, и масштаб, и выбор принтера. Разрывы страниц
 * и чёрно-белые правила — в `src/index.css`, блок `.report-sheet` и
 * `@media print`. Ничто на листе не различается ТОЛЬКО цветом: у каждой
 * пометки есть слово или форма.
 */

function Cell({ label, value, note, dashed }: {
  label: string
  value: string
  note?: string
  dashed?: boolean
}) {
  return (
    <div className="report-cell border-r border-graphite-200 px-3 py-2.5 last:border-r-0">
      <div className="text-[10px] uppercase tracking-wider text-graphite-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums text-graphite-900">{value}</div>
      {note && (
        <div className={dashed ? 'mt-0.5 text-[11px] text-gold-700' : 'mt-0.5 text-[11px] text-graphite-500'}>
          {note}
        </div>
      )}
    </div>
  )
}

/**
 * Маленький график «средний балл по неделям». Обычный SVG, без зависимостей —
 * решение оркестратора: ради двух ломаных библиотека в сборку не едет.
 * Числа подписаны под точками, поэтому график читается и на чёрно-белой
 * печати, где линия и сетка сливаются.
 */
function WeeksSpark({ subject }: { subject: ReportSubject }) {
  const width = 320
  const height = 62
  const points = sparkPoints(subject.weeks, width, height - 14)
  if (points.length === 0) return null

  return (
    <figure className="report-spark mt-3 m-0">
      <figcaption className="mb-1 text-[11px] text-graphite-500">Средний балл по неделям</figcaption>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Средний балл по неделям: ${subject.weeks.map(w => `${w.avg_percent} процентов`).join(', ')}`}
      >
        <line x1="0" y1={height - 14} x2={width} y2={height - 14} stroke="currentColor" strokeWidth="1" opacity="0.2" />
        {points.length > 1 && (
          <polyline points={polylinePoints(points)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 3} fill="currentColor" />
        ))}
        {points.map((p, i) => (
          <text key={`t${i}`} x={p.x} y={height - 2} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">
            {p.label}
          </text>
        ))}
      </svg>
    </figure>
  )
}

function SubjectBlock({ subject }: { subject: ReportSubject }) {
  const label = SUBJECT_LABELS[subject.subject] ?? subject.subject
  const avg = averageScore(subject.avg_percent, subject.graded_works)
  const peers = groupAverage(subject.group_avg_percent, subject.group_size)
  const mock = subject.last_mock
  const delta = formatDelta(mock?.delta ?? null)

  return (
    <section className="report-subject border-t border-graphite-200 pt-4 first:border-t-0 first:pt-0" data-testid={`report-subject-${subject.subject}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 text-lg font-bold text-graphite-900">{label}</h3>
        <span className="text-[13px] text-graphite-600">{targetLabel(subject.target)}</span>
      </div>

      <div className="report-grid grid grid-cols-2 border border-graphite-200 md:grid-cols-4">
        <Cell label="Средний балл" value={avg.value} note={avg.note} dashed={avg.dashed} />
        <Cell label="Среднее по группе" value={peers.value} note={peers.note} dashed={peers.dashed} />
        <Cell
          label="Работы"
          value={String(subject.works.submitted)}
          note={worksBreakdown(subject.works)}
        />
        <Cell
          label="Последний пробник"
          value={mock ? `${mock.score}${delta ? ` (${delta})` : ''}` : DASH}
          note={mock
            ? [
              formatShortDate(mock.date),
              mock.part1 != null ? `часть 1 — ${mock.part1}` : null,
              mock.part2 != null ? `часть 2 — ${mock.part2}` : null,
            ].filter(Boolean).join(' · ')
            : 'пробников за это время не было'}
          dashed={!mock}
        />
      </div>

      <WeeksSpark subject={subject} />
    </section>
  )
}

function TopicRow({ topic }: { topic: ReportTopic }) {
  const noNumber = topic.ege_numbers.length === 0
  return (
    <div className="report-topic-row flex items-baseline gap-2 border-b border-graphite-100 py-1.5 last:border-b-0">
      <span className={
        noNumber
          ? 'shrink-0 rounded border border-dashed border-graphite-300 px-1.5 text-[11px] text-graphite-500'
          : 'shrink-0 rounded bg-primary-50 px-1.5 text-[11px] font-semibold text-primary-700'
      }>
        {egeTagLabel(topic.ege_numbers)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-graphite-900">{topic.title}</span>
        {/* Число заданий, на котором посчитан процент, стоит ВСЕГДА: «41 %»
            без него — это «41 % чего?», а на двух заданиях и вовсе
            случайность. */}
        <span className="block text-[11px] text-graphite-500">
          {`${SUBJECT_LABELS[topic.subject] ?? topic.subject} · ${topicBasis(topic.tasks_counted)}`}
        </span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-graphite-900">
        {topic.correct_percent} %
      </span>
    </div>
  )
}

/**
 * График баллов пробников и целей. Второй и последний SVG отчёта.
 * Две линии различаются НЕ ТОЛЬКО цветом: у второй штриховой пунктир и своя
 * подпись в легенде — на чёрно-белом принтере цвет пропадает.
 */
function MocksChart({ report }: { report: ProgressReport }) {
  const mocks = report.mocks
  if (mocks.length < 2) return null

  const width = 560
  const height = 180
  const left = 42
  const right = 540
  const top = 12
  const bottom = 142
  const y = (score: number) => bottom - (Math.min(100, Math.max(0, score)) / 100) * (bottom - top)
  const subjects = Array.from(new Set(mocks.map(m => m.subject ?? '')))
  const span = mocks.length > 1 ? (right - left - 60) / (mocks.length - 1) : 0
  const x = (i: number) => left + 30 + span * i

  return (
    <figure className="report-chart m-0 mt-4">
      <figcaption className="mb-1.5 text-[11px] text-graphite-500">Баллы пробников</figcaption>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`График пробников: ${mocks.map(m => `${formatShortDate(m.date)} — ${m.score}`).join(', ')}`}
      >
        {[0, 40, 60, 80, 100].map(v => (
          <g key={v}>
            <line x1={left} y1={y(v)} x2={right} y2={y(v)} stroke="currentColor" strokeWidth="1" opacity="0.15" />
            <text x={left - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">{v}</text>
          </g>
        ))}
        {subjects.map((subj, si) => {
          const rows = mocks.map((m, i) => ({ m, i })).filter(r => (r.m.subject ?? '') === subj)
          if (rows.length === 0) return null
          const line = rows.map(r => `${x(r.i)},${y(r.m.score)}`).join(' ')
          return (
            <g key={subj || si}>
              {rows.length > 1 && (
                <polyline
                  points={line}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeDasharray={si === 0 ? undefined : '7 3'}
                />
              )}
              {rows.map(r => (
                <g key={r.i}>
                  <circle cx={x(r.i)} cy={y(r.m.score)} r="4" fill="currentColor" />
                  <text x={x(r.i)} y={y(r.m.score) - 8} fontSize="11" textAnchor="middle" fill="currentColor">
                    {r.m.score}
                  </text>
                </g>
              ))}
            </g>
          )
        })}
        {mocks.map((m, i) => (
          <text key={`d${i}`} x={x(i)} y={bottom + 16} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.6">
            {formatShortDate(m.date)}
          </text>
        ))}
        {subjects.map((subj, si) => (
          <g key={`l${subj || si}`}>
            <line
              x1={left + si * 110}
              y1={height - 7}
              x2={left + si * 110 + 24}
              y2={height - 7}
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={si === 0 ? undefined : '7 3'}
            />
            <text x={left + si * 110 + 30} y={height - 3} fontSize="11" fill="currentColor">
              {SUBJECT_LABELS[subj] ?? subj}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  )
}

function SheetFooter({ page, total, extra }: { page: number; total: number; extra?: string }) {
  return (
    <div className="report-foot mt-5 flex flex-wrap gap-3 border-t border-graphite-200 pt-2 text-[11px] text-graphite-500">
      <span>Школа Almiron</span>
      {extra && <span>{extra}</span>}
      <span className="ml-auto">Лист {page} из {total}</span>
    </div>
  )
}

export function ParentReportSheet({ report }: { report: ProgressReport }) {
  const subjects = sortSubjects(report.subjects, s => SUBJECT_LABELS[s] ?? s)
  const steps = cleanSteps(report.next_steps)
  const weak = topicsForList(report.topics?.weak)
  const strong = topicsForList(report.topics?.strong)
  const activity = report.activity
  const time = onTime(activity.on_time, activity.with_due, activity.late)
  const groupsLine = report.student.groups.join(' · ')

  return (
    <div className="report-document text-graphite-900" data-testid="parent-report-sheet">

      {/* ── Лист 1: шапка, предметы, что делать до следующей встречи ── */}
      <section className="report-sheet border border-graphite-200 bg-white p-6" data-testid="parent-report-page-1">
        <header className="mb-5 flex flex-wrap items-start gap-4 border-b-2 border-graphite-900 pb-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-graphite-500">Лист 1 из 2</div>
            <h2 className="m-0 text-2xl font-bold leading-tight text-graphite-900">{report.student.full_name}</h2>
            <p className="m-0 text-[13px] text-graphite-600">
              {[report.student.grade ? `${report.student.grade} класс` : null, groupsLine]
                .filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="ml-auto text-right text-[12px] text-graphite-600">
            Период: <span className="tabular-nums">{formatPeriod(report.period.from, report.period.to)}</span>
            <br />
            Отчёт составлен <span className="tabular-nums">{formatFullDate(report.generated_at)}</span>
          </div>
        </header>

        {subjects.length === 0 ? (
          <p className="text-[13px] text-graphite-500">
            За этот период у ученика нет ни курсов, ни работ — показывать нечего.
          </p>
        ) : (
          <div className="space-y-5">
            {subjects.map(s => <SubjectBlock key={`${s.subject}-${s.exam_type}`} subject={s} />)}
          </div>
        )}

        {steps.length > 0 && (
          <div className="report-next mt-5 border border-l-4 border-graphite-200 border-l-primary-600 px-4 py-3" data-testid="parent-report-next-steps">
            <h3 className="m-0 text-[10px] uppercase tracking-wider text-graphite-500">
              Что делать до следующей встречи
            </h3>
            <ol className="mb-0 mt-2 list-decimal space-y-1 pl-5 text-[13px]">
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}

        <SheetFooter page={1} total={2} />
      </section>

      {/* ── Лист 2: пробники, темы, активность ── */}
      <section className="report-sheet mt-5 border border-graphite-200 bg-white p-6" data-testid="parent-report-page-2">
        <header className="mb-5 border-b-2 border-graphite-900 pb-3">
          <div className="text-[10px] uppercase tracking-wider text-graphite-500">Лист 2 из 2</div>
          <h2 className="m-0 text-2xl font-bold leading-tight text-graphite-900">Подробности</h2>
          <p className="m-0 text-[13px] text-graphite-600">
            {report.student.full_name} · <span className="tabular-nums">{formatPeriod(report.period.from, report.period.to)}</span>
          </p>
        </header>

        <div className="report-block">
          <h3 className="m-0 mb-2 text-[10px] uppercase tracking-wider text-graphite-500">Пробные экзамены</h3>
          {report.mocks.length === 0 ? (
            <p className="m-0 text-[13px] text-graphite-500">Пробников у ученика пока нет.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-graphite-500">
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-left font-normal">Дата</th>
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-left font-normal">Предмет</th>
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-right font-normal">Балл</th>
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-right font-normal">Часть 1</th>
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-right font-normal">Часть 2</th>
                      <th className="border-b border-graphite-200 px-2 py-1.5 text-right font-normal">Среднее по группе</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mocks.map((m, i) => (
                      <tr key={i}>
                        <td className="border-b border-graphite-100 px-2 py-1.5 tabular-nums">{formatShortDate(m.date)}</td>
                        <td className="border-b border-graphite-100 px-2 py-1.5">{SUBJECT_LABELS[m.subject ?? ''] ?? m.subject}</td>
                        <td className="border-b border-graphite-100 px-2 py-1.5 text-right tabular-nums">{m.score}</td>
                        <td className="border-b border-graphite-100 px-2 py-1.5 text-right tabular-nums">{m.part1 ?? DASH}</td>
                        <td className="border-b border-graphite-100 px-2 py-1.5 text-right tabular-nums">{m.part2 ?? DASH}</td>
                        <td className="border-b border-graphite-100 px-2 py-1.5 text-right tabular-nums">{m.group_avg ?? DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] text-graphite-500">
                Прочерк в последнем столбце — в группе меньше {report.min_group_for_avg ?? 6} человек,
                среднее по ней не печатается.
              </p>
              <MocksChart report={report} />
            </>
          )}
        </div>

        <div className="report-block mt-5">
          <h3 className="m-0 mb-2 text-[10px] uppercase tracking-wider text-graphite-500">Темы</h3>
          {weak.length === 0 && strong.length === 0 ? (
            <p className="m-0 text-[13px] text-graphite-500">
              Проверенных заданий за период меньше, чем нужно, чтобы говорить о темах.
            </p>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <h4 className="m-0 mb-1.5 text-[10px] uppercase tracking-wider text-graphite-500">Проседает</h4>
                {weak.length === 0
                  ? <p className="m-0 text-[13px] text-graphite-500">{DASH}</p>
                  : weak.map(t => <TopicRow key={t.topic_id} topic={t} />)}
              </div>
              <div>
                <h4 className="m-0 mb-1.5 text-[10px] uppercase tracking-wider text-graphite-500">Получается</h4>
                {strong.length === 0
                  ? <p className="m-0 text-[13px] text-graphite-500">{DASH}</p>
                  : strong.map(t => <TopicRow key={t.topic_id} topic={t} />)}
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-graphite-500">
            Тема попадает в списки от {report.min_tasks_for_topic ?? 3} проверенных заданий — на двух это
            случайность, а не знание. «Без номера» — тема, которой ещё не проставлен номер задания ЕГЭ.
          </p>
        </div>

        <div className="report-block mt-5">
          <h3 className="m-0 mb-2 text-[10px] uppercase tracking-wider text-graphite-500">Активность за период</h3>
          <div className="report-grid grid grid-cols-2 border border-graphite-200 md:grid-cols-4">
            <Cell label="Сдано вовремя" value={time.value} note={time.note} dashed={time.dashed} />
            <Cell
              label="Видео"
              value={watchTime(activity.video_seconds)}
              note={`${watchTime(activity.video_seconds_last_week)} за последнюю неделю`}
            />
            <Cell label="Материалы" value={String(activity.materials)} note="конспектов и разборов открыто" />
            <Cell label="Задачи каталога" value={String(activity.catalog_tasks)} note="решено самостоятельно" />
          </div>
          <p className="mt-1.5 text-[11px] text-graphite-500">
            Активность — про дисциплину, а не про знания: время в записях само по себе баллов не прибавляет.
          </p>
        </div>

        <SheetFooter page={2} total={2} extra="Вопросы — преподавателю на собрании или в кабинете" />
      </section>
    </div>
  )
}
