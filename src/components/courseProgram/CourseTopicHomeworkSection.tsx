import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2, Users, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ATTEMPT_STATUS_TONE, gradeScaleMax, type TopicHomeworkAttemptStatus } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { toast } from '@/store/toastStore'
import { homeworkIssueStatus, type HomeworkIssueState } from '@/lib/homeworkIssue'
import { TopicOpenToggle } from '@/components/courseProgram/TopicOpenToggle'
import { clearPersonalWindow, setPersonalWindow, type PersonalWindowRow } from '@/hooks/useTimedWork'
import {
  WORK_KIND_TAG, formatMoscowShort, formatMoscowTime, isTimedKind, normalizeTopicKind, parseWindowDraft,
  windowDraftOf, type WindowDraft,
} from '@/lib/timedWork'
import {
  deadlineLabel, deadlineSummary, deadlineTone, formatDueDate, homeworkDeadline,
  type DeadlineState, type DeadlineTone,
} from '@/lib/homeworkDeadline'

interface Module {
  id: string
  title: string
  // is_open/available_from нужны тумблеру открытости в строке темы; состояние
  // он считает через общий topicAvailability.ts, своей копии правила тут нет.
  topics: { id: string; title: string; is_open: boolean | null; available_from: string | null; kind?: string | null }[]
}

interface RosterStudent {
  studentId: string
  name: string
}

interface TopicHomework {
  id: string
  topic_id: string
  title: string
  grade_scale: 'five' | 'hundred' | null
  is_published: boolean
  /** §240. Окно работы по времени. */
  opens_at?: string | null
  closes_at?: string | null
  /** §259. Срок ДЗ (date, «до» включительно). */
  due_at?: string | null
}

interface TopicHomeworkAttempt {
  id: string
  homework_id: string
  student_id: string
  attempt_number: number
  status: TopicHomeworkAttemptStatus
  submitted_at: string | null
  /** §240. Сдано автоматически в момент закрытия. */
  auto_submitted?: boolean
  created_at: string
  updated_at: string
  topic_homework_reviews?: Array<{
    decision: string
    score: number | null
    created_at: string
  }>
}

interface StudentAttemptStatus {
  status: TopicHomeworkAttemptStatus
  score: number | null
  submittedAt: string | null
}

const ATTEMPT_STATUS_LABEL: Record<TopicHomeworkAttemptStatus, string> = {
  draft: 'Не сдано',
  submitted: 'На проверке',
  returned_for_revision: 'На доработке',
  accepted: 'Выполнено',
}

/** §243. Статус выдачи у темы — цвета как в окне темы. */
const ISSUE_TEXT: Record<HomeworkIssueState, string> = {
  issued: 'text-emerald-700',
  closed: 'text-gray-500',
  no_files: 'text-amber-700',
  template: 'text-primary-700',
}
const ISSUE_DOT: Record<HomeworkIssueState, string> = {
  issued: 'bg-emerald-500', closed: 'bg-gray-400', no_files: 'bg-amber-500', template: 'bg-primary-400',
}

/**
 * §259. Колонка «Срок» и сводка: вовремя — зелёный, опоздание — янтарный,
 * просрочено — красный, ещё / сегодня — серый (токены verdict дизайна v2).
 */
const DEADLINE_CHIP: Record<DeadlineTone, string> = {
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  late: 'bg-verdict-part-tint text-verdict-part-ink',
  bad: 'bg-verdict-bad-tint text-verdict-bad-ink',
  wait: 'bg-graphite-100 text-graphite-600',
  none: 'text-graphite-400',
}

function DeadlineChip({ state }: { state: DeadlineState }) {
  const tone = deadlineTone(state)
  return (
    <span
      data-testid="hw-deadline"
      data-kind={state.kind}
      className={cn('inline-block whitespace-nowrap rounded-full text-xs font-bold', tone !== 'none' && 'px-2 py-0.5', DEADLINE_CHIP[tone])}
    >
      {deadlineLabel(state)}
    </span>
  )
}

const ATTEMPT_STATUS_BADGE_COLORS: Record<TopicHomeworkAttemptStatus, string> = {
  accepted: 'bg-emerald-50 text-emerald-700',
  submitted: 'bg-blue-50 text-blue-700',
  returned_for_revision: 'bg-amber-50 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getLatestAttempt(
  attempts: TopicHomeworkAttempt[],
  homeworkId: string,
  studentId: string,
): TopicHomeworkAttempt | null {
  return (
    attempts
      .filter(a => a.homework_id === homeworkId && a.student_id === studentId)
      .sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null
  )
}

function getLatestReview(
  attempt: TopicHomeworkAttempt,
) {
  const reviews = attempt.topic_homework_reviews || []
  return reviews.length > 0 ? reviews[reviews.length - 1] : null
}

function getStudentAttemptStatus(
  homeworkId: string,
  studentId: string,
  attempts: TopicHomeworkAttempt[],
): StudentAttemptStatus {
  const latest = getLatestAttempt(attempts, homeworkId, studentId)

  if (!latest) {
    return { status: 'draft', score: null, submittedAt: null }
  }

  if (latest.status === 'accepted') {
    const review = getLatestReview(latest)
    return { status: 'accepted', score: review?.score ?? null, submittedAt: latest.submitted_at }
  }

  return { status: latest.status, score: null, submittedAt: latest.submitted_at }
}

export function CourseTopicHomeworkSection({ courseId, modules, refreshKey = 0, onToggleTopicOpen, focusTopicId = null, onEditDeadline }: {
  courseId: string
  modules: Module[]
  refreshKey?: number
  /** Тумблер открытости в строке темы. Без него раздел работает как раньше. */
  onToggleTopicOpen?: (topicId: string, isOpen: boolean) => Promise<void>
  /**
   * §241. Тема, с которой пришли из раздела «Контрольные, самостоятельные и
   * пробники» («Кто пишет» / «Работы»): раскрыта сразу и прокручена в вид.
   */
  focusTopicId?: string | null
  /**
   * §259. «изменить / задать» у срока: открыть окно темы на блоке ДЗ, где срок
   * уже редактируется (`TopicHomeworkEditor`). Своего поля срока здесь нет.
   */
  onEditDeadline?: (topicId: string) => void
}) {
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [homeworks, setHomeworks] = useState<TopicHomework[]>([])
  const [attempts, setAttempts] = useState<TopicHomeworkAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(() => new Set(focusTopicId ? [focusTopicId] : []))
  /** Сколько файлов у каждого ДЗ: без файлов ДЗ не выдаётся (§243). */
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({})
  const [reloadKey, setReloadKey] = useState(0)
  /** §240. Личные окна учеников по работам по времени («Открыть заново»). */
  const [personalWindows, setPersonalWindows] = useState<PersonalWindowRow[]>([])
  /** Открытая форма «Открыть заново»: какая работа и какой ученик. */
  const [reopen, setReopen] = useState<{ homeworkId: string; studentId: string; draft: WindowDraft; error: string | null; busy: boolean } | null>(null)

  useEffect(() => {
    // Флажок живёт ВНУТРИ эффекта: в StrictMode эффект гоняется дважды,
    // и внешний объект остался бы «отменённым» навсегда (вечный спиннер).
    const cancelled = { value: false }
    const abortController = new AbortController()

    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        // Get all topic IDs
        const allTopicIds = modules.flatMap(m => m.topics.map(t => t.id))
        if (allTopicIds.length === 0) {
          setRoster([])
          setHomeworks([])
          setAttempts([])
          return
        }

        // Load roster
        const rosterResult = (await supabase
          .from('group_students')
          .select('student_id, groups!inner(course_id), students!inner(id, profiles!inner(full_name))')
          .eq('groups.course_id', courseId)) as any

        if (rosterResult.error) throw new Error(rosterResult.error.message)

        const rosterData = (rosterResult.data || []) as any[]
        const rosterMap = new Map<string, string>()
        for (const row of rosterData) {
          const studentId = row.student_id
          const name = row.students?.profiles?.full_name || 'Ученик'
          if (!rosterMap.has(studentId)) {
            rosterMap.set(studentId, name)
          }
        }
        const rosterArray: RosterStudent[] = Array.from(rosterMap.entries()).map(([studentId, name]) => ({
          studentId,
          name,
        }))

        // Load homeworks
        // `*`: окно работы по времени (§240) — новые столбцы; явный перечень
        // уронил бы раздел целиком, пока миграция не применена.
        const homeworksResult = (await supabase
          .from('topic_homework')
          .select('*')
          .in('topic_id', allTopicIds)) as any

        if (homeworksResult.error) throw new Error(homeworksResult.error.message)

        const homeworksData = (homeworksResult.data || []) as TopicHomework[]

        // Load attempts
        if (homeworksData.length > 0) {
          const hwIds = homeworksData.map(hw => hw.id)
          const attemptsResult = (await supabase
            .from('topic_homework_attempts')
            .select('*, topic_homework_reviews(decision, score, created_at)')
            .in('homework_id', hwIds)) as any

          if (attemptsResult.error) throw new Error(attemptsResult.error.message)

          const attemptsData = (attemptsResult.data || []) as TopicHomeworkAttempt[]

          // Файлы задания — только их число: у ДЗ без файлов статус «Нет
          // файлов задания», сервер такое ДЗ не выдаёт (§243).
          const filesResult = (await supabase
            .from('topic_homework_files')
            .select('homework_id')
            .in('homework_id', hwIds)) as any

          if (filesResult.error) throw new Error(filesResult.error.message)

          const counts: Record<string, number> = {}
          for (const row of (filesResult.data || []) as { homework_id: string }[]) {
            counts[row.homework_id] = (counts[row.homework_id] ?? 0) + 1
          }

          // §240. Личные окна — только по работам по времени. Отдельно и без
          // падения: до миграции таблицы нет, и раздел ДЗ не должен из-за
          // этого пропасть.
          const timedTopicIds = new Set(
            modules.flatMap(m => m.topics).filter(t => isTimedKind(t.kind)).map(t => t.id),
          )
          const timedHwIds = homeworksData.filter(h => timedTopicIds.has(h.topic_id)).map(h => h.id)
          let windows: PersonalWindowRow[] = []
          if (timedHwIds.length > 0) {
            // Таблицы §240 нет в сгенерированных типах — как у прочих новых таблиц.
            const winRes = (await supabase
              .from('topic_homework_personal_windows' as never)
              .select('homework_id, student_id, opens_at, closes_at')
              .in('homework_id', timedHwIds)) as { data: PersonalWindowRow[] | null; error: unknown }
            windows = winRes.error ? [] : (winRes.data ?? [])
          }

          if (!cancelled.value) {
            setRoster(rosterArray)
            setHomeworks(homeworksData)
            setAttempts(attemptsData)
            setFileCounts(counts)
            setPersonalWindows(windows)
          }
        } else {
          if (!cancelled.value) {
            setRoster(rosterArray)
            setHomeworks([])
            setAttempts([])
            setFileCounts({})
          }
        }
      } catch (e: any) {
        if (!cancelled.value) {
          setError(e.message || 'Не удалось загрузить данные')
        }
      } finally {
        if (!cancelled.value) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled.value = true
      abortController.abort()
    }
  }, [courseId, modules, refreshKey, reloadKey])

  /** §240. Сохранить ученику личное окно. Правила (персонал, нет сданной) держит сервер. */
  async function saveReopen() {
    if (!reopen) return
    const parsed = parseWindowDraft(reopen.draft)
    if (parsed.kind !== 'ok') {
      setReopen(r => r && { ...r, error: parsed.kind === 'invalid' ? parsed.message : 'Укажите дату и время открытия и закрытия' })
      return
    }
    setReopen(r => r && { ...r, busy: true, error: null })
    try {
      await setPersonalWindow(reopen.homeworkId, reopen.studentId, parsed.opensAt, parsed.closesAt)
      toast.success('Работа открыта заново для ученика')
      setReopen(null)
      setReloadKey(k => k + 1)
    } catch (e) {
      setReopen(r => r && { ...r, busy: false, error: e instanceof Error ? e.message : 'Не удалось сохранить' })
    }
  }

  async function dropPersonal(homeworkId: string, studentId: string) {
    try {
      await clearPersonalWindow(homeworkId, studentId)
      toast.success('Личное время снято — ученику снова действует общее')
      setReloadKey(k => k + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось снять личное время')
    }
  }

  const toggleTopic = (topicId: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }

  // Calculate statistics
  const getTopicStats = (topicId: string, topicHomeworks: TopicHomework[]) => {
    const stats = {
      accepted: 0,
      submitted: 0,
      returned_for_revision: 0,
      draft: 0,
    }

    for (const hw of topicHomeworks) {
      for (const student of roster) {
        const status = getStudentAttemptStatus(hw.id, student.studentId, attempts)
        stats[status.status]++
      }
    }

    return stats
  }

  const getTotalStats = () => {
    const stats = {
      accepted: 0,
      submitted: 0,
      returned_for_revision: 0,
      draft: 0,
    }

    for (const hw of homeworks) {
      for (const student of roster) {
        const status = getStudentAttemptStatus(hw.id, student.studentId, attempts)
        stats[status.status]++
      }
    }

    return stats
  }

  // §241. Пришли за конкретной темой — прокрутить к ней, когда список готов.
  useEffect(() => {
    if (loading || !focusTopicId) return
    setExpandedTopics(prev => (prev.has(focusTopicId) ? prev : new Set(prev).add(focusTopicId)))
    const el = document.querySelector(`[data-hw-topic="${focusTopicId}"]`)
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [loading, focusTopicId])

  /** §259. Срок у ученика — по ВСЕМ его попыткам этого ДЗ (первая сдача). */
  const nowMs = Date.now()
  const deadlineOf = (hw: TopicHomework, studentId: string): DeadlineState => homeworkDeadline(
    hw.due_at ?? null,
    attempts.filter(a => a.homework_id === hw.id && a.student_id === studentId),
    nowMs,
  )

  const totalStats = getTotalStats()
  const totalHomeworks = homeworks.length
  const totalAssignments = totalHomeworks * roster.length
  const completedAssignments = totalStats.accepted

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex gap-2">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  if (roster.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
        <Users size={32} className="mx-auto mb-3 opacity-30 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">В курсе пока нет учеников</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      {totalHomeworks > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800 font-medium">
            Выполнено {completedAssignments} из {totalAssignments} работ по курсу
          </p>
        </div>
      )}

      {/* §243. Плашки «Не опубликовано ДЗ: N» и кнопок публикации больше нет:
          ДЗ выдаётся само, пока тема открыта. У каждой темы — статус выдачи. */}

      {/* Module sections */}
      {modules.map(module => {
        const moduleTopicsWithHw = module.topics.filter(topic =>
          homeworks.some(hw => hw.topic_id === topic.id),
        )

        return (
          <div key={module.id} className="space-y-2">
            {/* Module header */}
            <div className="flex items-center justify-between gap-3 rounded-lg bg-primary-50/50 px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">{module.title}</h3>
            </div>

            {/* Topics in module */}
            {module.topics.map(topic => {
              const topicHomeworks = homeworks.filter(hw => hw.topic_id === topic.id)
              const isExpanded = expandedTopics.has(topic.id)
              // §240. Проверочная / контрольная: колонка «Время» и «Открыть заново».
              const timedTopic = isTimedKind(topic.kind)
              const stats = getTopicStats(topic.id, topicHomeworks)
              // §243. Выдано ли ДЗ — правилом сервера: тема открыта и есть файл
              // (у работы по времени файл не нужен).
              const issue = homeworkIssueStatus({
                topic,
                fileCount: topicHomeworks.reduce((n, hw) => n + (fileCounts[hw.id] ?? 0), 0),
                timed: timedTopic,
              })
              // §259. Срок — у обычного ДЗ (у проверочной/контрольной — окно).
              const deadlineHw = !timedTopic ? topicHomeworks[0] ?? null : null
              const dueText = deadlineHw ? formatDueDate(deadlineHw.due_at) : null
              const dueSummary = deadlineHw && dueText
                ? deadlineSummary(roster.map(st => deadlineOf(deadlineHw, st.studentId)))
                : null

              if (topicHomeworks.length === 0) {
                return (
                  <div key={topic.id} className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-100 bg-white/50">
                    <p className="text-sm text-gray-500">
                      {topic.title} — <span className="italic text-gray-400">ДЗ не создано</span>
                    </p>
                    {onToggleTopicOpen && (
                      <TopicOpenToggle topic={topic} onToggle={v => onToggleTopicOpen(topic.id, v)} />
                    )}
                  </div>
                )
              }

              return (
                <div key={topic.id} data-hw-topic={topic.id} className="scroll-mt-24 border border-gray-200 rounded-lg overflow-hidden bg-white">
                  {/* Topic header (collapsible). Тумблер — СОСЕД кнопки, а не
                      её потомок: кнопка внутри кнопки невалидна, и клик по
                      тумблеру всё равно сворачивал бы тему. */}
                  {/* §259: на телефоне бейджи и тумблер уходят на следующую строку —
                      раньше они сжимали название темы до нуля. */}
                  <div className="flex flex-wrap items-center gap-x-2 pr-4 max-sm:pb-2 max-sm:pl-11">
                  <button
                    onClick={() => toggleTopic(topic.id)}
                    className="min-w-0 flex-1 basis-[16rem] px-4 py-3 hover:bg-gray-50 transition-colors flex flex-wrap items-center justify-between gap-2 max-sm:-ml-11"
                  >
                    <div className="flex items-center gap-3 min-w-[12rem] flex-1">
                      {isExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                      {timedTopic && (
                        <span
                          data-testid="hw-section-kind"
                          className={cn(
                            'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold',
                            normalizeTopicKind(topic.kind) === 'control' ? 'bg-primary-900 text-white' : 'bg-primary-400 text-white',
                          )}
                        >
                          {WORK_KIND_TAG[normalizeTopicKind(topic.kind)]}
                        </span>
                      )}
                      <span className="flex min-w-0 flex-col items-start text-left">
                        <span className="w-full truncate text-sm font-medium text-gray-900">{topic.title}</span>
                        <span
                          data-testid="hw-section-issue"
                          data-state={issue.state}
                          className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-semibold', ISSUE_TEXT[issue.state])}
                        >
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ISSUE_DOT[issue.state])} />
                          <span className="truncate">{issue.label}{issue.state === 'closed' && issue.note ? ` · ${issue.note}` : ''}</span>
                        </span>
                      </span>
                      {timedTopic && (
                        <span className="hidden shrink-0 text-xs tabular-nums text-gray-500 sm:inline">
                          {topicHomeworks[0]?.opens_at
                            ? `${formatMoscowShort(topicHomeworks[0].opens_at)}–${formatMoscowTime(topicHomeworks[0].closes_at)}`
                            : 'время не назначено'}
                        </span>
                      )}
                    </div>

                    {/* Status badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      {stats.accepted > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                          <span>✓</span> {stats.accepted}
                        </span>
                      )}
                      {stats.submitted > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                          <span>⏳</span> {stats.submitted}
                        </span>
                      )}
                      {stats.returned_for_revision > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                          <span>↻</span> {stats.returned_for_revision}
                        </span>
                      )}
                      {stats.draft > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                          <span>—</span> {stats.draft}
                        </span>
                      )}
                    </div>
                  </button>
                  {onToggleTopicOpen && (
                    <TopicOpenToggle topic={topic} onToggle={v => onToggleTopicOpen(topic.id, v)} />
                  )}
                  </div>

                  {/* §259. Срок и «вовремя / с опозданием / не сдали». У работы
                      по времени срока нет — у неё окно (строка выше). */}
                  {deadlineHw && (
                    <div data-testid="hw-due-line" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-3 pl-11">
                      <span
                        data-testid="hw-due"
                        data-set={dueText ? 'true' : 'false'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-graphite-200 bg-graphite-50 px-2.5 py-1 text-[13px] font-bold text-graphite-900"
                      >
                        {dueText ? `Срок: до ${dueText}` : 'Срок не задан'}
                        {onEditDeadline && (
                          <>
                            {!dueText && <span aria-hidden className="font-normal text-graphite-400">·</span>}
                            <button
                              type="button"
                              data-testid="hw-due-edit"
                              onClick={() => onEditDeadline(topic.id)}
                              aria-label={`${dueText ? 'Изменить' : 'Задать'} срок ДЗ: ${topic.title}`}
                              className="rounded text-xs font-semibold text-primary-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                            >
                              {dueText ? 'изменить' : 'задать'}
                            </button>
                          </>
                        )}
                      </span>
                      {dueSummary && (
                        <span data-testid="hw-due-summary" className="flex flex-wrap gap-1.5">
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', DEADLINE_CHIP.ok)}>вовремя {dueSummary.ontime}</span>
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', DEADLINE_CHIP.late)}>с опозданием {dueSummary.late}</span>
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', dueSummary.missing > 0 ? DEADLINE_CHIP.bad : DEADLINE_CHIP.wait)}>не сдали {dueSummary.missing}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Expanded table */}
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {/* §259: на телефоне таблица листается внутри себя, страница не шире экрана. */}
                      <div className="overflow-x-auto" data-testid="hw-section-scroll">
                        <table className={cn('w-full text-sm', !timedTopic && 'min-w-[600px]')}>
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ученик</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Статус</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Балл</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Дата сдачи</th>
                              {timedTopic && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Время</th>}
                              {!timedTopic && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Срок</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map((student, idx) => {
                              // For simplicity, show status for the first homework in topic
                              // If there are multiple homeworks, could aggregate or show per-hw
                              const firstHw = topicHomeworks[0]
                              if (!firstHw) return null

                              const studentStatus = getStudentAttemptStatus(firstHw.id, student.studentId, attempts)
                              const attempt = getLatestAttempt(attempts, firstHw.id, student.studentId)
                              const review = attempt ? getLatestReview(attempt) : null
                              const maxScore = gradeScaleMax(firstHw.grade_scale)
                              const personal = timedTopic
                                ? personalWindows.find(w => w.homework_id === firstHw.id && w.student_id === student.studentId) ?? null
                                : null
                              // Сданная работа (любой статус, кроме черновика) — открыть заново нельзя.
                              const hasSubmitted = !!attempt && attempt.status !== 'draft'
                              const formHere = reopen?.homeworkId === firstHw.id && reopen.studentId === student.studentId

                              return (
                                <tr
                                  key={student.studentId}
                                  data-testid="hw-section-row"
                                  className={cn('border-b border-gray-100 align-top', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                                >
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-900">{student.name}</span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span
                                      className={cn(
                                        'inline-block px-2 py-0.5 rounded-md text-xs font-medium',
                                        ATTEMPT_STATUS_BADGE_COLORS[studentStatus.status],
                                      )}
                                    >
                                      {timedTopic && studentStatus.status === 'submitted' && attempt?.auto_submitted
                                        ? 'Сдано автоматически'
                                        : ATTEMPT_STATUS_LABEL[studentStatus.status]}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-600">
                                      {studentStatus.status === 'accepted' && studentStatus.score !== null && maxScore
                                        ? `${studentStatus.score}/${maxScore}`
                                        : '—'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-600">{formatDate(studentStatus.submittedAt)}</span>
                                  </td>
                                  {!timedTopic && (
                                    <td className="px-4 py-2">
                                      <DeadlineChip state={deadlineOf(firstHw, student.studentId)} />
                                    </td>
                                  )}
                                  {timedTopic && (
                                    <td className="px-4 py-2">
                                      {formHere && reopen ? (
                                        <div data-testid="hw-reopen-form" className="flex min-w-[240px] flex-col gap-1.5">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <input
                                              type="date"
                                              aria-label="Дата"
                                              value={reopen.draft.date}
                                              onChange={e => setReopen(r => r && { ...r, draft: { ...r.draft, date: e.target.value }, error: null })}
                                              className="h-8 rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                            <input
                                              type="time"
                                              aria-label="Открывается"
                                              value={reopen.draft.opens}
                                              onChange={e => setReopen(r => r && { ...r, draft: { ...r.draft, opens: e.target.value }, error: null })}
                                              className="h-8 rounded-lg border border-gray-200 px-2 text-xs tabular-nums"
                                            />
                                            <span className="text-xs text-gray-400">–</span>
                                            <input
                                              type="time"
                                              aria-label="Закрывается"
                                              value={reopen.draft.closes}
                                              onChange={e => setReopen(r => r && { ...r, draft: { ...r.draft, closes: e.target.value }, error: null })}
                                              className="h-8 rounded-lg border border-gray-200 px-2 text-xs tabular-nums"
                                            />
                                          </div>
                                          <p className="text-[11px] text-gray-500">Время московское. Личное время заменяет общее для этого ученика.</p>
                                          {reopen.error && <p className="text-xs text-red-600">{reopen.error}</p>}
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              data-testid="hw-reopen-save"
                                              disabled={reopen.busy}
                                              onClick={() => { void saveReopen() }}
                                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                                            >
                                              {reopen.busy && <Loader2 size={12} className="animate-spin" />}
                                              Открыть
                                            </button>
                                            <button type="button" onClick={() => setReopen(null)} className="text-xs text-gray-500 hover:text-gray-900">Отмена</button>
                                          </div>
                                        </div>
                                      ) : personal ? (
                                        <div className="flex flex-col gap-0.5 text-xs">
                                          <span data-testid="hw-personal-window" className="font-semibold text-primary-800">
                                            лично: {formatMoscowShort(personal.opens_at)}–{formatMoscowTime(personal.closes_at)}
                                          </span>
                                          {!hasSubmitted && (
                                            <button type="button" onClick={() => { void dropPersonal(firstHw.id, student.studentId) }} className="self-start text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
                                              Снять
                                            </button>
                                          )}
                                        </div>
                                      ) : !hasSubmitted ? (
                                        <button
                                          type="button"
                                          data-testid="hw-reopen"
                                          onClick={() => setReopen({
                                            homeworkId: firstHw.id,
                                            studentId: student.studentId,
                                            draft: windowDraftOf(firstHw.opens_at, firstHw.closes_at),
                                            error: null,
                                            busy: false,
                                          })}
                                          className="inline-flex h-8 items-center rounded-lg border border-primary-200 bg-white px-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                                        >
                                          Открыть заново
                                        </button>
                                      ) : (
                                        <span className="text-xs text-gray-400">—</span>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {homeworks.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-700">В этом курсе нет домашних заданий по темам</p>
        </div>
      )}
    </div>
  )
}
