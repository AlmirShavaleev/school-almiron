import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  BookOpen, Check, Clock, Video, Lightbulb, BookMarked, ClipboardList,
  GraduationCap, Loader2, Lock, CheckCircle, RotateCcw, AlertCircle,
  Upload, ArrowLeft, ChevronRight, Play,
} from 'lucide-react'
import { useStudentCourseProgram, type TopicProgress, type ModuleProgress } from '@/hooks/useStudentCourseProgram'
import { SubmitHomeworkModal } from '@/components/modals/SubmitHomeworkModal'
import { cn } from '@/utils/cn'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// ─── Material pills config ────────────────────────────────────────────────────

const MAT_CONFIG = [
  { key: 'has_video',    label: 'Видео',    icon: <Video size={10} />,         color: 'bg-red-50 text-red-600 border-red-100' },
  { key: 'has_notes',    label: 'Конспект', icon: <BookMarked size={10} />,    color: 'bg-blue-50 text-blue-600 border-blue-100' },
  { key: 'has_theory',   label: 'Теория',   icon: <BookOpen size={10} />,      color: 'bg-purple-50 text-purple-600 border-purple-100' },
  { key: 'has_tasks',    label: 'Задачи',   icon: <ClipboardList size={10} />, color: 'bg-orange-50 text-orange-600 border-orange-100' },
  { key: 'has_homework', label: 'ДЗ',       icon: <Lightbulb size={10} />,     color: 'bg-yellow-50 text-yellow-600 border-yellow-100' },
  { key: 'has_solution', label: 'Решение',  icon: <Check size={10} />,         color: 'bg-green-50 text-green-600 border-green-100' },
] as const

// ─── HW Badge ─────────────────────────────────────────────────────────────────

function HwBadge({ status, score, max }: { status: string | null; score: number | null; max: number | null }) {
  if (!status) return null
  const cfg = {
    not_submitted: { label: 'Не сдано',    icon: <AlertCircle size={10} />, cls: 'bg-gray-100 text-gray-500' },
    submitted:     { label: 'На проверке', icon: <Clock size={10} />,       cls: 'bg-blue-100 text-blue-600' },
    checked:       { label: score != null ? `${score}/${max}` : 'Принято', icon: <CheckCircle size={10} />, cls: 'bg-green-100 text-green-700' },
    revision:      { label: 'Доработать',  icon: <RotateCcw size={10} />,   cls: 'bg-orange-100 text-orange-600' },
  }[status] || { label: status, icon: null, cls: 'bg-gray-100 text-gray-400' }

  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full', cfg.cls)}>
      {cfg.icon}{cfg.label}
    </span>
  )
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
  const checkedCount = mod.topics.filter(t => t.hw_status === 'checked').length
  const totalTopics  = mod.topics.length
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
            <span>{checkedCount} из {totalTopics} тем</span>
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
  checked: {
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
  revision: {
    card:   'border-orange-200 bg-orange-50/40 hover:border-orange-300 hover:shadow-md',
    header: 'bg-orange-50/60',
    num:    'bg-orange-400 text-white',
    label:  'Доработать',
    labelCls: 'bg-orange-100 text-orange-700 border border-orange-200',
    titleCls: 'text-gray-800',
  },
  not_submitted: {
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
  onSubmitHW,
}: {
  topic: TopicProgress
  index: number
  moduleTitle: string
  groupId: string
  onOpenTopic: (t: TopicProgress) => void
  onSubmitHW: (t: TopicProgress) => void
}) {
  const today      = new Date()
  const availDate  = topic.available_from ? new Date(topic.available_from) : null
  const isLocked   = !!availDate && availDate > today
  const hasMaterials = topic.has_notes || topic.has_theory || topic.has_tasks ||
    topic.has_homework || topic.has_solution || topic.has_video
  const isDone     = topic.hw_status === 'checked'

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
              {topic.hw_status === 'revision' && <RotateCcw size={9} />}
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

        {/* Score for checked */}
        {isDone && topic.hw_score != null && (
          <div className="mt-1 text-xs font-semibold text-green-700">
            {topic.hw_score} / {topic.hw_max} б.
          </div>
        )}

        {isLocked && availDate && (
          <div className="text-[10px] text-gray-400 mt-1">
            Откроется {availDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
          </div>
        )}
      </div>

      {/* Material pills */}
      {!isLocked && hasMaterials && (
        <div className="px-4 pb-3 flex flex-wrap gap-1">
          {MAT_CONFIG.map(m => topic[m.key] && (
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
        {/* Сдать ДЗ */}
        {!isLocked && topic.hw_id && (topic.hw_status === 'not_submitted' || topic.hw_status === 'revision') && (
          <button
            onClick={e => { e.stopPropagation(); onSubmitHW(topic) }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            <Upload size={11} />
            {topic.hw_status === 'revision' ? 'Переслать' : 'Сдать ДЗ'}
          </button>
        )}

        {/* Open materials hint */}
        {!isLocked && hasMaterials && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-primary-500 font-medium">
            {topic.has_video && <Play size={11} />}
            Открыть
            <ChevronRight size={12} />
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentCoursePage() {
  const { groupId }  = useParams<{ groupId?: string }>()
  const profile      = useAuthStore(s => s.profile)
  const navigate     = useNavigate()
  const { course, modules, loading, reload } = useStudentCourseProgram(groupId)

  const [selectedModule, setSelectedModule] = useState<ModuleProgress | null>(null)
  const [submitTopic,    setSubmitTopic]    = useState<TopicProgress | null>(null)
  const [studentId,      setStudentId]      = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    supabase.from('students').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setStudentId(data?.id ?? null))
  }, [profile])

  // Reset selected module when course changes
  useEffect(() => { setSelectedModule(null) }, [groupId])

  const totalTopics   = modules.reduce((s, m) => s + m.topics.length, 0)
  const checkedTopics = modules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'checked').length, 0)
  const overallPct    = totalTopics > 0 ? Math.round(checkedTopics / totalTopics * 100) : 0

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
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
        <div>
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
          <h1 className="text-2xl font-bold text-gray-900">
            {activeMod ? activeMod.title : course.title}
          </h1>
        </div>

        {/* Overall progress pill */}
        <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-2.5 shrink-0">
          <Ring pct={activeMod
            ? (activeMod.topics.length > 0 ? Math.round(activeMod.topics.filter(t => t.hw_status === 'checked').length / activeMod.topics.length * 100) : 0)
            : overallPct
          } size={40} stroke={4} />
          <div>
            <div className="text-xs font-semibold text-gray-700">
              {activeMod
                ? `${activeMod.topics.filter(t => t.hw_status === 'checked').length} / ${activeMod.topics.length} тем`
                : `${checkedTopics} / ${totalTopics} тем`}
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
                {modules.reduce((s, m) => s + m.topics.filter(t => t.hw_status === 'revision').length, 0)}
              </span>
            </div>
          )}
        </div>
      </div>

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

      {/* ══ LEVEL 2: TOPIC CARDS ══ */}
      {activeMod && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeMod.topics.map((topic, i) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              index={i}
              moduleTitle={activeMod.title}
              groupId={groupId ?? ''}
              onOpenTopic={t => navigate(`/my-course/${groupId}/topic/${t.id}`)}
              onSubmitHW={setSubmitTopic}
            />
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      <SubmitHomeworkModal
        open={!!submitTopic}
        onClose={() => setSubmitTopic(null)}
        onSubmitted={() => { setSubmitTopic(null); reload() }}
        homework={submitTopic ? {
          id:        submitTopic.hw_id!,
          title:     submitTopic.title,
          max_score: submitTopic.hw_max ?? 100,
          file_url:  submitTopic.hw_file_url ?? undefined,
        } : null}
        studentId={studentId}
      />
    </div>
  )
}
