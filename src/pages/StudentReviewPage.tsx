import { useState, useEffect, useRef, lazy, Suspense, type RefObject } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, RotateCcw, FileText, MessageSquare, History, ArrowRight,
  AlertTriangle, Loader2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { cn } from '@/utils/cn'
import { notifyHomeworkChecked } from '@/utils/notify'
import { toast } from '@/store/toastStore'
import { loadHomeworkInfo, loadHomeworkReviewRoster } from '@/pages/reviewScope'
import {
  fetchHomeworkSubmissionFilesMap,
  getSubmissionFileAttempts,
  getPrimarySubmissionFilePath,
  getSubmissionFilePaths,
  type HomeworkSubmissionFileRow,
} from '@/lib/homeworkSubmissionFiles'
import { getQueueItemReviewPath, loadPendingQueueItems, resolveNextQueueItem, type QueueItem } from '@/lib/pendingQueue'

const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))
const PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']

interface HwInfo {
  id: string
  title: string
  max_score: number
}

interface Submission {
  id: string
  status: string
  answer_text: string | null
  file_url: string | null
  homework_submission_files?: HomeworkSubmissionFileRow[] | null
  score: number | null
  feedback: string | null
  submitted_at: string | null
}

interface StudentInfo {
  id: string
  name: string
  profileId: string
}

interface GradingCardProps {
  maxScore: number
  score: string
  feedback: string
  status: string
  scoreInvalid: boolean
  saved: boolean
  saving: boolean
  scoreInputRef: RefObject<HTMLInputElement | null>
  acceptLabel: string
  acceptLoading?: boolean
  onScoreDraftChange: (value: string) => void
  onFeedbackDraftChange: (value: string) => void
  onScoreChange: (value: string) => void
  onFeedbackChange: (value: string) => void
  onRevision: () => void
  onAccept: () => void
}

const QUICK_PHRASES = [
  'Молодец!', 'Хорошая работа', 'Отличный результат!', 'Проверь вычисления',
  'Нужно переделать', 'Невнимательность', 'Не забудь единицы измерения',
  'Покажи решение полностью', 'Ошибка в формуле', 'Почти правильно',
]

function GradingCard({
  maxScore,
  score,
  feedback,
  status,
  scoreInvalid,
  saved,
  saving,
  scoreInputRef,
  acceptLabel,
  acceptLoading = false,
  onScoreDraftChange,
  onFeedbackDraftChange,
  onScoreChange,
  onFeedbackChange,
  onRevision,
  onAccept,
}: GradingCardProps) {
  const [draftScore, setDraftScore] = useState(score)
  const [draftFeedback, setDraftFeedback] = useState(feedback)

  useEffect(() => {
    setDraftScore(score)
  }, [score])

  useEffect(() => {
    setDraftFeedback(feedback)
  }, [feedback])

  const commitDraft = () => {
    onScoreChange(draftScore)
    onFeedbackChange(draftFeedback)
  }

  const normalizedScore = draftScore === '' || isNaN(parseInt(draftScore)) ? null : parseInt(draftScore)
  const showScoreInvalid = scoreInvalid && draftScore === score
  const statusTone = status === 'checked'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : status === 'revision'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : status === 'submitted'
        ? 'bg-sky-50 text-sky-700 ring-sky-200'
        : 'bg-slate-100 text-slate-600 ring-slate-200'
  const statusLabel = status === 'checked'
    ? 'Проверено'
    : status === 'revision'
      ? 'На доработке'
      : status === 'submitted'
        ? 'Ожидает проверки'
        : 'Не сдано'

  return (
    <div data-testid="student-review-grading-card" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Итог проверки</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageSquare size={15} className="text-primary-500" />
            Оценка и комментарий
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-3 py-1.5 text-xs font-medium ring-1', statusTone)}>
            {statusLabel}
          </span>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Балл</div>
            <div className="flex items-baseline gap-1 text-sm font-semibold text-slate-900">
              <span>{normalizedScore ?? '—'}</span>
              <span className="text-slate-400">/ {maxScore}</span>
              {normalizedScore != null && (
                <span className={cn(
                  'ml-1 text-xs font-semibold',
                  normalizedScore / maxScore >= 0.8 ? 'text-emerald-600' :
                  normalizedScore / maxScore >= 0.5 ? 'text-amber-600' : 'text-rose-500',
                )}>
                  {Math.round(normalizedScore / maxScore * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem] lg:items-start">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Комментарий для ученика</label>
          <div className="mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-auto">
            {QUICK_PHRASES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  const next = draftFeedback ? `${draftFeedback} ${p}` : p
                  setDraftFeedback(next)
                  onFeedbackDraftChange(next)
                }}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              >
                {p}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={draftFeedback}
            onChange={e => {
              setDraftFeedback(e.target.value)
              onFeedbackDraftChange(e.target.value)
            }}
            onBlur={commitDraft}
            placeholder="Что сделано хорошо, что нужно исправить…"
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Балл</label>
          <input
            data-testid="student-review-score-input"
            ref={scoreInputRef}
            type="number"
            min={0}
            max={maxScore}
            value={draftScore}
            onChange={e => {
              setDraftScore(e.target.value)
              onScoreDraftChange(e.target.value)
            }}
            onBlur={commitDraft}
            placeholder="—"
            className={cn(
              'w-full rounded-xl border px-3 py-2 text-center text-base font-semibold text-primary-700 focus:outline-none focus:ring-2 lg:w-28',
              showScoreInvalid ? 'border-red-500 ring-2 ring-red-200' : 'border-slate-200 focus:ring-primary-500',
            )}
          />
          <div className="mt-1 text-center text-xs text-slate-400">из {maxScore}</div>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-t border-slate-100 pt-4 md:flex-row md:items-center md:justify-between">
        {saved
          ? <span className="flex items-center gap-1 text-sm font-medium text-emerald-600"><CheckCircle size={14} />Сохранено</span>
          : <span className="h-5" />
        }
        <div className="flex flex-col items-stretch gap-2 sm:flex-row">
          <Button data-testid="student-review-revision-button" size="sm" variant="secondary" onClick={() => { commitDraft(); onRevision() }} loading={saving}>
            <RotateCcw size={14} className="mr-1" />На доработку
          </Button>
          <Button data-testid="student-review-publish-button" size="sm" onClick={() => { commitDraft(); onAccept() }} loading={acceptLoading}>
            <CheckCircle size={14} className="mr-1" />{acceptLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function StudentReviewPage() {
  const { id: hwId, groupId, studentId } = useParams<{ id: string; groupId?: string; studentId: string }>()
  const navigate  = useNavigate()
  const location = useLocation()
  const profile   = useAuthStore(s => s.profile)
  const fromQueue = location.state && typeof location.state === 'object' && 'from' in location.state && location.state.from === 'queue'

  const [hw,        setHw]        = useState<HwInfo | null>(null)
  const [student,   setStudent]   = useState<StudentInfo | null>(null)
  const [sub,       setSub]       = useState<Submission | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [teacherId, setTeacherId] = useState<string | null>(null)

  // Sibling students for prev/next nav
  const [siblings, setSiblings]   = useState<{ studentId: string; name: string }[]>([])

  const [score,    setScore]    = useState('')
  const [scoreInvalid, setScoreInvalid] = useState(false)
  const scoreInputRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const publishStatusRef = useRef<'checked' | 'revision'>('checked')
  const scoreDraftRef = useRef('')
  const feedbackDraftRef = useRef('')
  const [resolvedGroupName, setResolvedGroupName] = useState<string | null>(null)
  const [selectedAttemptNumber, setSelectedAttemptNumber] = useState<number | null>(null)
  const [pendingQueueItems, setPendingQueueItems] = useState<QueueItem[]>([])
  const [queueLoading, setQueueLoading] = useState(false)

  useEffect(() => {
    scoreDraftRef.current = score
  }, [score])

  useEffect(() => {
    feedbackDraftRef.current = feedback
  }, [feedback])

  useEffect(() => {
    if (!profile || profile.role !== 'teacher') return
    supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setTeacherId(data?.id || null))
  }, [profile])

  useEffect(() => {
    if (!hwId || !studentId) return
    loadAll()
  }, [hwId, groupId, studentId, profile?.id, profile?.role])

  useEffect(() => {
    if (!profile) return
    let active = true
    setQueueLoading(true)
    const queueMode = sub?.status === 'revision' ? 'returned' : 'pending'
    loadPendingQueueItems(supabase as any, profile, queueMode)
      .then(items => { if (active) setPendingQueueItems(items) })
      .finally(() => { if (active) setQueueLoading(false) })
    return () => { active = false }
  }, [profile?.id, profile?.role, sub?.id, sub?.status])

  async function loadAll() {
    if (!hwId || !studentId) return
    setLoading(true)
    try {
      if (!groupId) {
        const [hwData, roster, subRes] = await Promise.all([
          loadHomeworkInfo(hwId),
          loadHomeworkReviewRoster(hwId, profile),
          supabase
            .from('homework_submissions')
            .select('id, status, answer_text, file_url, score, feedback, submitted_at')
            .eq('homework_id', hwId)
            .eq('student_id', studentId)
            .maybeSingle(),
        ])
        setHw(hwData)
        if (!hwData) return

        const currentStudent = roster.students.find(item => item.studentId === studentId)
        setResolvedGroupName(currentStudent?.groupName ?? null)
        setStudent(currentStudent ? {
          id: currentStudent.studentId,
          name: currentStudent.name,
          profileId: currentStudent.profileId,
        } : null)
        setSiblings(roster.students.map(item => ({ studentId: item.studentId, name: item.name })))

        const s = subRes.data as any
        const filesBySubmission = await fetchHomeworkSubmissionFilesMap(supabase as any, s?.id ? [s.id] : [])
        if (s) s.homework_submission_files = filesBySubmission[s.id] || []
        setSub(s || null)
        const attempts = getSubmissionFileAttempts(s)
        setSelectedAttemptNumber(attempts.currentAttempt?.number ?? null)
        setScore(s?.score != null ? String(s.score) : '')
        setFeedback(s?.feedback || '')
        setSaved(false)
        setScoreInvalid(false)
        return
      }

      setResolvedGroupName(null)

      const { data: hwData } = await supabase
        .from('homeworks')
        .select('id, title, max_score')
        .eq('id', hwId)
        .single()
      setHw(hwData)
      if (!hwData) return

      // Parallel: student profile + submission + sibling list (в контексте группы)
      const [stuRes, subRes, gsRes] = await Promise.all([
        supabase
          .from('group_students')
          .select('student_id, students(id, profile_id, profiles(full_name))')
          .eq('group_id', groupId)
          .eq('student_id', studentId)
          .single(),
        supabase
          .from('homework_submissions')
          .select('id, status, answer_text, file_url, score, feedback, submitted_at')
          .eq('homework_id', hwId)
          .eq('student_id', studentId)
          .maybeSingle(),
        supabase
          .from('group_students')
          .select('student_id, students(profiles(full_name))')
          .eq('group_id', groupId),
      ])

      const gs = stuRes.data as any
      setStudent({
        id:        gs?.student_id || studentId,
        name:      gs?.students?.profiles?.full_name || 'Без имени',
        profileId: gs?.students?.profile_id || '',
      })

      const s = subRes.data as any
      const filesBySubmission = await fetchHomeworkSubmissionFilesMap(supabase as any, s?.id ? [s.id] : [])
      if (s) s.homework_submission_files = filesBySubmission[s.id] || []
      setSub(s || null)
      const attempts = getSubmissionFileAttempts(s)
      setSelectedAttemptNumber(attempts.currentAttempt?.number ?? null)
      setScore(s?.score != null ? String(s.score) : '')
      setFeedback(s?.feedback || '')
      setSaved(false)
      setScoreInvalid(false)

      // Build sibling list (all students in group) for prev/next
      const allStudents = ((gsRes.data || []) as any[]).map((g: any) => ({
        studentId: g.student_id,
        name: g.students?.profiles?.full_name || 'Без имени',
      }))
      setSiblings(allStudents)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(newStatus: 'checked' | 'revision'): Promise<boolean> {
    if (!sub || !hw) return false
    const draftScore = scoreDraftRef.current
    const draftFeedback = feedbackDraftRef.current
    const parsedScore = parseInt(draftScore)
    if (newStatus === 'checked' && (isNaN(parsedScore) || parsedScore < 0 || parsedScore > hw.max_score)) {
      toast.error(`Введите балл от 0 до ${hw.max_score}`)
      setScoreInvalid(true)
      scoreInputRef.current?.focus()
      return false
    }
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('homework_submissions')
        .update({
          score:      newStatus === 'checked' ? parsedScore : null,
          feedback:   draftFeedback.trim() || null,
          status:     newStatus,
          checked_at: new Date().toISOString(),
          checked_by: teacherId,
        })
        .eq('id', sub.id)
        .select('id, status, score, feedback')
        .single()

      if (error) throw error
      if (!data) throw new Error('Проверка не была сохранена')

      setSaved(true)
      setSub(prev => prev ? {
        ...prev,
        id: data.id,
        status: data.status,
        score: data.score,
        feedback: data.feedback,
      } : prev)

      if (student?.profileId) {
        notifyHomeworkChecked(student.profileId, hw.title, newStatus, newStatus === 'checked' ? parsedScore : null, hw.max_score)
      }

      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить проверку')
      return false
    } finally {
      setSaving(false)
    }
  }

  function publishReview(targetStatus: 'checked' | 'revision' = 'checked') {
    publishStatusRef.current = targetStatus
    return handleSave(targetStatus)
  }

  // Single post-save entry point for BOTH paths: the file viewer's own
  // publish button (via onPublishComplete, after annotations are done) and
  // the footer buttons (called directly once handleSave resolves), so a
  // teacher always gets feedback + advance/close regardless of whether the
  // submission has a file to annotate.
  function finishReview(success: boolean, message = 'Проверка опубликована') {
    if (!success) return
    if (!isPendingReview) {
      toast.success(message)
      return
    }

    const next = resolveNextQueueItem(pendingQueueItems, { submissionId: sub?.id || '', source: 'legacy_homework' })
    if (!next) {
      toast.success('Всё проверено')
      navigate('/inbox')
      return
    }
    toast.success(message)
    navigate(getQueueItemReviewPath(next), { state: { from: 'queue' } })
  }

  const submissionFilePaths = getSubmissionFilePaths(sub)
  const submissionAttempts = getSubmissionFileAttempts(sub)
  const selectedAttempt = submissionAttempts.attempts.find(attempt => attempt.number === selectedAttemptNumber) ?? submissionAttempts.currentAttempt
  const selectedAttemptPaths = selectedAttempt?.paths ?? submissionFilePaths
  const primaryFilePath = selectedAttemptPaths[0] ?? getPrimarySubmissionFilePath(sub)
  const isHistoricalAttempt = !!selectedAttempt && !!submissionAttempts.currentAttempt && selectedAttempt.number !== submissionAttempts.currentAttempt.number
  const isPendingReview = sub?.status === 'submitted' || sub?.status === 'revision'
  const nextQueueItem = isPendingReview ? resolveNextQueueItem(pendingQueueItems, { submissionId: sub?.id || '', source: 'legacy_homework' }) : null
  const canPreview = selectedAttemptPaths.length > 0 && selectedAttemptPaths.every(path => {
    const ext = path.split('?')[0].split('.').pop()?.toLowerCase()
    return !!ext && PREVIEWABLE_EXTS.includes(ext)
  })

  const reviewHeader = (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          data-testid="student-review-back-button"
          onClick={() => navigate(fromQueue ? '/inbox' : groupId ? `/homeworks/${hwId}/review/${groupId}` : `/homeworks/${hwId}/review`)}
          className="flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
        >
          <ArrowLeft size={18} />
          <span>Назад</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-gray-900">{student?.name || 'Проверка работы'}</div>
            {sub?.status && (
              <span
                data-testid="student-review-status-pill"
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1',
                  sub.status === 'checked' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
                  sub.status === 'revision' ? 'bg-amber-50 text-amber-700 ring-amber-200' :
                  sub.status === 'submitted' ? 'bg-sky-50 text-sky-700 ring-sky-200' :
                  'bg-slate-100 text-slate-600 ring-slate-200',
                )}
              >
                {sub.status === 'checked' ? 'Проверено' :
                 sub.status === 'revision' ? 'На доработке' :
                 sub.status === 'submitted' ? 'На проверке' : 'Не сдано'}
              </span>
            )}
            {submissionAttempts.attempts.length > 1 && (
              <div className="flex items-center gap-2">
                <History size={14} className="text-slate-400" />
                <label htmlFor="student-review-attempt-select" className="text-xs font-medium text-gray-500">Попытка</label>
                <select
                  id="student-review-attempt-select"
                  data-testid="student-review-attempt-select"
                  value={selectedAttempt?.number ?? ''}
                  onChange={e => setSelectedAttemptNumber(Number(e.target.value))}
                  className="min-h-9 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {submissionAttempts.attempts.map(attempt => (
                    <option key={attempt.number} value={attempt.number}>
                      {attempt.number === submissionAttempts.currentAttempt?.number ? 'Текущая' : `Попытка ${attempt.number}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className="truncate font-medium text-slate-600">{hw?.title}</span>
            {!groupId && resolvedGroupName && <span>{resolvedGroupName}</span>}
            {sub?.submitted_at && (
              <span>
                Сдано {new Date(sub.submitted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        {isPendingReview && (
          <button
            type="button"
            data-testid="student-review-next-work-button"
            disabled={queueLoading}
            onClick={() => {
              if (!nextQueueItem) {
                toast.success('Всё проверено')
                navigate('/inbox')
                return
              }
              navigate(getQueueItemReviewPath(nextQueueItem), { state: { from: 'queue' } })
            }}
            className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <span>{queueLoading ? 'Ищу следующую…' : 'Следующая работа'}</span>
            <ArrowRight size={16} />
          </button>
        )}
      </div>
      {isHistoricalAttempt && (
        <div
          data-testid="student-review-historical-banner"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <History size={15} className="shrink-0" />
          <span className="font-medium">Историческая попытка</span>
          <span className="text-amber-700/80">Можно просматривать файлы и комментарии, но не менять проверку.</span>
        </div>
      )}
    </div>
  )
  const gradingCard = sub && hw ? (
    <GradingCard
      maxScore={hw.max_score}
      score={score}
      feedback={feedback}
      status={sub.status}
      scoreInvalid={scoreInvalid}
      saved={saved}
      saving={saving}
      scoreInputRef={scoreInputRef}
      acceptLabel="Принять"
      onScoreDraftChange={value => {
        scoreDraftRef.current = value
        if (scoreInvalid) setScoreInvalid(false)
      }}
      onFeedbackDraftChange={value => {
        feedbackDraftRef.current = value
      }}
      onScoreChange={value => { setScore(value); setScoreInvalid(false) }}
      onFeedbackChange={setFeedback}
      onRevision={() => void handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))}
      onAccept={() => void handleSave('checked').then(ok => finishReview(ok))}
    />
  ) : null

  const previewGradingCard = sub && hw ? ({ publishing, published, triggerPublish }: { publishing: boolean; published: boolean; triggerPublish: (targetStatus?: 'checked' | 'revision') => void }) => (
    <GradingCard
      maxScore={hw.max_score}
      score={score}
      feedback={feedback}
      status={sub.status}
      scoreInvalid={scoreInvalid}
      saved={saved}
      saving={saving}
      scoreInputRef={scoreInputRef}
      acceptLabel={published ? 'Опубликовать снова' : 'Опубликовать проверку'}
      acceptLoading={publishing}
      onScoreDraftChange={value => {
        scoreDraftRef.current = value
        if (scoreInvalid) setScoreInvalid(false)
      }}
      onFeedbackDraftChange={value => {
        feedbackDraftRef.current = value
      }}
      onScoreChange={value => { setScore(value); setScoreInvalid(false) }}
      onFeedbackChange={setFeedback}
      onRevision={() => triggerPublish('revision')}
      onAccept={() => triggerPublish()}
    />
  ) : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  return (
    <div data-testid="student-review-page" className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
      <div className="min-h-0 flex-1">
        {!sub ? (
          <div className="flex h-full min-h-80 items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-400">
            <div>
              <AlertTriangle size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Ученик ещё не сдал работу</p>
            </div>
          </div>
        ) : primaryFilePath && canPreview ? (
          <Suspense fallback={<ReviewerFallback />}>
            <SubmissionReviewer
              submissionId={sub.id}
              filePath={primaryFilePath}
              filePaths={selectedAttemptPaths}
              readOnly={isHistoricalAttempt}
              annotationVisibility={isHistoricalAttempt ? 'all' : undefined}
              className="h-full min-h-0"
              header={reviewHeader}
              footer={isHistoricalAttempt ? undefined : previewGradingCard ?? undefined}
              onPublish={isHistoricalAttempt ? undefined : publishReview}
              onPublishComplete={isHistoricalAttempt ? undefined : (success => finishReview(success, publishStatusRef.current === 'revision' ? 'Отправлено на доработку' : 'Проверка опубликована'))}
            />
          </Suspense>
        ) : (
          <div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-4 shrink-0 border-b border-gray-100 pb-4">
              {reviewHeader}
            </div>
            {sub.answer_text && !isHistoricalAttempt ? (
              <div className="min-h-0 flex-1 space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Ответ ученика</label>
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {sub.answer_text}
                </div>
              </div>
            ) : primaryFilePath ? (
              <SignedFileLink
                bucket="homeworks"
                url={primaryFilePath}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700 transition-colors hover:bg-blue-100"
              >
                <FileText size={16} />
                {selectedAttemptPaths.length > 1
                  ? `Открыть файлы (${selectedAttemptPaths.length})`
                  : decodeURIComponent(primaryFilePath.split('/').pop() || 'Открыть файл').replace(/\?\S*$/, '')
                }
              </SignedFileLink>
            ) : (
              <div className="rounded-xl bg-gray-50 py-8 text-center text-sm italic text-gray-400">
                {isHistoricalAttempt ? 'Для этой попытки нет превью' : 'Ученик не прикрепил ответ'}
              </div>
            )}
            {!isHistoricalAttempt && <div className="mt-4 shrink-0 border-t border-gray-100 pt-4">
              {gradingCard}
            </div>}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewerFallback() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" />Загрузка редактора…</div>
}
