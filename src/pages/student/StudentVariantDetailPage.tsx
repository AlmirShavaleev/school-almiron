import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { MouseEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, BookOpen, Calendar, CheckCircle2,
  Clock, FileText, Loader2, MessageSquare, Paperclip, Send, UserRound, Users,
} from 'lucide-react'
import { format, isFuture } from 'date-fns'
import { ru } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { useStudentVariantAssignmentDetail } from '@/hooks/useVariantAssignments'
import { useVariantAttempt, type VariantItem } from '@/hooks/useVariantAttempt'
import { scoreAutoAnswer } from '@/utils/variantAnswerNormalize'
import { VariantAnswerInput } from '@/components/variant/VariantAnswerInput'
import { ManualAnswerInput } from '@/components/variant/ManualAnswerInput'
import { SelfCheckItem, SelfCheckSummary, useSelfCheckScores } from '@/components/variant/SelfCheckPanel'
import { resolveTaskHtml } from '@/components/catalog/CatalogTaskContent'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'

function selfCheckCompletionStorageKey(assignmentId: string) {
  return `self-check-complete:${assignmentId}`
}

function loadSelfCheckCompletion(assignmentId: string): boolean {
  if (!assignmentId) return false
  try {
    return sessionStorage.getItem(selfCheckCompletionStorageKey(assignmentId)) === '1'
  } catch {
    return false
  }
}

function saveSelfCheckCompletion(assignmentId: string, value: boolean) {
  if (!assignmentId) return
  try {
    if (value) sessionStorage.setItem(selfCheckCompletionStorageKey(assignmentId), '1')
    else sessionStorage.removeItem(selfCheckCompletionStorageKey(assignmentId))
  } catch {
    // Ignore sessionStorage failures — completion just won't survive refresh.
  }
}

function SignedImage({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    ;(supabase as any).storage.from('variant-solutions').createSignedUrl(path, 3600)
      .then(({ data }: { data: { signedUrl: string } | null }) => {
        if (alive && data) setUrl(data.signedUrl)
      })
    return () => { alive = false }
  }, [path])
  if (!url) return <span className="text-xs text-gray-400">{name}</span>
  const isPdf = name.toLowerCase().endsWith('.pdf')
  if (isPdf) return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
      <FileText size={12} />{name}
    </a>
  )
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt={name} className="max-w-full rounded border border-gray-200 max-h-48 object-contain" />
    </a>
  )
}

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string>  = { ege: 'ЕГЭ', oge: 'ОГЭ' }

function extractPlainText(html: string | null | undefined): string {
  if (!html) return '—'
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&minus;/gi, '-')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim() || '—'
}

function getAutoAnswerValue(item: VariantItem): string | null {
  const answerField = 'answer' + '_html'
  return (item as VariantItem & Record<string, string | null | undefined>)[answerField] ?? null
}

type AutoAnswerVerdict = 'correct' | 'partial' | 'wrong'

function getAutoAnswerScore(item: VariantItem, studentAnswer: string | null | undefined): number | null {
  const correctRaw = getAutoAnswerValue(item)
  const studentRaw = studentAnswer ?? ''
  if (!correctRaw || !studentRaw.trim()) return null
  return scoreAutoAnswer(studentRaw, correctRaw, item.partial_type ?? null)
}

function getAutoAnswerVerdict(item: VariantItem, studentAnswer: string | null | undefined): AutoAnswerVerdict | null {
  const score = getAutoAnswerScore(item, studentAnswer)
  if (score === null) return null
  const maxPoints = item.max_points ?? item.points ?? 1
  if (score >= maxPoints) return 'correct'
  if (score > 0) return 'partial'
  return 'wrong'
}

function answerStatusClass(verdict: AutoAnswerVerdict | null) {
  if (verdict === 'correct') return 'bg-emerald-100 text-emerald-800'
  if (verdict === 'partial') return 'bg-amber-100 text-amber-800'
  if (verdict === 'wrong') return 'bg-rose-100 text-rose-800'
  return 'bg-gray-100 text-gray-700'
}

function answerStatusLabel(verdict: AutoAnswerVerdict | null) {
  if (verdict === 'correct') return 'Верно'
  if (verdict === 'partial') return 'Частично верно'
  if (verdict === 'wrong') return 'Неверно'
  return 'Без ответа'
}

function answerRowClass(verdict: AutoAnswerVerdict | null) {
  if (verdict === 'correct') return 'bg-emerald-50 ring-1 ring-inset ring-emerald-200'
  if (verdict === 'partial') return 'bg-amber-50 ring-1 ring-inset ring-amber-200'
  if (verdict === 'wrong') return 'bg-rose-50 ring-1 ring-inset ring-rose-200'
  return 'odd:bg-gray-50/60'
}

function deriveStudentAttemptStatus(params: {
  assignmentStatus: string
  attemptStatus: string | null
  startedAt: string | null
  submittedAt: string | null
  completedAt: string | null
}) {
  if (params.completedAt) return 'completed'
  if (params.submittedAt) return 'submitted'
  if (params.attemptStatus) return params.attemptStatus
  if ((params.assignmentStatus === 'not_started' || params.assignmentStatus === 'available') && params.startedAt) {
    return 'in_progress'
  }
  return params.assignmentStatus
}

// ── Submit-confirm modal ────────────────────────────────────────────────────

interface ConfirmDialogProps {
  answeredCount: number
  totalCount:    number
  onConfirm:     () => void
  onCancel:      () => void
  loading:       boolean
  error:         string | null
}

function ConfirmDialog({ answeredCount, totalCount, onConfirm, onCancel, loading, error }: ConfirmDialogProps) {
  const unanswered = totalCount - answeredCount
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
        <h3 className="font-semibold text-gray-900 text-lg mb-2">Завершить вариант?</h3>
        <p className="text-sm text-gray-600 mb-1">
          Отвечено: <span className="font-medium text-gray-800">{answeredCount}</span> из {totalCount}
        </p>
        {unanswered > 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            {unanswered} {unanswered === 1 ? 'задача останется' : 'задач останутся'} без ответа.
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 mt-2">{error}</p>
        )}
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm bg-primary-600 text-white hover:bg-primary-700 transition-colors
                       disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Завершить
          </button>
        </div>
      </div>
    </div>
  )
}

function AutoResultsTable({
  items,
  answers,
  submittedAt,
  maxScore,
  onTaskJump,
}: {
  items: VariantItem[]
  answers: Record<string, string>
  submittedAt: string | null
  maxScore: number | null
  onTaskJump: (itemId: string) => void
}) {
  const autoItems = items.filter(item => item.exam_part === 1 || item.grading_type === 'auto')
  if (!autoItems.length) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6" data-testid="auto-results-table">
      <div className="text-center mb-5">
        <p className="text-base text-gray-900">
          Заданий с кратким ответом: {autoItems.length}
          {'  '}
          Максимальный балл: {maxScore ?? autoItems.length}.
        </p>
        {submittedAt && (
          <p className="text-sm text-gray-600 mt-1">
            Сдана {format(new Date(submittedAt), 'dd.MM.yyyy HH:mm', { locale: ru })} (МСК)
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <caption className="caption-top text-xl font-semibold text-gray-900 mb-3">Тестовая часть</caption>
          <thead>
            <tr className="text-gray-900">
              <th className="px-3 py-2 text-center font-semibold border-b border-gray-300">№ п/п</th>
              <th className="px-3 py-2 text-center font-semibold border-b border-gray-300">№</th>
              <th className="px-3 py-2 text-center font-semibold border-b border-gray-300">Тип</th>
              <th className="px-3 py-2 text-center font-semibold border-b border-gray-300 bg-rose-100">Ваш ответ</th>
              <th className="px-3 py-2 text-center font-semibold border-b border-gray-300">Правильный ответ</th>
            </tr>
          </thead>
          <tbody>
            {autoItems.map((item, idx) => {
              const studentAnswer = answers[item.item_id] ?? ''
              const verdict = getAutoAnswerVerdict(item, studentAnswer)
              const score = getAutoAnswerScore(item, studentAnswer)
              const maxPoints = item.max_points ?? item.points ?? 1
              return (
                <tr
                  key={item.item_id}
                  data-testid={`auto-answer-row-${item.item_id}`}
                  className={answerRowClass(verdict)}
                >
                  <td className="px-3 py-2 text-center text-gray-900">{idx + 1}</td>
                  <td className="px-3 py-2 text-center text-gray-900 underline decoration-gray-300 underline-offset-2">
                    <a
                      href={`#result-task-${item.item_id}`}
                      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                        event.preventDefault()
                        onTaskJump(item.item_id)
                      }}
                      className="hover:text-primary-700 hover:decoration-primary-400 transition-colors"
                    >
                      {item.task_ext_id ?? '—'}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-center text-gray-900">{idx + 1}</td>
                  <td
                    className={`px-3 py-2 text-center font-semibold ${
                      verdict === 'correct'
                        ? 'bg-emerald-100 text-emerald-900'
                        : verdict === 'partial'
                          ? 'bg-amber-100 text-amber-900'
                          : verdict === 'wrong'
                            ? 'bg-rose-100 text-rose-900'
                            : 'bg-gray-100 text-gray-700'
                    }`}
                    data-testid={`auto-answer-cell-${item.item_id}`}
                  >
                    <div>{studentAnswer.trim() ? studentAnswer : '—'}</div>
                    {score !== null && (
                      <div className="mt-1 text-[11px] font-medium opacity-80">
                        {score} / {maxPoints} б.
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-900">
                    {extractPlainText(getAutoAnswerValue(item))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultTaskReveal({ item }: { item: VariantItem }) {
  const hasReveal = !!(item.solution_html || item.solution_plan_html || item.grade_criteria_html)
  if (!hasReveal) return null

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3" data-testid={`result-task-reveal-${item.item_id}`}>
      {item.solution_html && (
        <div>
          <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Решение</div>
          <TaskContentRenderer html={resolveTaskHtml(item.solution_html, item.assets ?? [])} />
        </div>
      )}
      {item.solution_plan_html && (
        <div>
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">План решения</div>
          <TaskContentRenderer html={resolveTaskHtml(item.solution_plan_html, item.assets ?? [])} />
        </div>
      )}
      {item.grade_criteria_html && (
        <div>
          <div className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-1">Критерии оценки</div>
          <TaskContentRenderer html={resolveTaskHtml(item.grade_criteria_html, item.assets ?? [])} />
        </div>
      )}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export function StudentVariantDetailPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const { assignment, loading: detailLoading, error: detailError } =
    useStudentVariantAssignmentDetail(assignmentId)

  const [showConfirm, setShowConfirm] = useState(false)
  const [autoStarting, setAutoStarting] = useState(false)
  const [highlightedResultItemId, setHighlightedResultItemId] = useState<string | null>(null)
  const [selfCheckCompleted, setSelfCheckCompleted] = useState(false)
  const {
    items,
    answers,
    saveStates,
    attachments,
    attempt,
    loading: attemptLoading,
    error: attemptError,
    startAttempt,
    setAnswer,
    addAttachment,
    removeAttachment,
    submitVariant,
    submitting,
    submitError,
    gradedAnswers,
  } = useVariantAttempt(
    assignmentId,
    assignment?.status ?? 'not_started',
    assignment?.started_at ?? null,
    assignment?.submitted_at ?? null,
    assignment?.completed_at ?? null,
    assignment?.available_from ?? null,
    assignment?.score ?? null,
    assignment?.max_score ?? null,
    assignment?.percentage ?? null,
    assignment?.grading_status ?? null,
    assignment?.answered_count ?? null,
    assignment?.correct_count ?? null,
    assignment?.manual_review_count ?? null,
  )
  const { scores: selfCheckScores, setScore: setSelfCheckScore } = useSelfCheckScores(assignmentId ?? '', items)

  const variant = assignment?.variant ?? null
  const groupName = assignment?.group_name ?? assignment?.assignment?.group?.name
  const isSelfBuilt = variant?.source_type === 'student_self_built'
  const selfCheckItems = items.filter(item => item.exam_part !== 1)
  const teacherName = isSelfBuilt ? null : (assignment?.teacher_name ?? assignment?.assignment?.assigned_by_profile?.full_name ?? null)
  const lockedUntil = assignment?.available_from ? isFuture(new Date(assignment.available_from)) : false
  const status = assignment ? deriveStudentAttemptStatus({
    assignmentStatus: assignment.status,
    attemptStatus: attempt?.status ?? null,
    startedAt: attempt?.started_at ?? assignment.started_at ?? null,
    submittedAt: attempt?.submitted_at ?? assignment.submitted_at ?? null,
    completedAt: attempt?.completed_at ?? assignment.completed_at ?? null,
  }) : 'not_started'
  const isSubmitted = status === 'submitted' || status === 'completed'
  const isStarted = status === 'in_progress'
    || status === 'submitted'
    || status === 'completed'
    || !!(attempt?.started_at ?? assignment?.started_at)
  const shouldShowSelfCheckStep = isSubmitted && isSelfBuilt && selfCheckItems.length > 0 && !selfCheckCompleted
  const wasSubmittedRef = useRef(isSubmitted)

  useEffect(() => {
    if (!assignmentId || !assignment || !variant || !isSelfBuilt || isStarted || isSubmitted || lockedUntil) return
    let alive = true
    setAutoStarting(true)
    void startAttempt().finally(() => {
      if (alive) setAutoStarting(false)
    })
    return () => { alive = false }
  }, [assignmentId, assignment, variant, isSelfBuilt, isStarted, isSubmitted, lockedUntil, startAttempt])

  useEffect(() => {
    if (!highlightedResultItemId) return
    const timer = window.setTimeout(() => {
      setHighlightedResultItemId(current => current === highlightedResultItemId ? null : current)
    }, 1600)

    return () => window.clearTimeout(timer)
  }, [highlightedResultItemId])

  useEffect(() => {
    if (!assignmentId) return
    setSelfCheckCompleted(loadSelfCheckCompletion(assignmentId))
  }, [assignmentId])

  useEffect(() => {
    if (!wasSubmittedRef.current && isSubmitted) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    wasSubmittedRef.current = isSubmitted
  }, [isSubmitted])

  useEffect(() => {
    if (!shouldShowSelfCheckStep) return
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [shouldShowSelfCheckStep])

  // ── Loading / error states ────────────────────────────────────────────────

  if (detailLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }

  if (detailError || !assignment || !assignment.variant) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-red-600 font-medium">{detailError ?? 'Вариант недоступен'}</p>
        <Link to="/student/variants" className="mt-3 text-sm text-primary-600 hover:underline block">
          Вернуться к моим вариантам
        </Link>
      </div>
    )
  }

  // Count answered: text answers + items with attachments
  const answeredCount = items.filter(item =>
    (answers[item.item_id] ?? '').trim() !== '' ||
    (attachments[item.item_id] ?? []).length > 0
  ).length

  async function handleConfirmSubmit() {
    await submitVariant()
  }

  function handleFinishSelfCheck() {
    if (!assignmentId) return
    saveSelfCheckCompletion(assignmentId, true)
    setSelfCheckCompleted(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleResultTaskJump(itemId: string) {
    const targetId = `result-task-${itemId}`
    const el = document.getElementById(targetId)
    if (!el) return

    setHighlightedResultItemId(itemId)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    if (window.location.hash !== `#${targetId}`) {
      window.history.replaceState(null, '', `#${targetId}`)
    }
  }

  // ── Header ────────────────────────────────────────────────────────────────

  const header = (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{assignment.variant.title}</h1>
          {assignment.variant.description && (
            <p className="text-sm text-gray-500 mt-1">{assignment.variant.description}</p>
          )}
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <BookOpen size={14} />
              {SUBJECT_LABELS[assignment.variant.subject] ?? assignment.variant.subject}
              {' · '}
              {EXAM_LABELS[assignment.variant.exam_type] ?? assignment.variant.exam_type}
            </span>
            <span className="flex items-center gap-1.5">
              <FileText size={14} />
              {assignment.variant.tasks_count} задач
            </span>
            {groupName && (
              <span className="flex items-center gap-1.5">
                <Users size={14} />
                Группа: {groupName}
              </span>
            )}
            {teacherName && (
              <span className="flex items-center gap-1.5">
                <UserRound size={14} />
                Преподаватель: {teacherName}
              </span>
            )}
            {assignment.available_from && (
              <span className="flex items-center gap-1.5">
                <Clock size={14} />
                Открыт с {format(new Date(assignment.available_from), 'd MMM yyyy HH:mm', { locale: ru })}
              </span>
            )}
            {assignment.due_at && (
              <span className="flex items-center gap-1.5">
                <Calendar size={14} />
                Дедлайн {format(new Date(assignment.due_at), 'd MMM yyyy HH:mm', { locale: ru })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // ── Locked (available_from in future) ────────────────────────────────────

  if (lockedUntil) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <nav className="text-sm text-gray-500 flex items-center gap-1.5">
            <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
            <span>/</span>
            <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
          </nav>
        </div>
        {header}
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          <Clock size={28} className="mx-auto mb-2 text-gray-300" />
          Вариант откроется {format(new Date(assignment.available_from!), 'd MMMM yyyy HH:mm', { locale: ru })}
        </div>
      </div>
    )
  }

  // ── Cancelled ─────────────────────────────────────────────────────────────

  if (status === 'cancelled') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <nav className="text-sm text-gray-500 flex items-center gap-1.5">
            <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
            <span>/</span>
            <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
          </nav>
        </div>
        {header}
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500">
          <AlertTriangle size={28} className="mx-auto mb-2 text-gray-300" />
          Это назначение было отменено преподавателем.
        </div>
      </div>
    )
  }

  // ── Not started → Start screen ────────────────────────────────────────────

  if (!isStarted) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <nav className="text-sm text-gray-500 flex items-center gap-1.5">
            <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
            <span>/</span>
            <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
          </nav>
        </div>
        {header}
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          {isSelfBuilt ? (
            <>
              <Loader2 size={40} className="mx-auto mb-3 text-primary-500 animate-spin" />
              <p className="text-gray-700 mb-1 font-medium">
                Подготавливаем вариант
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Сейчас автоматически откроем задачи для решения.
              </p>
              {attemptError && (
                <p className="text-sm text-red-600 mb-4">{attemptError}</p>
              )}
              <button
                onClick={startAttempt}
                disabled={attemptLoading || autoStarting}
                className="px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700
                           transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                {(attemptLoading || autoStarting) && <Loader2 size={16} className="animate-spin" />}
                Открыть вручную
              </button>
            </>
          ) : (
            <>
              <FileText size={40} className="mx-auto mb-3 text-primary-400" />
              <p className="text-gray-700 mb-1 font-medium">
                {assignment.variant.tasks_count} задач
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Нажмите кнопку, чтобы начать. После начала таймер не останавливается.
              </p>
              {attemptError && (
                <p className="text-sm text-red-600 mb-4">{attemptError}</p>
              )}
              <button
                onClick={startAttempt}
                disabled={attemptLoading}
                className="px-6 py-3 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700
                           transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                {attemptLoading && <Loader2 size={16} className="animate-spin" />}
                Начать вариант
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Submitted → Results screen ────────────────────────────────────────────

  if (isSubmitted) {
    const score           = attempt?.score ?? null
    const maxScore        = attempt?.max_score ?? null
    const pct             = attempt?.percentage ?? null
    const corrCount       = attempt?.correct_count ?? null
    const ansCnt          = attempt?.answered_count ?? null
    const gradingStatus   = attempt?.grading_status ?? null
    const manualRevCount  = attempt?.manual_review_count ?? null
    const needsReview     = gradingStatus === 'needs_review'
    const isGraded        = gradingStatus === 'graded'
    const isSelfBuilt      = assignment.variant?.source_type === 'student_self_built'

    if (shouldShowSelfCheckStep) {
      return (
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
              <ArrowLeft size={18} />
            </button>
            <nav className="text-sm text-gray-500 flex items-center gap-1.5">
              <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
              <span>/</span>
              <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
            </nav>
          </div>
          {header}

          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={20} className="text-blue-400" />
              <h2 className="font-semibold text-gray-900">Самопроверка второй части</h2>
            </div>
            <p className="text-sm text-gray-600">
              Работа отправлена. Проверьте задачи с развёрнутым ответом, выставьте себе баллы и нажмите
              {' '}<span className="font-medium text-gray-900">«Закончить»</span>, чтобы увидеть полный итог по варианту.
            </p>
          </div>

          <div className="space-y-4">
            {selfCheckItems.map((item, idx) => (
              <div key={item.item_id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Задача {idx + 1}
                    {item.task_ext_id ? ` · №${item.task_ext_id}` : ''}
                  </span>
                  <span className="text-xs text-gray-400">{item.points} б.</span>
                </div>
                <TaskContentRenderer html={resolveTaskHtml(item.statement_html, item.assets ?? [])} />
                <SelfCheckItem
                  item={item}
                  studentAnswer={answers[item.item_id] ?? ''}
                  score={selfCheckScores[item.item_id] ?? null}
                  onScoreChange={value => setSelfCheckScore(item.item_id, value)}
                />
              </div>
            ))}
          </div>

          <SelfCheckSummary items={items} scores={selfCheckScores} />

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleFinishSelfCheck}
              className="px-5 py-2.5 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
            >
              Закончить
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <nav className="text-sm text-gray-500 flex items-center gap-1.5">
            <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
            <span>/</span>
            <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
          </nav>
        </div>
        {header}

        {/* Needs review banner */}
        {needsReview && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
            <Clock size={16} className="shrink-0 mt-0.5" />
            <span>
              Работа отправлена. {manualRevCount !== null && manualRevCount > 0
                ? `${manualRevCount} ${manualRevCount === 1 ? 'задание второй части ожидает' : 'задания второй части ожидают'} проверки преподавателем.`
                : 'Задания второй части ожидают проверки преподавателем.'}
            </span>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={20} className={isGraded ? 'text-green-500' : 'text-blue-400'} />
            <h2 className="font-semibold text-gray-900">
              {isGraded ? 'Работа проверена' : 'Вариант завершён'}
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Отвечено</p>
              <p className="text-xl font-bold text-gray-900">
                {ansCnt !== null ? `${ansCnt} / ${assignment.variant.tasks_count}` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Автобаллы</p>
              <p className="text-xl font-bold text-gray-900">
                {corrCount !== null ? corrCount : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Балл</p>
              <p className="text-xl font-bold text-gray-900">
                {score !== null && maxScore !== null ? `${score} / ${maxScore}` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500 mb-1">Процент</p>
              <p className="text-xl font-bold text-gray-900">
                {needsReview
                  ? <span className="text-base text-amber-600">Ожидает проверки</span>
                  : pct !== null ? `${pct}%` : '—'
                }
              </p>
            </div>
          </div>
          {attempt?.submitted_at && (
            <p className="text-xs text-gray-400 text-right mt-3">
              Сдано {format(new Date(attempt.submitted_at), 'd MMM yyyy HH:mm', { locale: ru })}
            </p>
          )}
        </div>

        <AutoResultsTable
          items={items}
          answers={answers}
          submittedAt={attempt?.submitted_at ?? assignment.submitted_at ?? null}
          maxScore={maxScore}
          onTaskJump={handleResultTaskJump}
        />

        {/* Read-only task list */}
        {attemptLoading ? (
          <div className="py-10 text-center">
            <Loader2 size={24} className="animate-spin text-primary-500 mx-auto" />
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item, idx) => (
              <div
                key={item.item_id}
                id={`result-task-${item.item_id}`}
                data-testid={`result-task-card-${item.item_id}`}
                className={`bg-white rounded-xl border p-4 relative overflow-hidden scroll-mt-24 transition-all duration-700 ${
                  highlightedResultItemId === item.item_id
                    ? 'border-primary-400 ring-4 ring-primary-100 shadow-lg shadow-primary-100/80'
                    : 'border-gray-200'
                }`}
              >
                {(() => {
                  const verdict = getAutoAnswerVerdict(item, answers[item.item_id])
                  return (item.exam_part === 1 || item.grading_type === 'auto') && verdict ? (
                    <div
                      data-testid={`auto-answer-corner-badge-${item.item_id}`}
                      className={`absolute right-4 top-4 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${answerStatusClass(verdict)}`}
                    >
                      {answerStatusLabel(verdict)}
                    </div>
                  ) : null
                })()}
                <div className="flex items-center justify-between mb-3 pr-24">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Задача {idx + 1}
                    {item.task_ext_id ? ` · №${item.task_ext_id}` : ''}
                  </span>
                  <span className="text-xs text-gray-400">{item.points} б.</span>
                </div>
                <TaskContentRenderer html={resolveTaskHtml(item.statement_html, item.assets ?? [])} />
                {(() => {
                  const studentAnswer = answers[item.item_id]
                  const verdict = getAutoAnswerVerdict(item, studentAnswer)
                  const score = getAutoAnswerScore(item, studentAnswer)
                  const maxPoints = item.max_points ?? item.points ?? 1
                  const correctAnswer = extractPlainText(getAutoAnswerValue(item))
                  return studentAnswer ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 inline-block">
                        Ваш ответ: <span className="font-medium">{studentAnswer}</span>
                      </div>
                      {(item.exam_part === 1 || item.grading_type === 'auto') && (
                        <>
                          <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 inline-block">
                            Правильный ответ: <span className="font-medium">{correctAnswer}</span>
                          </div>
                          <span
                            data-testid={`auto-answer-badge-${item.item_id}`}
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${answerStatusClass(verdict)}`}
                          >
                            {answerStatusLabel(verdict)}
                            {score !== null && <span className="ml-1 opacity-80">{score}/{maxPoints}</span>}
                          </span>
                        </>
                      )}
                    </div>
                  ) : null
                })()}
                <ResultTaskReveal item={item} />
                {/* Self-built variant, part 2 (or unmarked part): client-only
                    self-assessment. Never touches the server — grading_type
                    stays 'auto' and points were zeroed at variant-build time,
                    so this can never leak into score/stats. */}
                {isSelfBuilt && item.exam_part !== 1 && (
                  <SelfCheckItem
                    item={item}
                    studentAnswer={answers[item.item_id] ?? ''}
                    score={selfCheckScores[item.item_id] ?? null}
                    onScoreChange={value => setSelfCheckScore(item.item_id, value)}
                  />
                )}
                {/* Graded result per manual item */}
                {isGraded && gradedAnswers[item.item_id] && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        Балл: <span className="text-primary-700">
                          {gradedAnswers[item.item_id].points_earned ?? '—'} / {gradedAnswers[item.item_id].points_max ?? item.points}
                        </span>
                      </span>
                    </div>
                    {gradedAnswers[item.item_id].teacher_comment && (
                      <div className="flex gap-2 text-sm text-gray-600 bg-blue-50 rounded-lg px-3 py-2">
                        <MessageSquare size={14} className="shrink-0 mt-0.5 text-blue-400" />
                        <span>{gradedAnswers[item.item_id].teacher_comment}</span>
                      </div>
                    )}
                    {attachments[item.item_id]?.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Paperclip size={11} /> Ваши вложения
                        </div>
                        {attachments[item.item_id].map(att => (
                          <SignedImage key={att.id} path={att.storage_path} name={att.file_name} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isSelfBuilt && <SelfCheckSummary items={items} scores={selfCheckScores} />}

        {/* Разбор работы — summary after grading */}
        {isGraded && Object.keys(gradedAnswers).length > 0 && (
          <div className="mt-6 bg-green-50 rounded-xl border border-green-200 p-4">
            <h3 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
              <CheckCircle2 size={16} /> Разбор работы
            </h3>
            <div className="space-y-2">
              {items.map((item, idx) => {
                const ga = gradedAnswers[item.item_id]
                if (!ga) return null
                return (
                  <div key={item.item_id} className="flex items-start justify-between text-sm gap-3 py-1.5 border-b border-green-100 last:border-0">
                    <span className="text-gray-600 shrink-0">Задача {idx + 1}</span>
                    <span className="font-medium text-gray-800">
                      {ga.points_earned ?? '—'} / {ga.points_max ?? item.points} б.
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Active attempt ────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {showConfirm && (
        <ConfirmDialog
          answeredCount={answeredCount}
          totalCount={items.length}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowConfirm(false)}
          loading={submitting}
          error={submitError}
        />
      )}

      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/student/variants')} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <nav className="text-sm text-gray-500 flex items-center gap-1.5 min-w-0">
          <Link to="/student/variants" className="hover:text-primary-600">Тренировочные варианты</Link>
          <span>/</span>
          <span className="text-gray-700 truncate max-w-xs">{assignment.variant.title}</span>
        </nav>

        {/* Progress pill */}
        <span className="ml-auto shrink-0 text-xs bg-primary-50 text-primary-700 font-medium rounded-full px-3 py-1">
          {answeredCount} / {items.length} отвечено
        </span>
      </div>

      {header}

      {attemptError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-700">
          {attemptError}
        </div>
      )}

      {attemptLoading ? (
        <div className="py-10 text-center">
          <Loader2 size={24} className="animate-spin text-primary-500 mx-auto" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          <FileText size={32} className="mx-auto mb-2 text-gray-300" />
          <p>В этом варианте нет задач</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {items.map((item, idx) => (
              <div key={item.item_id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                      Задача {idx + 1}
                      {item.task_ext_id ? ` · №${item.task_ext_id}` : ''}
                    </span>
                    {item.grading_type === 'manual' && (
                      <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-medium">
                        Развёрнутый ответ
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{item.points} б.</span>
                </div>
                <TaskContentRenderer html={resolveTaskHtml(item.statement_html, item.assets ?? [])} />
                {item.grading_type === 'manual' ? (
                  <ManualAnswerInput
                    itemId={item.item_id}
                    studentAssignmentId={assignmentId!}
                    value={answers[item.item_id] ?? ''}
                    onChange={setAnswer}
                    saveState={saveStates[item.item_id] ?? 'idle'}
                    disabled={false}
                    attachments={attachments[item.item_id] ?? []}
                    onAttachmentAdd={addAttachment}
                    onAttachmentDelete={removeAttachment}
                  />
                ) : (
                  <VariantAnswerInput
                    itemId={item.item_id}
                    value={answers[item.item_id] ?? ''}
                    onChange={setAnswer}
                    saveState={saveStates[item.item_id] ?? 'idle'}
                    disabled={false}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setShowConfirm(true)}
              className="px-5 py-2.5 rounded-xl bg-primary-600 text-white font-medium hover:bg-primary-700
                         transition-colors flex items-center gap-2"
            >
              <Send size={15} />
              Завершить вариант
            </button>
          </div>
        </>
      )}
    </div>
  )
}
