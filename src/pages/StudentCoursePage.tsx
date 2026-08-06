import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  BookOpen, Check, Clock, Video, Lightbulb, BookMarked, ClipboardList,
  GraduationCap, Loader2, Lock, CheckCircle, RotateCcw, AlertCircle,
  Upload, ArrowLeft, ChevronRight, Play, MessageSquare, BarChart3,
  LayoutList, LayoutGrid, FileEdit,
} from 'lucide-react'
import { useStudentCourseProgram, type TopicProgress, type ModuleProgress, type StaffInfo } from '@/hooks/useStudentCourseProgram'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS, EXAM_LABELS, formatDate } from '@/utils/format'
import { isOverdue, GRADE_SCALE_LABEL } from '@/lib/topicHomework'
import { testPercent } from '@/lib/studentProgram'
import { TOPIC_SECTION_ORDER, TOPIC_SECTION_LABELS, type TopicSection } from '@/lib/topicMaterialItems'
import { isTopicOpen, topicClosedLabel } from '@/lib/topicAvailability'

// ─── Section pills config ─────────────────────────────────────────────────────
/**
 * Оформление плашки. Список рубрик, порядок и подписи — из общего места
 * (§100): свой перечень здесь отставал от §95 на три рубрики, и «зелёная
 * точка» у преподавателя перестала значить то же, что плашка у ученика.
 */
const SECTION_STYLE: Record<TopicSection, { icon: React.ReactNode; color: string }> = {
  theory:             { icon: <BookOpen size={10} />,      color: 'bg-purple-50 text-purple-600 border-purple-100' },
  notes:              { icon: <BookMarked size={10} />,    color: 'bg-blue-50 text-blue-600 border-blue-100' },
  tasks:              { icon: <ClipboardList size={10} />, color: 'bg-orange-50 text-orange-600 border-orange-100' },
  task_solution:      { icon: <Check size={10} />,         color: 'bg-teal-50 text-teal-600 border-teal-100' },
  worksheet_tasks:    { icon: <FileText size={10} />,      color: 'bg-sky-50 text-sky-600 border-sky-100' },
  homework:           { icon: <Lightbulb size={10} />,     color: 'bg-yellow-50 text-yellow-600 border-yellow-100' },
  solution:           { icon: <Check size={10} />,         color: 'bg-green-50 text-green-600 border-green-100' },
  worksheet_homework: { icon: <FileText size={10} />,      color: 'bg-cyan-50 text-cyan-600 border-cyan-100' },
  video:              { icon: <Video size={10} />,         color: 'bg-red-50 text-red-600 border-red-100' },
  test:               { icon: <BarChart3 size={10} />,     color: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
}

const SECTION_CONFIG: { key: TopicSection; label: string; icon: React.ReactNode; color: string }[] =
  TOPIC_SECTION_ORDER.map(key => ({ key, label: TOPIC_SECTION_LABELS[key], ...SECTION_STYLE[key] }))

// ─── View preference ─────────────────────────────────────────────────────────

const VIEW_PREF_KEY = 'student-course-view'
type CourseView = 'list' | 'cards'

function getViewPref(): CourseView {
  try { return (localStorage.getItem(VIEW_PREF_KEY) as CourseView) || 'list' } catch { return 'list' }
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
const MODULE_GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
  'from-purple-500 to-fuchsia-600',
  'from-sky-500 to-blue-600',
  'from-green-500 to-emerald-600',
]

function ModuleBigCard({
  mod,
  idx,
  onClick,
}: {
  mod: ModuleProgress
  idx: number
  onClick: () => void
}) {
  const checkedCount = mod.done
  const totalTopics  = mod.total
  const submittedCnt = mod.topics.filter(t => t.hw_status === 'submitted').length
  const pct          = totalTopics > 0 ? Math.round(checkedCount / totalTopics * 100) : 0
  const gradient     = MODULE_GRADIENTS[idx % MODULE_GRADIENTS.length]
  const isDone       = pct === 100

  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl overflow-hidden border border-gray-200 hover:border-primary-300 hover:shadow-lg transition-all duration-200 bg-white w-full"
    >
      {/* Gradient top */}
      <div className={cn('bg-gradient-to-br p-5 text-white', gradient)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm shrink-0',
                isDone ? 'bg-white/30' : 'bg-white/20'
              )}>
                {isDone ? <Check size={16} /> : mod.order_index}
              </span>
              {isDone && (
                <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                  ✓ Завершён
                </span>
              )}
              {submittedCnt > 0 && !isDone && (
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  {submittedCnt} на проверке
                </span>
              )}
            </div>
            <h3 className="text-base font-bold leading-snug">{mod.title}</h3>
          </div>
          <Ring pct={pct} size={48} stroke={5} />
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-1.5 bg-white/25 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-white/75">
            <span>{checkedCount} из {totalTopics} заданий</span>
            <span className="flex items-center gap-1">
              Открыть <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>
        </div>
      </div>

    </button>
  )
}

// ─── TOPIC CARD (Level 2) ─────────────────────────────────────────────────────

// Visual states per hw_status
const TOPIC_STATE = {
  accepted: {
    card:   'border-green-300 bg-green-50 hover:border-green-400 hover:shadow-md',
    header: 'bg-green-50',
    num:    'bg-green-500 text-white',
    label:  'Пройдено',
    labelCls: 'bg-green-100 text-green-700 border border-green-200',
    titleCls: 'text-gray-800',
  },
  submitted: {
    card:   'border-blue-200 bg-blue-50/40 hover:border-blue-300 hover:shadow-md',
    header: 'bg-blue-50/60',
    num:    'bg-blue-500 text-white',
    label:  'На проверке',
    labelCls: 'bg-blue-100 text-blue-700 border border-blue-200',
    titleCls: 'text-gray-800',
  },
  returned: {
    card:   'border-orange-200 bg-orange-50/40 hover:border-orange-300 hover:shadow-md',
    header: 'bg-orange-50/60',
    num:    'bg-orange-400 text-white',
    label:  'Доработать',
    labelCls: 'bg-orange-100 text-orange-700 border border-orange-200',
    titleCls: 'text-gray-800',
  },
  draft: {
    card:   'border-sky-200 bg-sky-50/40 hover:border-sky-300 hover:shadow-md',
    header: 'bg-sky-50/60',
    num:    'bg-sky-400 text-white',
    label:  'Черновик',
    labelCls: 'bg-sky-100 text-sky-700 border border-sky-200',
    titleCls: 'text-gray-800',
  },
  not_started: {
    card:   'border-gray-200 hover:border-primary-300 hover:shadow-md',
    header: 'bg-white',
    num:    'bg-primary-100 text-primary-600',
    label:  null,
    labelCls: '',
    titleCls: 'text-gray-800',
  },
  none: {
    card:   'border-gray-200 hover:border-primary-300 hover:shadow-md',
    header: 'bg-white',
    num:    'bg-gray-100 text-gray-500',
    label:  null,
    labelCls: '',
    titleCls: 'text-gray-700',
  },
}

function TopicCard({
  topic,
  index,
  moduleTitle,
  groupId,
  onOpenTopic,
  onOpenHomework,
}: {
  topic: TopicProgress
  index: number
  moduleTitle: string
  groupId: string
  onOpenTopic: (t: TopicProgress) => void
  onOpenHomework: (t: TopicProgress) => void
}) {
  // Правило открытости общее с базой и со второй карточкой ниже —
  // src/lib/topicAvailability.ts. Своей копии условия здесь быть не должно.
  const isLocked    = !isTopicOpen(topic)
  const closedLabel = topicClosedLabel(topic)
  const hasMaterials = topic.sections.size > 0
  const isDone     = topic.hw_status === 'accepted'

  // Pick visual state
  const stateKey = isLocked ? 'none'
    : (topic.hw_status as keyof typeof TOPIC_STATE | null) && (topic.hw_status as string) in TOPIC_STATE
      ? (topic.hw_status as keyof typeof TOPIC_STATE)
      : 'none'
  const st = TOPIC_STATE[stateKey]

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white flex flex-col transition-all duration-150 relative',
        isLocked ? 'border-gray-100 opacity-60 cursor-default' : cn(st.card, 'cursor-pointer')
      )}
      onClick={() => !isLocked && onOpenTopic(topic)}
    >
      {/* Completed ribbon */}
      {isDone && (
        <div className="absolute top-0 right-0 overflow-hidden w-14 h-14 pointer-events-none rounded-tr-2xl">
          <div className="absolute top-3 right-[-14px] rotate-45 bg-green-500 text-white text-[8px] font-bold px-5 py-0.5 shadow-sm">
            ✓
          </div>
        </div>
      )}

      {/* Card header */}
      <div className={cn('px-4 pt-4 pb-3 rounded-t-2xl', isLocked ? 'bg-gray-50' : st.header)}>
        <div className="flex items-start justify-between gap-2 mb-2">
          {/* Number badge */}
          <div className={cn(
            'w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0',
            isLocked ? 'bg-gray-200 text-gray-400' : st.num
          )}>
            {isDone ? <Check size={13} /> : index + 1}
          </div>

          {/* Status label */}
          {!isLocked && st.label && (
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
              st.labelCls
            )}>
              {isDone && <CheckCircle size={9} />}
              {topic.hw_status === 'submitted' && <Clock size={9} />}
              {topic.hw_status === 'returned' && <RotateCcw size={9} />}
              {st.label}
            </span>
          )}
        </div>

        <div className={cn(
          'text-sm font-semibold leading-snug',
          isLocked ? 'text-gray-400' : st.titleCls
        )}>
          {isLocked && <Lock size={11} className="inline mr-1 mb-0.5 text-gray-300" />}
          {topic.title}
        </div>

        {/* Оценка за ДЗ. Шкала может быть не задана — тогда просто «Принято». */}
        {isDone && (
          <div className="mt-1 text-xs font-semibold text-green-700">
            {topic.hw_score != null && topic.hw_max != null
              ? `${topic.hw_score} / ${topic.hw_max} б.`
              : 'ДЗ принято'}
          </div>
        )}

        {/* Результат теста */}
        {!isLocked && topic.test_status === 'completed' && (
          <div className="mt-1 text-xs font-semibold text-indigo-700">
            Тест: {topic.test_points ?? 0} / {topic.test_max_points ?? 0} б.
            {testPercent(topic.test_points, topic.test_max_points) != null &&
              ` · ${testPercent(topic.test_points, topic.test_max_points)}%`}
          </div>
        )}

        {isLocked && (
          <div className="text-[10px] text-gray-400 mt-1">
            {closedLabel}
          </div>
        )}
      </div>

      {/* Material pills */}
      {!isLocked && hasMaterials && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {SECTION_CONFIG.map(m => topic.sections.has(m.key) && (
            <span key={m.key}
              className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border', m.color)}
            >
              {m.icon}{m.label}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto px-4 pb-4 flex items-center justify-between gap-2">
        {/* Сдать ДЗ — сдача живёт на странице темы (TopicHomeworkStudent) */}
        {!isLocked && topic.hw_id && (topic.hw_status === 'not_started' || topic.hw_status === 'draft' || topic.hw_status === 'returned') && (
          <button
            onClick={e => { e.stopPropagation(); onOpenHomework(topic) }}
            className="min-h-11 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            <Upload size={11} />
            {topic.hw_status === 'returned' ? 'Переделать' : topic.hw_status === 'draft' ? 'Дособрать' : 'Сдать ДЗ'}
          </button>
        )}

        {/* Open materials hint */}
        {!isLocked && hasMaterials && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-primary-500 font-medium">
            {topic.sections.has('video') && <Play size={11} />}
            Открыть
            <ChevronRight size={12} />
          </span>
        )}
      </div>
    </div>
  )
}

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
    statusLabel: 'В работе', statusCls: 'bg-blue-100 text-blue-700',
    icon: <Play size={12} className="text-blue-500" />,
  },
  none: {
    row: 'bg-white border-gray-200 hover:border-primary-300',
    numBg: 'bg-gray-100 text-gray-500', titleCls: 'text-gray-800',
    statusLabel: null, statusCls: '',
    icon: <BookOpen size={12} className="text-gray-400" />,
  },
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
  const hasMaterials = topic.sections.size > 0
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
          {topic.title}
        </p>

        {/* Score — mobile */}
        {isDone && topic.hw_score != null && topic.hw_max != null && (
          <p className="sm:hidden text-xs font-semibold text-green-700 mt-0.5">
            {topic.hw_score}/{topic.hw_max} б.
          </p>
        )}

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

        {/* Material badges */}
        {!isLocked && hasMaterials && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {SECTION_CONFIG.map(m => topic.sections.has(m.key) && (
              <span key={m.key}
                className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border', m.color)}
              >
                {m.icon}{m.label}
              </span>
            ))}
          </div>
        )}

        {isLocked && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            {closedLabel}
          </p>
        )}
      </div>

      {/* ── Right: score + status + buttons ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Score — desktop */}
        {isDone && topic.hw_score != null && topic.hw_max != null && (
          <span className="hidden sm:block text-xs font-semibold text-green-700 whitespace-nowrap">
            {topic.hw_score}/{topic.hw_max}&nbsp;б
          </span>
        )}

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
            aria-label={topic.hw_status === 'returned' ? 'Переделать домашнее задание' : 'Сдать домашнее задание'}
          >
            <Upload size={11} />
            <span className="hidden sm:inline">
              {topic.hw_status === 'returned' ? 'Переделать' : topic.hw_status === 'draft' ? 'Дособрать' : 'Сдать ДЗ'}
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
  const { course, modules, loading, error } = useStudentCourseProgram(groupId)

  const [selectedModule, setSelectedModule] = useState<ModuleProgress | null>(null)
  const [view,           setView]           = useState<CourseView>(getViewPref)

  function handleViewChange(v: CourseView) {
    setView(v)
    saveViewPref(v)
  }

  // Сдача ДЗ и прохождение теста живут на странице темы — сюда ведут все кнопки
  const openTopic = (topic: TopicProgress) => navigate(`/my-course/${groupId}/topic/${topic.id}`)

  // Reset selected module when course changes
  useEffect(() => { setSelectedModule(null) }, [groupId])

  const totalTopics   = modules.reduce((sum, module) => sum + module.total, 0)
  const checkedTopics = modules.reduce((sum, module) => sum + module.done, 0)
  const overallPct    = totalTopics > 0 ? Math.round(checkedTopics / totalTopics * 100) : 0

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
      <p>Вы не записаны ни в одну группу</p>
    </div>
  )

  // ── Find current module data (keep live) ─────────────────────────────────────
  const activeMod = selectedModule
    ? modules.find(m => m.id === selectedModule.id) ?? selectedModule
    : null

  return (
    <div className="space-y-6 max-w-4xl">

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

        {/* Overall progress pill */}
        <div className="w-full sm:w-auto flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 sm:shrink-0">
          <Ring pct={activeMod
            ? (activeMod.total > 0 ? Math.round(activeMod.done / activeMod.total * 100) : 0)
            : overallPct
          } size={40} stroke={4} />
          <div>
            <div className="text-xs font-semibold text-gray-700">
              {activeMod
                ? `${activeMod.done} / ${activeMod.total} заданий`
                : `${checkedTopics} / ${totalTopics} заданий`}
            </div>
            <div className="text-[10px] text-gray-400">
              {activeMod ? 'в разделе' : 'всего'}
            </div>
          </div>
          {!activeMod && (
            <div className="flex items-center gap-3 text-xs text-gray-400 border-l border-gray-100 pl-3">
              <span className="flex items-center gap-1">
                <Clock size={11} className="text-blue-400" />
                {modules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'submitted').length, 0)}
              </span>
              <span className="flex items-center gap-1">
                <RotateCcw size={11} className="text-orange-400" />
                {modules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'returned').length, 0)}
              </span>
            </div>
          )}
        </div>
      </div>

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
          {modules.map((mod, i) => (
            <ModuleBigCard
              key={mod.id}
              mod={mod}
              idx={i}
              onClick={() => setSelectedModule(mod)}
            />
          ))}
        </div>
      )}

      {/* ══ LEVEL 2: TOPIC LIST / CARDS ══ */}
      {activeMod && (
        <div className="space-y-3">
          {/* View toggle header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500">
              {activeMod.topics.length}&nbsp;
              {activeMod.topics.length === 1 ? 'тема' : 'тем'} в разделе
            </p>
            <ViewToggle view={view} onChange={handleViewChange} />
          </div>

          {view === 'list' ? (
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="topics-cards-view">
              {activeMod.topics.map((topic, i) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  index={i}
                  moduleTitle={activeMod.title}
                  groupId={groupId ?? ''}
                  onOpenTopic={openTopic}
                  onOpenHomework={openTopic}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ БЛОК ЗАДАНИЙ (только на главном экране курса) ══ */}
      {!activeMod && (
        <HomeworkBlock
          modules={modules}
          onOpenTopic={openTopic}
        />
      )}
    </div>
  )
}
