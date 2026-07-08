import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, RotateCcw, FileText, MessageSquare,
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
  score: number | null
  feedback: string | null
  submitted_at: string | null
}

interface StudentInfo {
  id: string
  name: string
  profileId: string
}

const QUICK_PHRASES = [
  'Молодец!', 'Хорошая работа', 'Отличный результат!', 'Проверь вычисления',
  'Нужно переделать', 'Невнимательность', 'Не забудь единицы измерения',
  'Покажи решение полностью', 'Ошибка в формуле', 'Почти правильно',
]

export function StudentReviewPage() {
  const { id: hwId, groupId, studentId } = useParams<{ id: string; groupId?: string; studentId: string }>()
  const navigate  = useNavigate()
  const profile   = useAuthStore(s => s.profile)

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
  const nextAdvanceRef = useRef<string | 'list' | null>(null)
  const [resolvedGroupName, setResolvedGroupName] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || profile.role !== 'teacher') return
    supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setTeacherId(data?.id || null))
  }, [profile])

  useEffect(() => {
    if (!hwId || !studentId) return
    loadAll()
  }, [hwId, groupId, studentId, profile?.id, profile?.role])

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
        setSub(s || null)
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
      setSub(s || null)
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
    const parsedScore = parseInt(score)
    if (newStatus === 'checked' && (isNaN(parsedScore) || parsedScore < 0 || parsedScore > hw.max_score)) {
      toast.error(`Введите балл от 0 до ${hw.max_score}`)
      setScoreInvalid(true)
      scoreInputRef.current?.focus()
      return false
    }
    setSaving(true)
    const { error } = await supabase.from('homework_submissions').update({
      score:      newStatus === 'checked' ? parsedScore : null,
      feedback:   feedback.trim() || null,
      status:     newStatus,
      checked_at: new Date().toISOString(),
      checked_by: teacherId,
    }).eq('id', sub.id)
    setSaving(false)
    if (error) { toast.error(error.message); return false }

    setSaved(true)
    setSub(prev => prev ? { ...prev, status: newStatus, score: newStatus === 'checked' ? parsedScore : null, feedback: feedback.trim() || null } : prev)

    if (student?.profileId) {
      notifyHomeworkChecked(student.profileId, hw.title, newStatus, newStatus === 'checked' ? parsedScore : null, hw.max_score)
    }

    // Auto-advance to next pending student
    const idx = siblings.findIndex(s => s.studentId === studentId)
    const next = siblings.slice(idx + 1).find(s => true) // just go to next
    nextAdvanceRef.current = next ? next.studentId : 'list'
    return true
  }

  // Single post-save entry point for BOTH paths: the file viewer's own
  // publish button (via onPublishComplete, after annotations are done) and
  // the footer buttons (called directly once handleSave resolves), so a
  // teacher always gets feedback + advance/close regardless of whether the
  // submission has a file to annotate.
  function finishReview(success: boolean, message = 'Проверка опубликована') {
    if (!success) return
    toast.success(message)
    const next = nextAdvanceRef.current
    const listPath = groupId ? `/homeworks/${hwId}/review/${groupId}` : `/homeworks/${hwId}/review`
    if (next === 'list') navigate(listPath)
    else if (next) navigate(groupId ? `/homeworks/${hwId}/review/${groupId}/${next}` : `/homeworks/${hwId}/review/student/${next}`)
  }

  const fileExt = sub?.file_url?.split('?')[0].split('.').pop()?.toLowerCase()
  const canPreview = !!fileExt && PREVIEWABLE_EXTS.includes(fileExt)

  const sibIdx   = siblings.findIndex(s => s.studentId === studentId)
  const prevStu  = sibIdx > 0 ? siblings[sibIdx - 1] : null
  const nextStu  = sibIdx >= 0 && sibIdx < siblings.length - 1 ? siblings[sibIdx + 1] : null
  const reviewHeader = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        onClick={() => navigate(groupId ? `/homeworks/${hwId}/review/${groupId}` : `/homeworks/${hwId}/review`)}
        className="flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
      >
        <ArrowLeft size={18} />
        <span>Назад</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-gray-900">{student?.name || 'Проверка работы'}</div>
        <div className="truncate text-xs text-gray-500">
          {hw?.title}
          {!groupId && resolvedGroupName && <span className="ml-2">· {resolvedGroupName}</span>}
          {sub?.submitted_at && (
            <span className="ml-2">
              Сдано: {new Date(sub.submitted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!prevStu}
          onClick={() => prevStu && navigate(groupId ? `/homeworks/${hwId}/review/${groupId}/${prevStu.studentId}` : `/homeworks/${hwId}/review/student/${prevStu.studentId}`)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
          title={prevStu?.name}
          aria-label="Предыдущий ученик"
        >
          ‹
        </button>
        <div className="min-w-16 text-center text-xs font-medium text-gray-400">{sibIdx + 1} / {siblings.length}</div>
        <button
          type="button"
          disabled={!nextStu}
          onClick={() => nextStu && navigate(groupId ? `/homeworks/${hwId}/review/${groupId}/${nextStu.studentId}` : `/homeworks/${hwId}/review/student/${nextStu.studentId}`)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
          title={nextStu?.name}
          aria-label="Следующий ученик"
        >
          ›
        </button>
      </div>
    </div>
  )
  const gradingCard = sub ? (
    <div data-testid="student-review-grading-card" className="grid gap-4">
      <div className="space-y-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500">Комментарий для ученика</label>
          <div className="mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-auto">
            {QUICK_PHRASES.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setFeedback(prev => prev ? `${prev} ${p}` : p)}
                className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              >
                {p}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Что сделано хорошо, что нужно исправить…"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <MessageSquare size={15} className="text-primary-500" />
            Оценка
          </div>
          <span className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium',
            sub.status === 'checked'   ? 'bg-green-100 text-green-700' :
            sub.status === 'revision'  ? 'bg-yellow-100 text-yellow-700' :
            sub.status === 'submitted' ? 'bg-orange-100 text-orange-700' :
                                          'bg-gray-100 text-gray-500'
          )}>
            {sub.status === 'checked'   ? '✓ Проверено' :
             sub.status === 'revision'  ? '↩ На доработке' :
             sub.status === 'submitted' ? '⏳ Ожидает проверки' :
                                          'Не сдал'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={scoreInputRef}
            type="number"
            min={0}
            max={hw?.max_score}
            value={score}
            onChange={e => { setScore(e.target.value); setScoreInvalid(false) }}
            placeholder="—"
            className={cn(
              'w-24 rounded-xl border px-3 py-2 text-center text-sm font-bold text-primary-700 focus:outline-none focus:ring-2',
              scoreInvalid ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200 focus:ring-primary-500',
            )}
          />
          <span className="text-sm text-gray-400">из {hw?.max_score}</span>
          {score !== '' && !isNaN(parseInt(score)) && (
            <span className={cn(
              'text-sm font-semibold',
              parseInt(score) / (hw?.max_score || 100) >= 0.8 ? 'text-green-600' :
              parseInt(score) / (hw?.max_score || 100) >= 0.5 ? 'text-yellow-600' : 'text-red-500',
            )}>
              {Math.round(parseInt(score) / (hw?.max_score || 100) * 100)}%
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-end md:justify-between">
        {saved
          ? <span className="flex items-center gap-1 text-sm font-medium text-green-600"><CheckCircle size={14} />Сохранено</span>
          : <span className="h-5" />
        }
        <div className="flex flex-col items-stretch gap-2 sm:flex-row">
          <Button size="sm" variant="secondary" onClick={() => void handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))} loading={saving}>
            <RotateCcw size={14} className="mr-1" />На доработку
          </Button>
          {!canPreview && (
            <Button size="sm" onClick={() => void handleSave('checked').then(ok => finishReview(ok))} loading={saving}>
              <CheckCircle size={14} className="mr-1" />Принять
            </Button>
          )}
        </div>
      </div>
    </div>
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
        ) : sub.file_url && canPreview ? (
          <Suspense fallback={<ReviewerFallback />}>
            <SubmissionReviewer
              submissionId={sub.id}
              filePath={sub.file_url}
              className="h-full min-h-0"
              header={reviewHeader}
              footer={gradingCard}
              footerPublishLabel="Опубликовать проверку"
              onPublish={() => handleSave('checked')}
              onPublishComplete={finishReview}
            />
          </Suspense>
        ) : (
          <div className="flex h-full min-h-0 flex-col rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-4 shrink-0 border-b border-gray-100 pb-4">
              {reviewHeader}
            </div>
            {sub.answer_text ? (
              <div className="min-h-0 flex-1 space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Ответ ученика</label>
                <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {sub.answer_text}
                </div>
              </div>
            ) : sub.file_url ? (
              <SignedFileLink
                bucket="homeworks"
                url={sub.file_url}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700 transition-colors hover:bg-blue-100"
              >
                <FileText size={16} />
                {decodeURIComponent(sub.file_url.split('/').pop() || 'Открыть файл').replace(/\?\S*$/, '')}
              </SignedFileLink>
            ) : (
              <div className="rounded-xl bg-gray-50 py-8 text-center text-sm italic text-gray-400">
                Ученик не прикрепил ответ
              </div>
            )}
            <div className="mt-4 shrink-0 border-t border-gray-100 pt-4">
              {gradingCard}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewerFallback() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" />Загрузка редактора…</div>
}
