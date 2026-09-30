import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuthStore } from '@/store/authStore'
import { useCatalogOverview } from '@/hooks/useCatalogOverview'
import { DIRECTIONS } from '@/hooks/useCatalog'
import {
  examBars, examChips, examHref, examSubtitle, formatCount, isDimmed, numberRange, overallRank,
  solvedCaption, subjectGlyph, subjectRows, subjectTone, summaryChips, summaryState, tasksWord,
  BAR_MAX_PX,
  type CatalogOverview, type Chip, type OverviewExam, type SubjectTone,
} from '@/lib/catalogOverview'

/**
 * §246. Главная «Каталога заданий» (`/catalog` без параметров).
 *
 * Ученику: личный итог (решено, +за неделю, сильнее всего, не начатые номера,
 * место в школе), строки предметов, у каждого экзамена — столбики «решено по
 * номерам» (нажатие — в номер), чипы и «Продолжить/Начать →».
 * Персоналу — та же страница без личного: столбики по числу задач в номерах.
 *
 * Раскладку и тексты считает `lib/catalogOverview`, здесь только отрисовка.
 * Пока цифры грузятся (или не загрузились), карточки экзаменов стоят сразу —
 * с числами задач из DIRECTIONS, как было на лендинге (§ 2026-07-30: лендинг
 * не должен ничего ждать, чтобы в каталог можно было войти).
 */

const LEAD_STUDENT = 'Решай по номерам и отмечай «Выполнено» — здесь видно, где ты уже силён, а какие номера ещё не трогал'
const LEAD_STAFF = 'Задачи ЕГЭ и ОГЭ по номерам экзамена — сколько задач в каждом номере'

const TONE_ICON: Record<SubjectTone, string> = {
  math: 'bg-primary-50 text-primary-700',
  physics: 'bg-violet-50 text-violet-700',
  other: 'bg-gray-100 text-gray-600',
}
const TONE_BAR: Record<SubjectTone, string> = {
  math: 'bg-primary-600 hover:bg-primary-500',
  physics: 'bg-violet-600 hover:bg-violet-500',
  other: 'bg-gray-500 hover:bg-gray-400',
}
const TONE_HOVER: Record<SubjectTone, string> = {
  math: 'hover:border-primary-400',
  physics: 'hover:border-violet-400',
  other: 'hover:border-gray-400',
}
const TONE_GO: Record<SubjectTone, string> = {
  math: 'text-primary-700',
  physics: 'text-violet-700',
  other: 'text-gray-700',
}
const CHIP: Record<Chip['tone'], string> = {
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  acc: 'bg-primary-50 text-primary-700',
  mute: 'border border-gray-200 bg-gray-50 text-gray-500',
}

export function CatalogHome() {
  const { profile } = useAuthStore()
  const { overview, loading, error, retry } = useCatalogOverview(profile?.id)
  const isStudent = overview ? overview.viewer === 'student' : profile?.role === 'student'

  return (
    <div className="mx-auto max-w-[1180px] space-y-6" data-testid="catalog-home">
      <header>
        <h1 className="text-2xl font-extrabold text-gray-900 sm:text-[1.9rem]">Каталог заданий</h1>
        <p className="mt-1 text-gray-500">{isStudent ? LEAD_STUDENT : LEAD_STAFF}</p>
      </header>

      {overview ? (
        <>
          {overview.viewer === 'student' && <Summary o={overview} />}
          {subjectRows(overview).map(row => (
            <SubjectBlock key={row.subject} subject={row.subject} tone={row.tone} glyph={row.glyph} solved={row.solved}>
              {row.exams.map(e => <ExamCard key={`${e.subject}|${e.examType}`} o={overview} e={e} />)}
            </SubjectBlock>
          ))}
        </>
      ) : (
        <>
          {isStudent && loading && <SummarySkeleton />}
          {error && !loading && (
            <div role="status" data-testid="catalog-home-error" className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
              <span>Не удалось загрузить статистику — разделы открываются как обычно.</span>
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 hover:border-primary-400 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Повторить
              </button>
            </div>
          )}
          <FallbackRows loading={loading} />
        </>
      )}
    </div>
  )
}

// ─── Личный итог ─────────────────────────────────────────────────────────────

function Summary({ o }: { o: CatalogOverview }) {
  const state = summaryState(o)
  const solved = o.overall?.solved ?? 0
  const rank = overallRank(o)
  return (
    <section
      data-testid="catalog-summary"
      data-state={state}
      aria-label="Мой итог"
      className="grid grid-cols-1 items-center gap-4 rounded-card border border-gray-200 bg-white p-[18px] md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-[18px]"
    >
      <div>
        <b className="block text-[2.6rem] font-extrabold leading-none tabular-nums text-gray-900" data-testid="summary-solved">{formatCount(solved)}</b>
        <span className="block text-sm text-gray-500">{solvedCaption(solved)}</span>
      </div>
      <div className="min-w-0">
        {state === 'new' ? (
          <p className="text-sm text-gray-500">
            Открой номер, реши задачу и нажми «Выполнено» — здесь начнёт расти твоя статистика.
          </p>
        ) : (
          <ChipRow chips={summaryChips(o)} testId="summary-chips" />
        )}
      </div>
      {rank.kind !== 'none' && (
        <div data-testid="summary-rank" className="grid gap-0.5 text-left md:justify-items-end md:text-right">
          {rank.kind === 'pct' ? (
            <>
              <b className="text-2xl font-extrabold tabular-nums text-verdict-ok-ink">больше, чем {rank.pct}&nbsp;%</b>
              <span className="max-w-[28ch] text-[13px] text-gray-500">{rank.caption}</span>
            </>
          ) : (
            <span className="max-w-[32ch] text-[13px] text-gray-500">{rank.text}</span>
          )}
        </div>
      )}
    </section>
  )
}

function SummarySkeleton() {
  return (
    <div aria-hidden="true" data-testid="summary-skeleton" className="h-[92px] animate-pulse rounded-card border border-gray-200 bg-white" />
  )
}

function ChipRow({ chips, testId }: { chips: Chip[]; testId?: string }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {chips.map(c => (
        <span key={c.text} data-tone={c.tone} className={cn('max-w-full rounded-full px-2.5 py-1 text-xs font-bold tabular-nums', CHIP[c.tone])}>
          {c.text}
        </span>
      ))}
    </div>
  )
}

// ─── Предмет ─────────────────────────────────────────────────────────────────

function SubjectBlock({ subject, tone, glyph, solved, children }: {
  subject: string; tone: SubjectTone; glyph: string; solved: number | null; children: ReactNode
}) {
  return (
    <section className="grid gap-3" data-testid="subject-row" data-subject={subject}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={cn('grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-lg font-extrabold', TONE_ICON[tone])}>
          {glyph}
        </span>
        <h2 className="text-xl font-extrabold text-gray-900">{subject}</h2>
        {solved != null && solved > 0 && (
          <span className="text-sm text-gray-500 tabular-nums">решено {formatCount(solved)}</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">{children}</div>
    </section>
  )
}

// ─── Карточка экзамена ───────────────────────────────────────────────────────

function ExamCard({ o, e }: { o: CatalogOverview; e: OverviewExam }) {
  const tone = subjectTone(e.subject)
  const student = o.viewer === 'student'
  const dim = isDimmed(o, e)
  const solved = e.solved ?? 0
  const go = !student ? 'Открыть номера' : solved > 0 ? 'Продолжить' : 'Начать'
  return (
    <article
      data-testid="exam-card"
      data-exam={`${e.subject} ${e.examType}`}
      data-dim={dim ? 'true' : 'false'}
      className={cn(
        // Одна колонка minmax(0,1fr): без неё подписи 26 номеров физики раздвигают
        // карточку по min-content и она вылезает за экран на 390. Строка чипов
        // забирает лишнюю высоту — у соседних карточек столбики на одном уровне.
        'relative grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto] gap-3.5 rounded-card border border-gray-200 bg-white px-[18px] pb-3.5 pt-[18px] transition-shadow hover:shadow-card motion-reduce:transition-none',
        TONE_HOVER[tone],
        dim && 'opacity-75',
      )}
    >
      <ExamHead subject={e.subject} examType={e.examType}>
        <b className="block text-2xl font-extrabold leading-none tabular-nums text-gray-900">{formatCount(student ? solved : e.total)}</b>
        <span className="text-xs text-gray-500">{student ? `решено из ${formatCount(e.total)}` : tasksWord(e.total)}</span>
      </ExamHead>
      <Bars o={o} e={e} tone={tone} />
      <div className="self-start"><ChipRow chips={examChips(o, e)} testId="exam-chips" /></div>
      <Link
        to={examHref(e.subject, e.examType)}
        aria-label={`${go}: ${e.subject} ${e.examType}`}
        className="flex items-center justify-between border-t border-gray-200 pt-2.5 text-sm font-bold text-gray-900 after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-400"
      >
        <span>{go}</span>
        <span aria-hidden="true" className={TONE_GO[tone]}>→</span>
      </Link>
    </article>
  )
}

function ExamHead({ subject, examType, children }: { subject: string; examType: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <b className={cn('block text-2xl font-extrabold leading-none', examType === 'ОГЭ' ? 'text-teal-700' : 'text-gray-900')}>{examType}</b>
        <span className="text-sm text-gray-500">{examSubtitle(subject, examType)}</span>
      </div>
      <div className="shrink-0 text-right">{children}</div>
    </div>
  )
}

/**
 * Подписи номеров: на телефоне при 20+ номерах — только крайние и кратные 5
 * (кроме соседа последнего: «25 26» слипаются), иначе цифры наезжают друг на друга.
 */
function labelHidden(n: number, i: number, count: number) {
  if (count <= 20 || i === 0 || i === count - 1) return false
  return n % 5 !== 0 || i === count - 2
}

function Bars({ o, e, tone }: { o: CatalogOverview; e: OverviewExam; tone: SubjectTone }) {
  const bars = examBars(o, e)
  const [tip, setTip] = useState<number | null>(null)
  const count = bars.length
  const shown = tip != null ? bars[tip] : null
  // Якорь подсказки сдвигается вместе со столбиком: у левого края подсказка
  // растёт вправо, у правого — влево, поэтому за карточку не вылезает.
  const frac = tip != null ? (tip + 0.5) / count : 0
  return (
    <div className="relative z-10">
      <div className="mb-1.5 flex justify-between text-xs text-gray-500">
        <span>{o.viewer === 'student' ? 'Решено по номерам' : 'Задач по номерам'}</span>
        <span className="tabular-nums">{numberRange(e)}</span>
      </div>
      <div className="relative">
        <div className="flex items-end gap-[3px]" style={{ height: BAR_MAX_PX }} onMouseLeave={() => setTip(null)}>
          {bars.map((b, i) => {
            const cls = cn(
              'block min-w-0 flex-1 rounded-t-[4px] rounded-b-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
              b.on ? TONE_BAR[tone] : 'bg-gray-200 hover:bg-gray-400',
            )
            const common = {
              'data-testid': 'number-bar',
              'data-n': b.n,
              'data-on': b.on ? 'true' : 'false',
              'aria-label': b.tip,
              className: cls,
              style: { height: b.heightPx },
              onMouseEnter: () => setTip(i),
              onFocus: () => setTip(i),
              onBlur: () => setTip(null),
            }
            return b.href
              ? <Link key={b.n} to={b.href} {...common} />
              : <span key={b.n} {...common} />
          })}
        </div>
        {shown && (
          <div
            role="tooltip"
            data-testid="bar-tip"
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-white shadow-card"
            style={{
              left: `${frac * 100}%`,
              top: BAR_MAX_PX - shown.heightPx - 6,
              transform: `translate(-${frac * 100}%, -100%)`,
            }}
          >
            {shown.tip}
          </div>
        )}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden="true">
        {bars.map((b, i) => (
          <span
            key={b.n}
            className={cn(
              'min-w-0 flex-1 text-center text-[10px] tabular-nums text-gray-400',
              labelHidden(b.n, i, count) && 'max-sm:invisible',
            )}
          >
            {b.n}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Пока цифр нет ───────────────────────────────────────────────────────────

/**
 * Четыре карточки из DIRECTIONS — сразу, без ожидания: вход в номера работает
 * и до ответа функции, и если она упала. Столбиков нет — только число задач.
 */
function FallbackRows({ loading }: { loading: boolean }) {
  const subjects = [...new Set(DIRECTIONS.map(d => d.subject))]
  return (
    <>
      {subjects.map(subject => {
        const tone = subjectTone(subject)
        return (
          <SubjectBlock key={subject} subject={subject} tone={tone} glyph={subjectGlyph(subject)} solved={null}>
            {DIRECTIONS.filter(d => d.subject === subject).map(d => (
              <article
                key={d.key}
                data-testid="exam-card"
                data-exam={`${d.subject} ${d.examType}`}
                className={cn('relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5 rounded-card border border-gray-200 bg-white px-[18px] pb-3.5 pt-[18px] transition-shadow hover:shadow-card', TONE_HOVER[tone])}
              >
                <ExamHead subject={d.subject} examType={d.examType}>
                  <b className="block text-2xl font-extrabold leading-none tabular-nums text-gray-900">{formatCount(d.taskCount)}</b>
                  <span className="text-xs text-gray-500">{tasksWord(d.taskCount)}</span>
                </ExamHead>
                {loading && <div aria-hidden="true" className="h-[88px] animate-pulse rounded-xl bg-gray-100" />}
                <Link
                  to={examHref(d.subject, d.examType)}
                  className="flex items-center justify-between border-t border-gray-200 pt-2.5 text-sm font-bold text-gray-900 after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-400"
                >
                  <span>Открыть номера</span>
                  <span aria-hidden="true" className={TONE_GO[tone]}>→</span>
                </Link>
              </article>
            ))}
          </SubjectBlock>
        )
      })}
    </>
  )
}
