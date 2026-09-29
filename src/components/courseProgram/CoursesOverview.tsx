import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap, Plus } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Course } from '@/hooks/useCourseProgram'
import {
  buildAttention, courseChips, coursesLabel, formatDayMonth, modulesLabel, nextTileLabel,
  otherCourseLabel, pendingTileLabel, programGenitive, studentsLabel, subsTileLabel, topicsLabel,
  type Attention, type Chip, type CourseCardData, type CoursesLayout, type CourseStat, type CourseStats,
  type ProgramInfo, type SubjectTone,
} from '@/lib/coursesOverview'

/**
 * §244. Список курсов учителя: полоса «что требует внимания», классы (или
 * программы), шаблоны, прочие курсы, архив. Раскладку считает
 * `buildCoursesLayout` (lib/coursesOverview), здесь только отрисовка.
 *
 * Каждая карточка курса — `<Link>`, не кнопка: Ctrl+клик и средняя кнопка
 * открывают курс в новой вкладке, адрес виден и копируется (как было до §244).
 */

export type CoursesView = 'classes' | 'programs'
const VIEW_KEY = 'courses:view'

/**
 * Вид «По классам» / «По программам» — в localStorage, через try/catch:
 * в приватном окне или при запрете хранилища просто вид по умолчанию.
 */
export function useCoursesView(): [CoursesView, (v: CoursesView) => void] {
  const [view, setView] = useState<CoursesView>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'programs' ? 'programs' : 'classes'
    } catch {
      return 'classes'
    }
  })
  const set = useCallback((v: CoursesView) => {
    setView(v)
    try { window.localStorage.setItem(VIEW_KEY, v) } catch { /* вид остаётся до перезагрузки */ }
  }, [])
  return [view, set]
}

export function CoursesViewToggle({ view, onChange }: { view: CoursesView; onChange: (v: CoursesView) => void }) {
  const btn = (v: CoursesView, label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => onChange(v)}
      className={cn(
        'min-h-9 rounded-[9px] px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        view === v ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:text-gray-800',
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Как показывать" data-testid="courses-view-toggle" className="inline-flex rounded-xl border border-gray-200 bg-white p-[3px]">
      {btn('classes', 'По классам')}
      {btn('programs', 'По программам')}
    </div>
  )
}

// ─── Мелкие части ───────────────────────────────────────────────────────────

const TONE_ICON: Record<SubjectTone, string> = {
  math: 'bg-primary-50 text-primary-700',
  physics: 'bg-violet-50 text-violet-700',
  other: 'bg-gray-100 text-gray-600',
}
const TONE_BAR: Record<SubjectTone, string> = {
  math: 'bg-primary-600',
  physics: 'bg-violet-600',
  other: 'bg-gray-500',
}
const CHIP: Record<Chip['tone'], string> = {
  warn: 'bg-verdict-part-tint text-verdict-part-ink',
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  mute: 'border border-gray-200 bg-gray-50 text-gray-500',
  plan: 'bg-primary-50 text-primary-700',
}

function ProgramIcon({ program, small = false }: { program: ProgramInfo; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-[10px] font-extrabold',
        small ? 'h-7 w-7 text-sm' : 'h-[34px] w-[34px] text-[15px]',
        TONE_ICON[program.tone],
      )}
    >
      {program.glyph}
    </span>
  )
}

/** Метка состояния — как было в карточке курса до §244. */
function StateMark({ course }: { course: Course }) {
  if (course.is_draft) {
    return <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">черновик</span>
  }
  if (!course.is_active) return <span className="shrink-0 text-xs text-gray-400">архив</span>
  return null
}

/** Чей курс — тихой строкой, только если не свой (админ смотрит чужие). */
function OwnerLine({ label }: { label: string | null }) {
  if (!label) return null
  return (
    <span data-testid="course-owner" className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-400">
      <GraduationCap size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function Chips({ stat, today }: { stat: CourseStat; today: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {courseChips(stat, today).map(c => (
        <span key={c.text} data-tone={c.tone} className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums', CHIP[c.tone])}>
          {c.text}
        </span>
      ))}
    </div>
  )
}

function Progress({ stat, tone }: { stat: CourseStat; tone: SubjectTone }) {
  const pct = stat.topics > 0 ? Math.round((stat.openTopics / stat.topics) * 100) : 0
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Открыто тем</span>
        <b className="font-bold tabular-nums text-gray-900">{stat.openTopics} из {stat.topics}</b>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
        <i className={cn('block h-full rounded-full', TONE_BAR[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CourseStatCard({ card, title, ownerLabel, today, loading }: {
  card: CourseCardData<Course>
  title: string
  ownerLabel: string | null
  today: string
  loading: boolean
}) {
  const { course, stat, program } = card
  return (
    <Link
      to={`/course-program?courseId=${course.id}`}
      title={course.title}
      data-testid="course-card"
      data-course-id={course.id}
      className="group grid min-w-0 content-start gap-2.5 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-primary-400 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ProgramIcon program={program} />
        <div className="grid min-w-0 flex-1">
          <b className="truncate text-[15px] font-extrabold text-gray-900 group-hover:text-primary-700">{title}</b>
          {/* Метка черновика — в строке под названием, а не рядом: иначе она
              съедает ширину, и «Математика · 2 часть» обрезается многоточием. */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
            <span>{stat ? studentsLabel(stat.students) : loading ? '…' : ''}</span>
            <StateMark course={course} />
          </span>
        </div>
      </div>
      {stat && <Progress stat={stat} tone={program.tone} />}
      {stat && <Chips stat={stat} today={today} />}
      <OwnerLine label={ownerLabel} />
    </Link>
  )
}

function Missing({ program }: { program: ProgramInfo }) {
  return (
    <div data-testid="course-missing" className="grid min-h-14 place-items-center rounded-2xl border border-dashed sm:min-h-[120px] border-gray-300 p-3.5 text-center text-sm text-gray-400">
      {programGenitive(program)} здесь нет
    </div>
  )
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <h3 className="text-base font-extrabold text-gray-900">{title}</h3>
      {hint && <span className="text-sm text-gray-500">{hint}</span>}
    </div>
  )
}

/** Строка раскладки: слева имя (над карточками на телефоне), справа карточки. */
function Row({ name, sub, children, testId }: { name: string; sub: string; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="grid gap-2.5 border-t border-gray-200 pt-3.5 first:border-t-0 first:pt-0 md:grid-cols-[150px_minmax(0,1fr)] md:gap-4">
      <div className="grid content-start gap-0.5 md:pt-1.5">
        <b data-testid="row-name" className="break-words text-xl font-extrabold text-gray-900">{name}</b>
        <span className="text-xs text-gray-500">{sub}</span>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  )
}

// ─── Полоса внимания ────────────────────────────────────────────────────────

function AttentionStrip({ a, today }: { a: Attention; today: string }) {
  const tile = 'grid gap-0.5 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left'
  const link = 'transition-colors hover:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'
  return (
    <div data-testid="courses-attention" className={cn('grid gap-3', a.next ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
      <Link to="/homework-queue" data-testid="attention-pending" className={cn(tile, link)}>
        <span className={cn('text-2xl font-extrabold tabular-nums leading-tight', a.pending > 0 ? 'text-verdict-part-ink' : 'text-gray-900')}>{a.pending}</span>
        <span className="text-sm text-gray-500">{pendingTileLabel(a)}</span>
      </Link>
      <div data-testid="attention-subs" className={tile}>
        <span className="text-2xl font-extrabold tabular-nums leading-tight text-gray-900">{a.subs7d}</span>
        <span className="text-sm text-gray-500">{subsTileLabel(a)}</span>
      </div>
      {a.next && (
        <Link to={`/course-program/${a.next.courseId}/plan`} data-testid="attention-next" className={cn(tile, link)}>
          <span className="text-2xl font-extrabold tabular-nums leading-tight text-gray-900">{formatDayMonth(a.next.date, today)}</span>
          <span className="text-sm text-gray-500">{nextTileLabel(a.next)}</span>
        </Link>
      )}
    </div>
  )
}

// ─── Вся страница списка ────────────────────────────────────────────────────

function mskToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}

export function CoursesOverview({
  layout, stats, statsLoading, view, ownerLabelFor, canAddClass, onAddClass,
}: {
  layout: CoursesLayout<Course>
  stats: CourseStats | null
  statsLoading: boolean
  view: CoursesView
  ownerLabelFor: (c: Course) => string | null
  canAddClass: boolean
  onAddClass: (template: Course) => void
}) {
  const today = mskToday()
  const attention = buildAttention(layout, stats)
  const hasLive = layout.classes.length > 0 || layout.other.length > 0

  return (
    <div className="grid min-w-0 gap-7">
      {attention && hasLive && <AttentionStrip a={attention} today={today} />}

      {view === 'classes' && layout.classes.length > 0 && (
        <section data-testid="courses-by-class" className="grid gap-3.5">
          <SectionHead title="Классы" hint="курсы с учениками" />
          <div className="grid gap-3.5">
          {layout.classes.map(row => (
            <Row
              key={row.key}
              testId="class-row"
              name={row.name}
              sub={row.students === null ? coursesLabel(row.courseCount) : `${coursesLabel(row.courseCount)} · ${studentsLabel(row.students)}`}
            >
              {row.slots.map(s => s.kind === 'course'
                ? <CourseStatCard key={s.card.course.id} card={s.card} title={s.card.program.name} ownerLabel={ownerLabelFor(s.card.course)} today={today} loading={statsLoading} />
                : <Missing key={`missing-${s.templateId}`} program={s.program} />)}
            </Row>
          ))}
          </div>
        </section>
      )}

      {view === 'programs' && layout.programs.length > 0 && (
        <section data-testid="courses-by-program" className="grid gap-3.5">
          <SectionHead title="Программы" hint="шаблон и его классы" />
          <div className="grid gap-3.5">
          {layout.programs.map(row => (
            <Row
              key={row.template.id}
              testId="program-row"
              name={row.program.name}
              sub={row.stat ? `шаблон · ${topicsLabel(row.stat.topics)}` : 'шаблон'}
            >
              {row.cards.length === 0
                ? <div className="grid min-h-[72px] place-items-center rounded-2xl border border-dashed border-gray-300 p-3.5 text-sm text-gray-400">Классов пока нет</div>
                : row.cards.map(c => (
                  <CourseStatCard key={c.course.id} card={c} title={c.className} ownerLabel={ownerLabelFor(c.course)} today={today} loading={statsLoading} />
                ))}
            </Row>
          ))}
          </div>
        </section>
      )}

      {layout.programs.length > 0 && (
        <section data-testid="courses-templates" className="grid gap-3.5">
          <SectionHead title="Шаблоны программ" hint="правки здесь уходят во все классы" />
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {layout.programs.map(row => (
              <div key={row.template.id} data-testid="template-card" className="grid min-w-0 content-start gap-2.5 rounded-2xl border border-gray-200 bg-white px-4 py-3.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ProgramIcon program={row.program} />
                  <div className="grid min-w-0 flex-1">
                    <Link
                      to={`/course-program?courseId=${row.template.id}`}
                      className="break-words text-[15px] font-extrabold leading-snug text-gray-900 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                      {row.template.title}
                    </Link>
                    {row.stat && <span className="text-xs text-gray-500">{topicsLabel(row.stat.topics)} · {modulesLabel(row.stat.modules)}</span>}
                  </div>
                  <StateMark course={row.template} />
                </div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500">Классы · {row.cards.length}</span>
                {row.cards.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {row.cards.map(c => (
                      <Link
                        key={c.course.id}
                        to={`/course-program?courseId=${c.course.id}`}
                        title={c.course.title}
                        data-testid="template-class-link"
                        className="max-w-full truncate rounded-[10px] border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm font-bold text-gray-900 hover:border-primary-400 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                      >
                        {c.className}
                      </Link>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/course-program?courseId=${row.template.id}`}
                    className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-graphite-300 bg-white px-3.5 text-sm font-medium text-gray-900 hover:border-primary-500 sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    Открыть шаблон
                  </Link>
                  {canAddClass && (
                    <button
                      type="button"
                      onClick={() => onAddClass(row.template)}
                      data-testid="template-add-class"
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border-[1.5px] border-graphite-300 bg-white px-3.5 text-sm font-medium text-gray-900 hover:border-primary-500 sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    >
                      <Plus size={15} />Класс
                    </button>
                  )}
                </div>
                <OwnerLine label={ownerLabelFor(row.template)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {layout.other.length > 0 && (
        <section data-testid="courses-other" className="grid gap-3.5">
          <SectionHead title="Другие курсы" hint="без шаблона" />
          <div className="flex flex-wrap gap-2.5">
            {layout.other.map(o => (
              <CompactCourse key={o.course.id} course={o.course} program={o.program} sub={otherCourseLabel(o)} ownerLabel={ownerLabelFor(o.course)} />
            ))}
          </div>
        </section>
      )}

      {/* Архив — под спойлером, как было: его не открывают каждый день. */}
      {layout.archived.length > 0 && (
        <details className="rounded-2xl border border-gray-200 bg-white/60 px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-gray-500 hover:text-gray-700">
            Архив · {layout.archived.length}
          </summary>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {layout.archived.map(c => (
              <CompactCourse key={c.id} course={c} program={null} sub={null} ownerLabel={ownerLabelFor(c)} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function CompactCourse({ course, program, sub, ownerLabel }: {
  course: Course
  program: ProgramInfo | null
  sub: string | null
  ownerLabel: string | null
}) {
  return (
    <Link
      to={`/course-program?courseId=${course.id}`}
      title={course.title}
      data-testid="course-compact"
      className="flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-900 transition-colors hover:border-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      {program && <ProgramIcon program={program} small />}
      <span className="grid min-w-0">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="break-words">{course.title}</span>
          {sub && <span className="text-xs font-medium text-gray-500">{sub}</span>}
        </span>
        <OwnerLine label={ownerLabel} />
      </span>
      <StateMark course={course} />
    </Link>
  )
}
