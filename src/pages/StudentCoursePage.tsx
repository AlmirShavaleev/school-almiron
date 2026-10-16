import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookOpen, Clock, ClipboardList,
  GraduationCap, Loader2, Lock, CheckCircle, RotateCcw, AlertCircle,
  Upload, ArrowLeft, ChevronRight, Play,
  LayoutList, LayoutGrid, FileEdit, ListChecks,
} from 'lucide-react'
import { useStudentCourseProgram, type TopicProgress, type ModuleProgress } from '@/hooks/useStudentCourseProgram'
import { TopicKindMark } from '@/components/courseProgram/TopicKindMark'
import { LessonFormatMark } from '@/components/courseProgram/LessonFormatMark'

import { usePreviewMode } from '@/store/staffModeStore'

import { cn } from '@/utils/cn'
import {
  doneLabel, donePercent, homeworkLabel, sumCounters,
} from '@/lib/studentCourseCounters'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'


import { type TopicSection } from '@/lib/topicMaterialItems'
import { isTopicOpen, topicClosedLabel } from '@/lib/topicAvailability'
import { plural, pluralTopics } from '@/lib/plural'
import { MockExamsSection } from '@/components/student/MockExamsSection'
import { CourseAssessmentsSection } from '@/components/student/CourseAssessmentsSection'
import { CourseHero, LessonTiles, PeopleRow, SectionHero, SectionTiles } from '@/components/student/course/CourseScreen'
import { useStudentHomeCourses } from '@/hooks/useStudentHomeCourses'
import { useStudentPathHome } from '@/hooks/useStudentPath'
import { useSubscriptionsEnabled } from '@/hooks/useSubscription'
import { loadCourseExtras, loadOpenByModule, type CourseExtras } from '@/lib/courseMeta'
import { accessLine, courseLadder, publicTitle } from '@/lib/myCourses'
import { hwChips, lessonTile, sectionOpenLine, sectionTiles } from '@/lib/courseScreen'
import { continueHref } from '@/lib/studentHomeCourses'
import { useMyCourseAssessments } from '@/hooks/useCourseAssessments'
import {
  isWorksOnlyModule, studentProgramModules, workWhenLabel, workWhenShort, worksCountLabel, type AssessmentWork,
} from '@/lib/courseAssessments'
import { MockExamAlert } from '@/components/student/MockExamAlert'
import { SubscriptionLockBanner } from '@/components/subscription/SubscriptionLockBanner'
import { useCourseTopicLocks } from '@/hooks/useCourseTopicLocks'
import { Button } from '@/components/ui/Button'
import { useCourseDemo } from '@/hooks/useStudentPath'
import { DEMO_LOCK_NOTE, withDemoLocks } from '@/lib/studentPath'
import { LessonEvents } from '@/components/student/course/LessonEvents'
import { useAuthStore } from '@/store/authStore'
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


// ─── БЛОК «ЗАДАНИЯ» ───────────────────────────────────────────────────────────
// Сводка по всем темам курса: ДЗ темы (topic_homework) и тест темы (привязка из
// банка). Сдача и прохождение живут на странице темы — здесь только статус и
// переход, чтобы не заводить вторую точку сдачи.

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentCoursePage() {
  const { groupId }  = useParams<{ groupId?: string }>()
  const navigate     = useNavigate()
  const preview      = usePreviewMode()
  const { course, modules: programModules, mockExams = [], loading, error } = useStudentCourseProgram(groupId)
  // §288. Курс «по прохождению»: замки уроков и счётчики — уже в программе
  // (useStudentCourseProgram). Здесь — только «Открыт урок «…»» с прошлого визита.
  const profileId = useAuthStore(s => s.profile?.id ?? null)
  const locks = useCourseTopicLocks(course?.id, preview ? null : profileId)
  // «Открыт урок «…»» — теперь модалкой «Урок пройден / открыт следующий» (письмо 16.10).
  // 15.10, владелец: в «урочном» курсе (раздел «Мой курс») блок «Задания» —
  // только ДЗ уроков, открытых ученику сейчас (src/lib/lessonCourses.ts).
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
  // §290-B: пробный период по подписке («демо») — открыты первые 2 урока
  // раздела, остальные — «Доступно по подписке» (решает база, my_course_demo).
  const demo = useCourseDemo(course?.id, !preview)

  // ЛК в стиле лендинга (письмо ЛК_стиль_страница_курса.md, 15.10): шапка с
  // кольцом в два слоя, преподаватель строкой, плитки разделов и уроков.
  // Источники — те же, что у «Моих курсов»: «всего» везде — уроки с ДЗ
  // (student_home_courses), «открыто» — ДЗ открытых тем по разделам.
  const homeCourses = useStudentHomeCourses(preview ? null : profileId)
  const homeProgress = course?.id ? homeCourses.courses?.find(c => c.courseId === course.id) ?? null : null
  const subscriptionsOn = useSubscriptionsEnabled()
  const pathHome = useStudentPathHome(profileId, subscriptionsOn.enabled && !preview)
  const [extras, setExtras] = useState<CourseExtras | null>(null)
  const [openByModule, setOpenByModule] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!course?.id) return
    let alive = true
    Promise.all([loadCourseExtras([course.id]), preview ? Promise.resolve(null) : loadOpenByModule()])
      .then(([ex, open]) => { if (alive) { setExtras(ex); setOpenByModule(open) } })
      .catch(() => { /* шапка без витрины и «открыто» */ })
    return () => { alive = false }
  }, [course?.id, preview])
  // §290-B (тест 12.10): раздел без тем («Раздел 0 · Основной») ученику не
  // показываем — пустая карточка первой в списке только путала.
  const modules = useMemo(
    () => withDemoLocks(studentProgramModules(programModules, assessmentsReady), demo)
      .filter(m => m.topics.length > 0),
    [assessmentsReady, programModules, demo],
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

  // ── Шапка и плитки (ЛК, письмо 15.10) ────────────────────────────────────
  const lessonModules = modules.filter(m => !isWorksOnlyModule(m))
  const courseMode: 'progress' | 'schedule' =
    locks.data?.mode ?? (course?.id && extras?.progressMode.has(course.id) ? 'progress' : 'schedule')
  const courseTitle = course ? publicTitle(course.title, course.id ? extras?.showcase.get(course.id) : null) : ''
  // Прогресса с сервера нет (предпросмотр персонала, сбой RPC) — по программе:
  // те же счётчики §280, что и прежде (пройдено / темы в счёт / открыто).
  const fallbackModules = lessonModules.map(m => ({
    moduleId: m.id, title: m.title, done: m.counters.doneTopics, total: m.counters.countedTopics,
    percent: donePercent(m.counters),
  }))
  const fallbackOpen = new Map(lessonModules.map(m => [m.id, m.counters.openTopics]))
  // «Открыто» по разделу — большее из ДЗ открытых тем (RLS) и счёта программы:
  // ответ topic_homework бывает пуст (сеть, задержка), а «0 можно делать» при
  // ДЗ к сдаче — противоречие на экране.
  // «Можно делать сейчас» не меньше числа ДЗ к сдаче (открытые несданные).
  const courseChips = hwChips(lessonModules)
  const openMerged = new Map(lessonModules.map(m => [m.id, Math.max(openByModule?.get(m.id) ?? 0, m.counters.openTopics)]))
  const ladder = homeProgress
    ? courseLadder(homeProgress.modules, openMerged, homeProgress.done, homeProgress.total)
    : courseLadder(fallbackModules, fallbackOpen, courseCounters.doneTopics, courseCounters.countedTopics)
  const tiles = sectionTiles(lessonModules, homeProgress?.modules ?? fallbackModules, homeProgress ? openMerged : fallbackOpen, courseMode)
  const currentTile = tiles.find(t => t.state === 'current') ?? null
  const lessonsWithHw = homeProgress?.total ?? tiles.reduce((n, t) => n + t.total, 0)
  const programNote = [
    `${tiles.length} ${plural(tiles.length, 'раздел', 'раздела', 'разделов')}`,
    `${lessonsWithHw} ${plural(lessonsWithHw, 'урок', 'урока', 'уроков')} с ДЗ`,
    courseMode === 'schedule' ? 'уроки открываются по расписанию' : 'нажми на раздел, чтобы открыть уроки',
  ].join(' · ')
  const pathSub = course?.id ? pathHome.data?.subscriptions.find(s => s.course_id === course.id) ?? null : null
  const nextLesson = (() => {
    const n = homeProgress?.next
    if (!n || !groupId) return null
    const mod = lessonModules.find(m => m.topics.some(t => t.id === n.topicId))
    const idx = mod ? mod.topics.findIndex(t => t.id === n.topicId) : -1
    return { title: n.title, href: continueHref(groupId, n), where: mod ? `${mod.title} · урок ${idx + 1}` : n.moduleTitle }
  })()

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
  const activeTile = activeMod ? tiles.find(t => t.id === activeMod.id) ?? null : null

  return (
    <div className="space-y-6 max-w-5xl">

      {/* §282. Курс платный и подписка не действует — сказать прямо, а не
          показывать пустую программу (RLS отдаёт пусто). */}
      {!preview && <SubscriptionLockBanner courseId={course.id} />}

      {/* §290-B. Демо: сказать, почему остальные уроки под замком, и куда идти.
          В новом виде — строкой доступа в шапке курса («Оформить подписку»);
          отдельная плашка — только у раздела «только работы». */}
      {demo && activeWorksOnly && (
        <div className="platform-surface flex flex-col gap-3 rounded-card p-5 sm:flex-row sm:items-center" role="status" data-testid="course-demo">
          <Lock className="shrink-0 text-graphite-500" size={24} aria-hidden />
          <p className="flex-1 text-[15px] text-graphite-700">
            <span className="font-semibold text-graphite-900">Пробный период.</span> Открыты первые два урока каждого раздела.
            Остальные уроки — по подписке, прогресс сохранится.
          </p>
          <Link to="/courses"><Button data-testid="course-demo-buy">Оформить подписку</Button></Link>
        </div>
      )}


      {/* §224.2. Идущий пробник — сверху в ЛЮБОМ состоянии страницы, и при
          открытом разделе тоже. Раньше раздел «Пробники» стоял только на
          главной курса: в курсе с одним разделом ученик открывал раздел, потом
          тему — и пробник не встречал нигде (жалоба владельца 26.09). */}
      {groupId && <MockExamAlert exams={mockExams} groupId={groupId} now={mockNow} />}

      {/* ── Шапка курса / раздела (ЛК, письмо 15.10) ── */}
      {!activeMod && (
        <>
          <Link to="/my-course" className="stu-back">
            <ArrowLeft size={15} />Все курсы
          </Link>
          <CourseHero
            title={courseTitle}
            subject={course.subject}
            examType={course.exam_type}
            mode={courseMode}
            ladder={ladder.available == null ? ladder : { ...ladder, available: Math.max(ladder.available, courseChips.toDo) }}
            current={currentTile ? { title: currentTile.title, left: currentTile.total - currentTile.done } : null}
            chips={courseChips}
            next={nextLesson}
            access={preview ? null : pathSub || !demo
              ? accessLine(pathSub, { teacher: course.teacher?.full_name ?? null, group: course.group_name })
              // Демо без строки подписки в ответе — всё равно пробный период (§290-B).
              : { kind: 'trial', text: 'Пробный период · открыты первые два урока каждого раздела', action: { label: 'Оформить подписку', to: '/courses', primary: true } }}
          />
        </>
      )}
      {activeMod && !activeWorksOnly && activeTile && (
        <SectionHero tile={activeTile} chips={hwChips([activeMod])} courseTitle={courseTitle} onBack={() => setSelectedModule(null)}
          openLine={sectionOpenLine(activeMod.topics)} />
      )}
      {activeWorksOnly && (<>
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

      </>)}

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

      {/* «Урок пройден / открыт следующий» (письмо 16.10) — вместо полоски «🔓 Открыт урок». */}
      {!preview && <LessonEvents who={profileId} courseId={course.id} groupId={groupId} modules={modules} />}

      {/* Блок «Неделя N · срок до воскресенья» убран (письмо
          ЛК_стиль_открытие_урока_в_плитке.md, 16.10): дата открытия — у каждой
          закрытой плитки урока, сводка — в шапке раздела. */}

      {/* ══ STAFF CARDS ══ */}
      {!activeMod && <PeopleRow teacher={course.teacher} curator={course.curator} />}

      {/* ══ LEVEL 1: MODULE CARDS ══ */}
      {!activeMod && tiles.length > 0 && (
        <SectionTiles
          tiles={tiles}
          onOpen={id => { const mod = modules.find(m => m.id === id); if (mod) setSelectedModule(mod) }}
          programNote={programNote}
        />
      )}
      {/* §259. Разделы «только работы» — прежними карточками работ. */}
      {!activeMod && modules.some(isWorksOnlyModule) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {modules.filter(isWorksOnlyModule).map(mod => (
            <ModuleWorksCard key={mod.id} mod={mod} works={worksByTopic} onClick={() => setSelectedModule(mod)} />
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
            {activeWorksOnly && <ViewToggle view={view} onChange={handleViewChange} />}
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
          ) : (
            // Уроки раздела — простыми плитками (макет v2, решение владельца 15.10).
            <LessonTiles
              lessons={(() => {
                const no = new Map(activeMod.topics.map((t, i) => [t.id, i + 1]))
                return activeMod.topics.map(t => ({ id: t.id, title: t.title, tile: lessonTile(t, undefined, undefined, no, demo ? DEMO_LOCK_NOTE : undefined) }))
              })()}
              hrefFor={id => `/my-course/${groupId}/topic/${id}`}
            />
          )}
        </div>
      )}

      {/* Блок «Задания» (Не сдано / На проверке / Проверено / Тестов ждёт) со
          страницы курса убран (владелец 15.10): ДЗ — в шапке словами и в
          разделе «Домашние задания». */}
    </div>
  )
}
