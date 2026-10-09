import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookOpen, Check, Clock, ClipboardList,
  GraduationCap, Loader2, Lock, CheckCircle, RotateCcw, AlertCircle,
  Upload, ArrowLeft, ChevronRight, Play, MessageSquare, BarChart3,
  LayoutList, LayoutGrid, FileEdit, ListChecks,
} from 'lucide-react'
import { useStudentCourseProgram, type TopicProgress, type ModuleProgress, type StaffInfo } from '@/hooks/useStudentCourseProgram'
import { TopicKindMark } from '@/components/courseProgram/TopicKindMark'
import { LessonFormatMark } from '@/components/courseProgram/LessonFormatMark'
import { LessonCard } from '@/components/courseProgram/LessonCard'
import { ModuleArt } from '@/components/courseProgram/ModuleArt'
import { moduleArtKey, moduleCardTitle, moduleIsPractice, moduleTag } from '@/lib/moduleArt'
import { StudentWeekPlan } from '@/components/student/StudentWeekPlan'
import { usePreviewMode } from '@/store/staffModeStore'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/utils/cn'
import {
  doneLabel, donePercent, homeworkLabel, isCompleted, sumCounters,
} from '@/lib/studentCourseCounters'
import { SUBJECT_LABELS, EXAM_LABELS, formatDate } from '@/utils/format'
import { isOverdue, GRADE_SCALE_LABEL } from '@/lib/topicHomework'
import { testPercent } from '@/lib/studentProgram'
import { type TopicSection } from '@/lib/topicMaterialItems'
import { isTopicOpen, topicClosedLabel } from '@/lib/topicAvailability'
import { plural, pluralTopics } from '@/lib/plural'
import { MockExamsSection } from '@/components/student/MockExamsSection'
import { CourseAssessmentsSection } from '@/components/student/CourseAssessmentsSection'
import { useMyCourseAssessments } from '@/hooks/useCourseAssessments'
import {
  isWorksOnlyModule, studentProgramModules, workWhenLabel, workWhenShort, worksCountLabel, type AssessmentWork,
} from '@/lib/courseAssessments'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { SubscriptionLockBanner } from '@/components/subscription/SubscriptionLockBanner'
import { useServerNow } from '@/hooks/useServerNow'
import { mockAlert } from '@/lib/mockExamLesson'

// ─── View preference ─────────────────────────────────────────────────────────

const VIEW_PREF_KEY = 'student-course-view'
type CourseView = 'list' | 'cards'

// §274. По умолчанию — карточки уроков (превью, «что внутри», срок ДЗ); кто
// выбрал «Список», остаётся на нём — выбор хранится как раньше.
function getViewPref(): CourseView {
  try { return (localStorage.getItem(VIEW_PREF_KEY) as CourseView) || 'cards' } catch { return 'cards' }
}
function saveViewPref(v: CourseView) {
  try { localStorage.setItem(VIEW_PREF_KEY, v) } catch {}
}

// ─── Progress ring ────────────────────────────────────────────────────────────

function Ring({ pct, size = 44, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r    = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const done = pct === 100
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={done ? '#22c55e' : '#6366f1'} strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">
        {pct}%
      </div>
    </div>
  )
}

// ─── MODULE CARD (Level 1) ────────────────────────────────────────────────────

// Gradient palette per module index
/**
 * §281. Карточка раздела — в цветах наших PDF-листов (выбор владельца 09.10,
 * вариант «мягкий тон»): светло-голубая подложка, как под схемами в листах,
 * синий рисунок раздела в углу, синяя полоска. Практика ЕГЭ и пилот — та же
 * карточка в светло-оранжевом (оранжевый в листах — ускорение и силы).
 * Радуга по порядку разделов ушла: цвет должен нести смысл (дизайн-система
 * v2), а синий/оранжевый здесь значит «раздел курса / практика».
 * Прогресс — крупным числом и полоской, без кольца (белое кольцо при 0% было
 * не видно). Цвета листа: синий #2F5BEA, подложка #EAF0FD, оранжевый
 * #F28C28, подложка #FDE7D2; числа — тёмные оттенки (≥ 4.5:1).
 */
const CARD_TONE = {
  course:   { bg: 'bg-[#EAF0FD]', art: 'text-[#2F5BEA]', bar: 'bg-[#2F5BEA]', pct: 'text-[#1F45C8]', tag: 'text-[#1F45C8]' },
  practice: { bg: 'bg-[#FDE7D2]', art: 'text-[#F28C28]', bar: 'bg-[#F28C28]', pct: 'text-[#8A4A08]', tag: 'text-[#8A4A08]' },
} as const

function ModuleBigCard({
  mod,
  onClick,
}: {
  mod: ModuleProgress
  onClick: () => void
}) {
  // §141. Считаем ТЕМЫ, а не задания. §280: доля ПРОЙДЕННЫХ тем, а не открытых.
  const counters     = mod.counters
  const submittedCnt = mod.topics.filter(t => t.hw_status === 'submitted').length
  const pct          = donePercent(counters)
  const isDone       = isCompleted(counters)
  const practice     = moduleIsPractice(mod.title, mod.order_index)
  const tone         = CARD_TONE[practice ? 'practice' : 'course']

  return (
    <button
      onClick={onClick}
      data-testid="module-card"
      data-practice={practice || undefined}
      className={cn(
        'group relative w-full overflow-hidden rounded-card p-5 text-left text-graphite-900 shadow-card transition-all duration-200',
        'hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        tone.bg,
      )}
    >
      <ModuleArt
        kind={moduleArtKey(mod.title)}
        className={cn('pointer-events-none absolute -right-4 top-8 h-32 w-40 opacity-25 transition-transform duration-300 group-hover:scale-105', tone.art)}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn('rounded-full bg-white px-2.5 py-0.5 text-xs font-extrabold', tone.tag)} data-testid="module-tag">
            {moduleTag(mod.title, mod.order_index)}
          </span>
          {isDone && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gold-300 px-2.5 py-0.5 text-xs font-extrabold text-graphite-900">
              <Check size={12} strokeWidth={3} /> Завершён
            </span>
          )}
          {submittedCnt > 0 && !isDone && (
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-graphite-700">
              {submittedCnt} на проверке
            </span>
          )}
        </div>
        <span className={cn('text-[28px] font-extrabold leading-none tabular-nums', tone.pct)} data-testid="module-percent">{pct}%</span>
      </div>

      <h3 className="relative mt-3 max-w-[78%] text-lg font-extrabold leading-snug">{moduleCardTitle(mod.title)}</h3>

      <div className="relative mt-5">
        <div
          className="h-2 overflow-hidden rounded-full bg-white"
          role="progressbar"
          aria-label="Пройдено тем"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={cn('h-full rounded-full transition-all duration-500', tone.bar)} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between gap-2 text-[13px] text-graphite-500">
          <span data-testid="module-topics-counter">{doneLabel(counters)}</span>
          <span className="flex shrink-0 items-center gap-1 font-bold text-graphite-900">
            Открыть <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
        {/* Домашние задания — отдельной строкой (§141). */}
        <div className="mt-0.5 text-[13px] text-graphite-500">
          <span data-testid="module-homework-counter">{homeworkLabel(counters)}</span>
        </div>
      </div>
    </button>
  )
}

// ─── МОДУЛЬ РАБОТ (§259) ──────────────────────────────────────────────────────

/** Окна работ по теме — из `my_course_assessments` (есть, только когда RPC ответила). */
type WorksByTopic = ReadonlyMap<string, AssessmentWork>

/** Сколько работ показать в самой карточке; остальные — «ещё N» и внутри модуля. */
const WORKS_IN_CARD = 4

/**
 * §259 (решение владельца 02.10). Модуль, где все темы — работы по времени,
 * снова стоит карточкой в программе, как остальные (§241 его прятал). Внутри —
 * только работы: название и когда проводится. Без оценок, без прогресса
 * «N из M тем» и без «тем» вообще — подпись «2 работы». Счётчики модуля
 * (§141) не пересчитываются: карточка их просто не показывает.
 */
function ModuleWorksCard({ mod, works, onClick }: { mod: ModuleProgress; works: WorksByTopic; onClick: () => void }) {
  const shown = mod.topics.slice(0, WORKS_IN_CARD)
  const rest  = mod.topics.length - shown.length
  return (
    <button
      onClick={onClick}
      data-testid="module-works-card"
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-primary-900 bg-white text-left transition-all duration-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <div className="flex h-full flex-col gap-3 bg-gradient-to-br from-primary-950 to-primary-800 p-5 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20 text-sm font-bold">{mod.order_index}</span>
        </div>
        <h3 className="text-base font-bold leading-snug">{mod.title}</h3>
        <ul className="flex flex-col gap-1.5">
          {shown.map(t => {
            const when = workWhenShort(works.get(t.id))
            return (
              <li key={t.id} data-testid="module-works-item" className="flex items-center justify-between gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 truncate">{t.title}</span>
                {when && <span className="shrink-0 tabular-nums text-white/80">{when}</span>}
              </li>
            )
          })}
        </ul>
        {rest > 0 && <p className="text-xs text-white/70">и ещё {rest}</p>}
        <div className="mt-auto flex justify-between text-xs text-white/75">
          <span data-testid="module-works-count">{worksCountLabel(mod.topics.length)}</span>
          <span className="flex items-center gap-1">
            Открыть <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </button>
  )
}

/**
 * Работа внутри модуля работ: тип, название, когда (или почему закрыта). Ни
 * оценки, ни статуса сдачи (§259) — клик ведёт на страницу темы, там всё есть.
 * Закрытая тема не кликается — то же правило, что у тем (`topicAvailability`).
 */
function WorkItem({ topic, work, view, onOpen }: { topic: TopicProgress; work: AssessmentWork | undefined; view: CourseView; onOpen: () => void }) {
  const isLocked = !isTopicOpen(topic)
  const when     = workWhenLabel(work)
  const note     = isLocked ? topicClosedLabel(topic) : when ? null : 'время ещё не назначено'
  return (
    <div
      role={isLocked ? 'listitem' : 'button'}
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked || undefined}
      onClick={() => !isLocked && onOpen()}
      onKeyDown={e => !isLocked && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      data-testid="works-module-row"
      data-view={view}
      className={cn(
        'border bg-white transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        isLocked ? 'cursor-default border-gray-100 opacity-60' : 'cursor-pointer border-gray-200 hover:border-primary-300 hover:shadow-md',
        view === 'list' ? 'flex items-center gap-3 rounded-xl px-4 py-3' : 'flex flex-col gap-2 rounded-2xl p-4',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold leading-snug', isLocked ? 'text-gray-400' : 'text-gray-800')}>
          {isLocked && <Lock size={10} className="mb-0.5 mr-1 inline text-gray-300" aria-hidden />}
          <TopicKindMark kind={topic.kind} className="mr-1.5" />
          <LessonFormatMark format={topic.lesson_format} kind={topic.kind} className="mr-1.5" />
          {topic.title}
        </p>
        {when && <p className="mt-1 text-xs tabular-nums text-gray-600" data-testid="works-module-when">{when}</p>}
        {note && <p className="mt-0.5 text-xs text-gray-400">{note}</p>}
      </div>
      {!isLocked && (
        <span className={cn('flex items-center gap-1 text-xs font-medium text-primary-600', view === 'cards' && 'mt-auto')}>
          {view === 'cards' && 'Открыть'}
          <ChevronRight size={14} aria-hidden />
        </span>
      )}
    </div>
  )
}

// ─── TOPIC CARD (Level 2) ─────────────────────────────────────────────────────

// §274. Карточка урока вида «Карточки» — `components/courseProgram/LessonCard`:
// превью видео, плашки «что внутри», строка срока/состояния. Прежняя
// `TopicCard` с полосой-заголовком и кнопкой «Сдать ДЗ» ушла целиком.

// ─── List-view state config ───────────────────────────────────────────────────

const LIST_STATE: Record<string, {
  row: string; numBg: string; titleCls: string
  statusLabel: string | null; statusCls: string; icon: React.ReactNode
}> = {
  locked: {
    row: 'bg-gray-50 border-gray-100 opacity-60',
    numBg: 'bg-gray-200 text-gray-400', titleCls: 'text-gray-400',
    statusLabel: 'Закрыт', statusCls: 'bg-gray-100 text-gray-400',
    icon: <Lock size={12} className="text-gray-300" />,
  },
  accepted: {
    row: 'bg-green-50 border-green-200 hover:border-green-300',
    numBg: 'bg-green-500 text-white', titleCls: 'text-gray-800',
    statusLabel: 'Пройдено', statusCls: 'bg-green-100 text-green-700',
    icon: <CheckCircle size={12} className="text-green-600" />,
  },
  submitted: {
    row: 'bg-sky-50/80 border-sky-200 hover:border-sky-300',
    numBg: 'bg-sky-500 text-white', titleCls: 'text-gray-800',
    statusLabel: 'На проверке', statusCls: 'bg-sky-100 text-sky-700',
    icon: <Clock size={12} className="text-sky-600" />,
  },
  returned: {
    row: 'bg-orange-50 border-orange-200 hover:border-orange-300',
    numBg: 'bg-orange-400 text-white', titleCls: 'text-gray-800',
    statusLabel: 'Доработать', statusCls: 'bg-orange-100 text-orange-700',
    icon: <RotateCcw size={12} className="text-orange-600" />,
  },
  draft: {
    row: 'bg-sky-50/40 border-sky-200 hover:border-sky-300',
    numBg: 'bg-sky-400 text-white', titleCls: 'text-gray-800',
    statusLabel: 'Черновик', statusCls: 'bg-sky-100 text-sky-700',
    icon: <FileEdit size={12} className="text-sky-500" />,
  },
  not_started: {
    row: 'bg-blue-50/40 border-blue-200 hover:border-blue-300',
    numBg: 'bg-blue-100 text-blue-600', titleCls: 'text-gray-800',
    // §182. «В работе» стояло у КАЖДОЙ темы, которую ученик просто ещё не
    // трогал, — плашка у всех подряд не значит ничего и только шумит. Цвет
    // строки и иконку оставили: они отличают «есть ДЗ» от «нечего сдавать».
    // Призыв к действию для этого состояния — кнопка «Сдать ДЗ».
    statusLabel: null, statusCls: 'bg-blue-100 text-blue-700',
    icon: <Play size={12} className="text-blue-500" />,
  },
  none: {
    row: 'bg-white border-gray-200 hover:border-primary-300',
    numBg: 'bg-gray-100 text-gray-500', titleCls: 'text-gray-800',
    statusLabel: null, statusCls: '',
    icon: <BookOpen size={12} className="text-gray-400" />,
  },
}

// ─── Три сигнала под названием темы (§182) ───────────────────────────────────

/**
 * Под названием темы раньше висели семь плашек рубрик в две строки — «Конспект»,
 * «Задачи», «Рабочий лист задач», «ДЗ», «Решение ДЗ»… Они отвечают на вопрос
 * «что внутри темы», а ученик на этом экране решает другой: «что мне здесь
 * делать и сколько осталось». Поэтому рубрика БЕЗ состояния (есть конспект,
 * есть рабочий лист) — это содержимое, оно и так видно при открытии темы, и
 * ушло в одну серую строку «ещё N материалов» без перечисления. Остались три
 * сигнала с состоянием: видео, задачи «N из M», ДЗ.
 *
 * Плашка «Решение ДЗ» ушла не только ради краткости: она обещала ученику, что
 * разбор существует, хотя до сдачи ДЗ он закрыт (`GATED_SECTION` на `TopicPage`).
 * Обещание «решение есть» до сдачи подталкивает списать. Правило открытия
 * внутри темы не тронуто — там всё верно.
 */
const OTHER_SECTIONS: readonly TopicSection[] = [
  'theory', 'notes', 'tasks', 'task_solution',
  'worksheet_tasks', 'worksheet_homework', 'solution', 'test',
]

/** Нейтральный сигнал: состояние есть, но радоваться нечему. */
const SIGNAL_NEUTRAL = 'bg-gray-100 text-gray-600'

export interface Signal { label: string; cls: string; icon: React.ReactNode }

/**
 * Состояние ДЗ словами. Палитра — из LIST_STATE той же страницы: вторая на
 * те же пять состояний разошлась бы с первой на первой же правке.
 */
function homeworkSignal(topic: TopicProgress): Signal | null {
  if (!topic.hw_id) return null
  // §266. У тренировочного урока ДЗ — задачи с автопроверкой: «сдать» там нечего,
  // их решают в уроке, оценку ставит сайт.
  if (topic.lesson_format === 'training') {
    return topic.hw_status === 'accepted'
      ? { label: topic.hw_score != null ? `Задачи: ${topic.hw_score}/100` : 'Задачи решены', cls: LIST_STATE.accepted.statusCls, icon: <CheckCircle size={10} /> }
      : { label: 'Задачи с автопроверкой', cls: LIST_STATE.not_started.statusCls, icon: <ListChecks size={10} /> }
  }
  switch (topic.hw_status) {
    case 'submitted':
      return { label: 'ДЗ на проверке', cls: LIST_STATE.submitted.statusCls, icon: <Clock size={10} /> }
    case 'returned':
      return { label: 'ДЗ вернули', cls: LIST_STATE.returned.statusCls, icon: <RotateCcw size={10} /> }
    case 'draft':
      return { label: 'ДЗ черновик', cls: LIST_STATE.draft.statusCls, icon: <FileEdit size={10} /> }
    case 'accepted':
      return {
        label: topic.hw_score != null && topic.hw_max != null
          ? `ДЗ: ${topic.hw_score}/${topic.hw_max} б`
          : 'ДЗ принято',
        cls: LIST_STATE.accepted.statusCls,
        icon: <CheckCircle size={10} />,
      }
    default:
      return { label: 'ДЗ не сдано', cls: LIST_STATE.not_started.statusCls, icon: <Upload size={10} /> }
  }
}

/**
 * «Задачи N из M» — задачи к уроку (§162/§164). Числа даёт сервер (§182) той же
 * формулой, что лента задач темы (§175) и таблица преподавателя (§174).
 * Пока ученик не решил ни одной, «0 из 7» читается как упрёк — пишем «Задачи: 7».
 */
function tasksSignal(topic: TopicProgress): Signal | null {
  if (topic.tasks_total <= 0) return null
  const done = topic.tasks_closed >= topic.tasks_total
  return {
    label: topic.tasks_closed > 0
      ? `Задачи ${topic.tasks_closed} из ${topic.tasks_total}`
      : `Задачи: ${topic.tasks_total}`,
    cls: done ? LIST_STATE.accepted.statusCls : SIGNAL_NEUTRAL,
    icon: <ClipboardList size={10} />,
  }
}

function SignalPill({ signal }: { signal: Signal }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
      signal.cls,
    )}>
      {signal.icon}{signal.label}
    </span>
  )
}

/**
 * Одна строка сигналов — и в списке, и в карточке. Второго набора нет.
 *
 * §250. Её же рисует вкладка «Курс» у учителя (тема глазами ученика). Там
 * сигнал ДЗ — не «моё состояние» (у учителя своей работы нет, в предпросмотре
 * он всегда «не сдано»), а срок задания: его передают `homework`. Без пропа —
 * как было у ученика.
 */
export function TopicSignals({ topic, homework }: { topic: TopicProgress; homework?: Signal | null }) {
  const hasVideo = topic.sections.has('video')
  const tasks    = tasksSignal(topic)
  const hw       = homework !== undefined ? homework : homeworkSignal(topic)
  const rest     = OTHER_SECTIONS.filter(s => topic.sections.has(s)).length

  if (!hasVideo && !tasks && !hw && rest === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5" data-testid="topic-signals">
      {hasVideo && <SignalPill signal={{ label: 'Видео', cls: SIGNAL_NEUTRAL, icon: <Play size={10} /> }} />}
      {tasks && <SignalPill signal={tasks} />}
      {hw && <SignalPill signal={hw} />}
      {rest > 0 && (
        // Не кликается и не перечисляет: это содержимое темы, оно видно внутри.
        <span className="text-[11px] text-gray-400">
          ещё {rest} {plural(rest, 'материал', 'материала', 'материалов')}
        </span>
      )}
    </div>
  )
}

// ─── TopicListRow ─────────────────────────────────────────────────────────────

function TopicListRow({
  topic, index, onOpen, onOpenHomework,
}: {
  topic: TopicProgress
  index: number
  onOpen: () => void
  onOpenHomework: () => void
}) {
  // То же общее правило, что и у карточки выше — src/lib/topicAvailability.ts
  const isLocked    = !isTopicOpen(topic)
  const closedLabel = topicClosedLabel(topic)

  const stateKey = isLocked ? 'locked'
    : topic.hw_status === 'accepted'      ? 'accepted'
    : topic.hw_status === 'submitted'     ? 'submitted'
    : topic.hw_status === 'returned'      ? 'returned'
    : topic.hw_status === 'draft'         ? 'draft'
    : topic.hw_status === 'not_started'   ? 'not_started'
    : 'none'

  const st = LIST_STATE[stateKey]
  const isDone = topic.hw_status === 'accepted'
  const canSubmit = !isLocked && topic.hw_id &&
    (topic.hw_status === 'not_started' || topic.hw_status === 'draft' || topic.hw_status === 'returned')

  return (
    <div
      role={isLocked ? 'listitem' : 'button'}
      tabIndex={isLocked ? -1 : 0}
      aria-disabled={isLocked || undefined}
      onClick={() => !isLocked && onOpen()}
      onKeyDown={e => !isLocked && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      className={cn(
        'rounded-xl border px-4 py-3 transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        isLocked ? 'cursor-default' : 'cursor-pointer',
        st.row,
        'flex flex-col sm:flex-row sm:items-center sm:gap-4 gap-2',
      )}
      data-testid="topic-list-row"
      data-status={stateKey}
    >
      {/* ── Mobile top / Desktop left: number + icon ── */}
      <div className="flex items-center gap-2 sm:flex-col sm:items-center sm:w-10 sm:gap-1 sm:shrink-0">
        <div className={cn(
          'w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0',
          st.numBg
        )}>
          {isDone ? <Check size={14} /> : <span>{index + 1}</span>}
        </div>

        {/* Status icon — desktop */}
        <div className="hidden sm:flex" aria-hidden>{st.icon}</div>

        {/* Status pill — mobile */}
        {st.statusLabel && (
          <span className={cn(
            'sm:hidden text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5',
            st.statusCls
          )} role="status">
            {st.icon}{st.statusLabel}
          </span>
        )}

        {/* Arrow — mobile */}
        {!isLocked && (
          <ChevronRight size={14} className="sm:hidden ml-auto text-gray-300" aria-hidden />
        )}
      </div>

      {/* ── Center: title + badges ── */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold leading-snug', isLocked ? 'text-gray-400' : st.titleCls)}>
          {isLocked && <Lock size={10} className="inline mr-1 mb-0.5 text-gray-300" aria-hidden />}
          <TopicKindMark kind={topic.kind} className="mr-1.5" />
          <LessonFormatMark format={topic.lesson_format} kind={topic.kind} className="mr-1.5" />
          {topic.title}
        </p>

        {/* Результат теста */}
        {!isLocked && topic.test_status === 'completed' && (
          <p className="text-xs font-semibold text-indigo-700 mt-0.5">
            Тест: {topic.test_points ?? 0}/{topic.test_max_points ?? 0} б.
            {testPercent(topic.test_points, topic.test_max_points) != null &&
              ` · ${testPercent(topic.test_points, topic.test_max_points)}%`}
          </p>
        )}
        {!isLocked && topic.test_status === 'not_started' && (
          <p className="text-xs text-indigo-500 mt-0.5">Тест не пройден</p>
        )}

        {/* Три сигнала «что здесь делать» вместо перечня рубрик (§182) */}
        {!isLocked && <TopicSignals topic={topic} />}

        {isLocked && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {closedLabel}
          </p>
        )}
      </div>

      {/* ── Right: status + buttons ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Балл за ДЗ стоял здесь вторым числом рядом с сигналом «ДЗ: 18/20 б»
            (§182) — одна и та же цифра дважды в одной строке. Осталась одна. */}

        {/* Status badge — desktop */}
        {st.statusLabel && (
          <span className={cn(
            'hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
            st.statusCls
          )} role="status">
            {st.icon}{st.statusLabel}
          </span>
        )}

        {/* Submit HW — сдача живёт на странице темы */}
        {canSubmit && (
          <button
            onClick={e => { e.stopPropagation(); onOpenHomework() }}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[36px]',
              topic.hw_status === 'returned'
                ? 'text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100'
                : 'text-green-700 bg-green-50 border border-green-200 hover:bg-green-100'
            )}
            aria-label={topic.lesson_format === 'training' ? 'Решить задачи с автопроверкой' : topic.hw_status === 'returned' ? 'Переделать домашнее задание' : 'Сдать домашнее задание'}
          >
            <Upload size={11} />
            <span className="hidden sm:inline">
              {topic.lesson_format === 'training' ? 'Решить задачи' : topic.hw_status === 'returned' ? 'Переделать' : topic.hw_status === 'draft' ? 'Дособрать' : 'Сдать ДЗ'}
            </span>
          </button>
        )}

        {/* Open button */}
        {!isLocked && (
          <button
            onClick={e => { e.stopPropagation(); onOpen() }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[36px] text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100"
            aria-label={`Открыть тему ${topic.title}`}
          >
            {topic.sections.has('video') && <Play size={11} />}
            Открыть
          </button>
        )}

        <ChevronRight size={14} className="hidden sm:block text-gray-300" aria-hidden />
      </div>
    </div>
  )
}

// ─── ViewToggle ───────────────────────────────────────────────────────────────

function ViewToggle({ view, onChange }: { view: CourseView; onChange: (v: CourseView) => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5"
      role="group"
      aria-label="Вид отображения"
      data-testid="view-toggle"
    >
      <button
        onClick={() => onChange('list')}
        data-testid="view-toggle-list"
        aria-pressed={view === 'list'}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
          view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        )}
      >
        <LayoutList size={13} />Список
      </button>
      <button
        onClick={() => onChange('cards')}
        data-testid="view-toggle-cards"
        aria-pressed={view === 'cards'}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
          view === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        )}
      >
        <LayoutGrid size={13} />Карточки
      </button>
    </div>
  )
}

// ─── STAFF CARDS ──────────────────────────────────────────────────────────────

function StaffCard({
  person,
  role,
}: {
  person: StaffInfo | null
  role: 'Преподаватель' | 'Куратор'
}) {
  const initials = person?.full_name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?'

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 flex-1 min-w-0">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0 overflow-hidden">
        {person?.avatar_url
          ? <img src={person.avatar_url} alt="" className="w-full h-full object-cover" />
          : <span className="text-sm font-bold text-primary-600">{person ? initials : '—'}</span>
        }
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{role}</div>
        {person ? (
          <>
            <div className="text-sm font-semibold text-gray-900 truncate leading-tight">{person.full_name}</div>
            {(person.phone || person.email) && (
              <div className="text-xs text-gray-400 truncate mt-0.5">
                {person.phone || person.email}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 italic">Не назначен</div>
        )}
      </div>

      {/* Contact button */}
      {person && (
        <a
          href={`mailto:${person.email}`}
          className="w-11 h-11 sm:w-auto sm:h-auto shrink-0 flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
          title={`Написать ${person.full_name}`}
        >
          <MessageSquare size={12} />
          <span className="hidden sm:inline">Написать</span>
        </a>
      )}
    </div>
  )
}

// ─── БЛОК «ЗАДАНИЯ» ───────────────────────────────────────────────────────────
// Сводка по всем темам курса: ДЗ темы (topic_homework) и тест темы (привязка из
// банка). Сдача и прохождение живут на странице темы — здесь только статус и
// переход, чтобы не заводить вторую точку сдачи.

type FlatTask = TopicProgress & { moduleTitle: string }

function HwStatusBadge({ status, score, max }: { status: string; score: number | null; max: number | null }) {
  const cfg: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    not_started:   { label: 'Не сдано',    cls: 'bg-gray-100 text-gray-500',    icon: <AlertCircle size={11} /> },
    draft:         { label: 'Черновик',    cls: 'bg-sky-100 text-sky-700',      icon: <FileEdit size={11} /> },
    submitted:     { label: 'На проверке', cls: 'bg-blue-100 text-blue-700',    icon: <Clock size={11} /> },
    accepted:      { label: score != null && max != null ? `Принято · ${score}/${max} б.` : 'Принято', cls: 'bg-green-100 text-green-700', icon: <CheckCircle size={11} /> },
    returned:      { label: 'Доработать',  cls: 'bg-orange-100 text-orange-700', icon: <RotateCcw size={11} /> },
  }
  const c = cfg[status] || { label: status, cls: 'bg-gray-100 text-gray-400', icon: null }
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap', c.cls)}>
      {c.icon}{c.label}
    </span>
  )
}

function TestStatusBadge({ topic }: { topic: TopicProgress }) {
  if (!topic.test_assignment_id) return null
  if (topic.test_status === 'completed') {
    const pct = testPercent(topic.test_points, topic.test_max_points)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700">
        <BarChart3 size={11} />
        Тест: {topic.test_points ?? 0}/{topic.test_max_points ?? 0} б.{pct != null ? ` · ${pct}%` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap bg-indigo-50 text-indigo-600">
      <BarChart3 size={11} />
      {topic.test_status === 'in_progress' ? 'Тест начат' : 'Тест не пройден'}
    </span>
  )
}

function HomeworkBlock({
  modules,
  onOpenTopic,
}: {
  modules: ModuleProgress[]
  onOpenTopic: (t: TopicProgress) => void
}) {
  const flatTasks = useMemo<FlatTask[]>(() => {
    const list: FlatTask[] = []
    for (const mod of modules) {
      for (const t of mod.topics) {
        if (t.assignment_count > 0) list.push({ ...t, moduleTitle: mod.title })
      }
    }
    // Просроченное несданное — вверх, дальше по дедлайну, темы без дедлайна в конце
    return list.sort((a, b) => {
      const aOverdue = !!a.hw_due_at && isOverdue(a.hw_due_at) && a.hw_status !== 'accepted' && a.hw_status !== 'submitted'
      const bOverdue = !!b.hw_due_at && isOverdue(b.hw_due_at) && b.hw_status !== 'accepted' && b.hw_status !== 'submitted'
      if (aOverdue && !bOverdue) return -1
      if (!aOverdue && bOverdue) return 1
      if (!a.hw_due_at && !b.hw_due_at) return a.order_index - b.order_index
      if (!a.hw_due_at) return 1
      if (!b.hw_due_at) return -1
      return a.hw_due_at.localeCompare(b.hw_due_at)
    })
  }, [modules])

  if (flatTasks.length === 0) return null

  const notSubmitted = flatTasks.filter(t => t.hw_status === 'not_started' || t.hw_status === 'draft' || t.hw_status === 'returned').length
  const submitted    = flatTasks.filter(t => t.hw_status === 'submitted').length
  const checked      = flatTasks.filter(t => t.hw_status === 'accepted').length
  const testsLeft    = flatTasks.filter(t => t.test_assignment_id && t.test_status !== 'completed').length

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
        <ClipboardList size={20} className="text-primary-600" />
        Задания
      </h2>

      {/* StatCards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Не сдано"     value={notSubmitted} icon={<AlertCircle size={18} />} color="red" />
        <StatCard title="На проверке"  value={submitted}    icon={<Clock size={18} />}       color="orange" />
        <StatCard title="Проверено"    value={checked}      icon={<CheckCircle size={18} />} color="green" />
        <StatCard title="Тестов ждёт"  value={testsLeft}    icon={<BarChart3 size={18} />}   color="blue" />
      </div>

      {/* Flat list */}
      <div className="space-y-3">
        {flatTasks.map(task => {
          const overdue     = !!task.hw_due_at && isOverdue(task.hw_due_at)
          const overdueFlag = overdue && task.hw_status !== 'accepted' && task.hw_status !== 'submitted'

          return (
            <div
              key={task.id}
              className={cn(
                'rounded-2xl border bg-white p-4 transition-all',
                overdueFlag ? 'border-red-200 bg-red-50' : 'border-gray-200'
              )}
              data-testid="student-task-row"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  {/* Title + module breadcrumb */}
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-0.5">
                    <span>{task.moduleTitle}</span>
                    <ChevronRight size={10} />
                    <span>{task.title}</span>
                  </div>

                  {task.hw_title && (
                    <p className="text-sm font-semibold text-gray-800">{task.hw_title}</p>
                  )}
                  {task.hw_instructions && (
                    <p className="text-sm text-gray-600 mt-1 mb-1.5 whitespace-pre-line">{task.hw_instructions}</p>
                  )}

                  {/* Meta row */}
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mt-1">
                    {task.hw_due_at && (
                      <span className={cn('flex items-center gap-1', overdueFlag && 'text-red-500 font-semibold')}>
                        <Clock size={11} />
                        {overdueFlag ? 'Просрочено · ' : 'Сдать до '}
                        {formatDate(task.hw_due_at)}
                      </span>
                    )}
                    {task.hw_grade_scale && <span>Шкала: {GRADE_SCALE_LABEL[task.hw_grade_scale]}</span>}
                    {task.test_title && <span>Тест: {task.test_title}</span>}
                  </div>

                  {/* Комментарий преподавателя к последнему вердикту */}
                  {task.hw_comment && (
                    <div className="mt-2.5 flex items-start gap-2 p-2.5 bg-blue-50 rounded-xl border border-blue-100">
                      <MessageSquare size={13} className="text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-blue-800 leading-relaxed">
                        <span className="font-semibold">Комментарий: </span>
                        {task.hw_comment}
                      </p>
                    </div>
                  )}
                </div>

                {/* Right column: статусы + переход в тему */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {task.hw_status && (
                    <HwStatusBadge
                      status={task.hw_status}
                      score={task.hw_score}
                      max={task.hw_max}
                    />
                  )}
                  <TestStatusBadge topic={task} />
                  <button
                    onClick={() => onOpenTopic(task)}
                    className="min-h-11 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100"
                  >
                    <Upload size={12} />
                    Открыть тему
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentCoursePage() {
  const { groupId }  = useParams<{ groupId?: string }>()
  const navigate     = useNavigate()
  const preview      = usePreviewMode()
  const { course, modules: programModules, mockExams = [], loading, error } = useStudentCourseProgram(groupId)
  // §241. Раздел «Контрольные, самостоятельные и пробники»: у ученика своя RPC;
  // в предпросмотре персонала её нет (она про «мою попытку») — там прежний
  // блок «Пробники» по расписанию, как в §224.2.
  const assessments = useMyCourseAssessments(groupId, !preview)
  const assessmentsReady = assessments.status === 'ready' && !!assessments.data
    && (assessments.data.works.length > 0 || assessments.data.mocks.length > 0)
  // §259. Модуль, где все темы — работы по времени, — карточкой «только работы»
  // (без оценок). В модулях с уроками работ нет, как с §241: их место — раздел
  // сверху (пока ждут) и модуль работ; прячем, только когда RPC ответила —
  // иначе (миграция не применена, сбой, предпросмотр) темы остаются на месте.
  // Счётчики модулей и курса не трогаем (§141/§152/§162): меняется только список.
  const modules = useMemo(
    () => studentProgramModules(programModules, assessmentsReady),
    [assessmentsReady, programModules],
  )
  // Когда проводится работа — из той же RPC; без неё — просто названия.
  const worksByTopic = useMemo<WorksByTopic>(
    () => new Map((assessments.data?.works ?? []).map(w => [w.topic_id, w])),
    [assessments.data],
  )

  const [selectedModule, setSelectedModule] = useState<ModuleProgress | null>(null)
  const [view,           setView]           = useState<CourseView>(getViewPref)

  function handleViewChange(v: CourseView) {
    setView(v)
    saveViewPref(v)
  }

  // Сдача ДЗ и прохождение теста живут на странице темы — сюда ведут все кнопки
  const openTopic = (topic: TopicProgress) => navigate(`/my-course/${groupId}/topic/${topic.id}`)
  // §221/§224: бланк, сдача и результат пробника — на его странице; в программе
  // пробники — своим разделом «Пробники» над разделами курса.
  const openMock = (examId: string) => navigate(`/my-course/${groupId}/mock/${examId}`)

  // §224.1. Кнопка «Открыть пробник» из Telegram ведёт на страницу КУРСА с
  // ?mock=<id>, а не прямо на пробник: курс есть в любой версии сайта, и
  // ученик не попадёт на «страница не найдена», если версия ещё без
  // пробников. Здесь — сразу на страницу пробника (replace: «назад» не
  // вернёт на промежуточный курс). Чужой или несуществующий id просто
  // откроет страницу пробника с её собственной ошибкой прав.
  const [searchParams] = useSearchParams()
  const mockFromLink = searchParams.get('mock')
  useEffect(() => {
    if (groupId && mockFromLink && /^[0-9a-f-]{36}$/i.test(mockFromLink)) {
      navigate(`/my-course/${groupId}/mock/${mockFromLink}`, { replace: true })
    }
  }, [groupId, mockFromLink, navigate])

  // Reset selected module when course changes
  useEffect(() => { setSelectedModule(null) }, [groupId])

  // §224.2. Одно «сейчас» по часам базы на баннер и раздел «Пробники»: у
  // идущего пробника главная кнопка — в баннере, в разделе — тихая ссылка.
  const mockNow = useServerNow(mockExams[0]?.server_now ?? assessments.data?.serverNow ?? null)
  const mockBannerOpen = mockAlert(mockExams, mockNow)?.kind === 'open'

  // Курс = сумма разделов по тому же правилу, иначе цифры на двух уровнях
  // разойдутся (§141).
  const courseCounters = sumCounters(programModules.map(module => module.counters))
  const overallPct     = donePercent(courseCounters)

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
      <AlertCircle size={32} className="opacity-60" />
      <p>{error}</p>
    </div>
  )

  if (!course) return (
    <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
      <BookOpen size={40} className="opacity-30" />
      <p>{preview ? 'Курс не найден или это каркас — у учеников его нет' : 'Вы не записаны ни в одну группу'}</p>
    </div>
  )

  // ── Find current module data (keep live) ─────────────────────────────────────
  const activeMod = selectedModule
    ? modules.find(m => m.id === selectedModule.id) ?? selectedModule
    : null
  // §259. Внутри модуля работ — без «тем» и прогресса: только работы.
  const activeWorksOnly = !!activeMod && isWorksOnlyModule(activeMod)

  return (
    <div className="space-y-6 max-w-5xl">

      {/* §282. Курс платный и подписка не действует — сказать прямо, а не
          показывать пустую программу (RLS отдаёт пусто). */}
      {!preview && <SubscriptionLockBanner courseId={course.id} />}

      {/* §224.2. Идущий пробник — сверху в ЛЮБОМ состоянии страницы, и при
          открытом разделе тоже. Раньше раздел «Пробники» стоял только на
          главной курса: в курсе с одним разделом ученик открывал раздел, потом
          тему — и пробник не встречал нигде (жалоба владельца 26.09). */}
      {groupId && <MockExamAlert exams={mockExams} groupId={groupId} now={mockNow} />}

      {/* ── Back navigation ── */}
      {activeMod ? (
        <button
          onClick={() => setSelectedModule(null)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={15} />{course.title}
        </button>
      ) : (
        <Link to="/my-course"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft size={15} />Все курсы
        </Link>
      )}

      {/* ── Course header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1 flex-wrap">
            <GraduationCap size={13} />
            {SUBJECT_LABELS[course.subject] || course.subject}
            <span className="text-gray-200">·</span>
            {EXAM_LABELS[course.exam_type] || course.exam_type}
            <span className="text-gray-200">·</span>
            {course.group_name}
            {activeMod && (
              <>
                <span className="text-gray-200">·</span>
                <span className="text-primary-600 font-medium">{activeMod.title}</span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 break-words">
            {activeMod ? activeMod.title : course.title}
          </h1>
        </div>

        {/* Overall progress pill — у модуля работ его нет (§259: без «N из M тем») */}
        {!activeWorksOnly && (
        <div className="w-full sm:w-auto flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 sm:shrink-0">
          <Ring pct={activeMod ? donePercent(activeMod.counters) : overallPct} size={40} stroke={4} />
          <div>
            <div data-testid="course-topics-counter" className="text-xs font-semibold text-gray-700">
              {doneLabel(activeMod ? activeMod.counters : courseCounters)}
            </div>
            <div className="text-[10px] text-gray-400">
              {activeMod ? 'в разделе' : 'всего'}
            </div>
            <div data-testid="course-homework-counter" className="mt-0.5 text-[10px] text-gray-500">
              {homeworkLabel(activeMod ? activeMod.counters : courseCounters)}
            </div>
          </div>
          {!activeMod && (
            <div className="flex items-center gap-3 text-xs text-gray-400 border-l border-gray-100 pl-3">
              <span className="flex items-center gap-1">
                <Clock size={11} className="text-blue-400" />
                {programModules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'submitted').length, 0)}
              </span>
              <span className="flex items-center gap-1">
                <RotateCcw size={11} className="text-orange-400" />
                {programModules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'returned').length, 0)}
              </span>
            </div>
          )}
        </div>
        )}
      </div>

      {/* §241. Раздел «Контрольные, самостоятельные и пробники» — над разделами
          курса и над планом недели, вместо прежнего блока «Пробники» (§224).
          Пока его данных нет (загрузка) — ничего; RPC недоступна (миграция не
          применена, сбой, предпросмотр) — прежний блок «Пробники». */}
      {!activeMod && groupId && assessmentsReady && assessments.data && (
        <CourseAssessmentsSection data={assessments.data} groupId={groupId} now={mockNow} primaryInBanner={mockBannerOpen} />
      )}
      {!activeMod && (preview || assessments.status === 'error') && (
        <MockExamsSection exams={mockExams} onOpen={openMock} now={mockNow} primaryInBanner={mockBannerOpen} />
      )}

      {/* «Эта неделя» — RPC `student_week_plan()` считает от `auth_student_id()`;
          у персонала её нет, в предпросмотре блок не зовём вовсе (§178). */}
      {!activeMod && !preview && <StudentWeekPlan courseId={course.id} />}

      {/* ══ STAFF CARDS ══ */}
      {!activeMod && (
        <div className="flex flex-col sm:flex-row gap-3">
          <StaffCard person={course.teacher} role="Преподаватель" />
          <StaffCard person={course.curator} role="Куратор" />
        </div>
      )}

      {/* ══ LEVEL 1: MODULE CARDS ══ */}
      {!activeMod && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {modules.map(mod => (
            isWorksOnlyModule(mod) ? (
              <ModuleWorksCard key={mod.id} mod={mod} works={worksByTopic} onClick={() => setSelectedModule(mod)} />
            ) : (
              <ModuleBigCard
                key={mod.id}
                mod={mod}
                onClick={() => setSelectedModule(mod)}
              />
            )
          ))}
        </div>
      )}

      {/* ══ LEVEL 2: TOPIC LIST / CARDS ══ */}
      {activeMod && (
        <div className="space-y-3">
          {/* View toggle header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Склонение по правилам, а не «одна/все остальные»: прежняя
                развилка давала «2 тем в разделе» — с этим ученик и написал
                через «Сообщить о проблеме». */}
            <p className="text-sm text-gray-500" data-testid="module-topics-count">
              {activeWorksOnly ? worksCountLabel(activeMod.topics.length) : pluralTopics(activeMod.topics.length)}&nbsp;в разделе
            </p>
            <ViewToggle view={view} onChange={handleViewChange} />
          </div>

          {activeWorksOnly ? (
            <div
              className={view === 'list' ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'}
              data-testid="works-module-view"
              data-view={view}
            >
              {activeMod.topics.map(topic => (
                <WorkItem key={topic.id} topic={topic} work={worksByTopic.get(topic.id)} view={view} onOpen={() => openTopic(topic)} />
              ))}
            </div>
          ) : view === 'list' ? (
            <div className="space-y-2" data-testid="topics-list-view">
              {activeMod.topics.map((topic, i) => (
                <TopicListRow
                  key={topic.id}
                  topic={topic}
                  index={i}
                  onOpen={() => openTopic(topic)}
                  onOpenHomework={() => openTopic(topic)}
                />
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="topics-cards-view">
              {activeMod.topics.map((topic, i) => (
                <li key={topic.id} className="flex min-w-0">
                  <LessonCard topic={topic} index={i} href={`/my-course/${groupId}/topic/${topic.id}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ══ БЛОК ЗАДАНИЙ (только на главном экране курса) ══ */}
      {!activeMod && (
        <HomeworkBlock
          modules={programModules}
          onOpenTopic={openTopic}
        />
      )}
    </div>
  )
}
