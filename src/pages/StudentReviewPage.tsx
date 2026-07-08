import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, RotateCcw, FileText, MessageSquare,
  AlertTriangle, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { cn } from '@/utils/cn'
import { notifyHomeworkChecked } from '@/utils/notify'
import { toast } from '@/store/toastStore'

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
  const { id: hwId, groupId, studentId } = useParams<{ id: string; groupId: string; studentId: string }>()
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

  useEffect(() => {
    if (!profile || profile.role !== 'teacher') return
    supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setTeacherId(data?.id || null))
  }, [profile])

  useEffect(() => {
    if (!hwId || !groupId || !studentId) return
    loadAll()
  }, [hwId, groupId, studentId])

  async function loadAll() {
    if (!hwId || !groupId || !studentId) return
    setLoading(true)
    try {
      // Load homework
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
    if (next === 'list') navigate(`/homeworks/${hwId}/review/${groupId}`)
    else if (next) navigate(`/homeworks/${hwId}/review/${groupId}/${next}`)
  }

  const fileExt = sub?.file_url?.split('?')[0].split('.').pop()?.toLowerCase()
  const canPreview = !!fileExt && PREVIEWABLE_EXTS.includes(fileExt)

  const sibIdx   = siblings.findIndex(s => s.studentId === studentId)
  const prevStu  = sibIdx > 0 ? siblings[sibIdx - 1] : null
  const nextStu  = sibIdx >= 0 && sibIdx < siblings.length - 1 ? siblings[sibIdx + 1] : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/homeworks/${hwId}/review/${groupId}`)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 transition-colors text-sm"
        >
          <ArrowLeft size={18} />
          <span>Назад к списку</span>
        </button>
        <div className="flex-1" />
        {/* Prev / Next */}
        <div className="flex items-center gap-1">
          <button
            disabled={!prevStu}
            onClick={() => prevStu && navigate(`/homeworks/${hwId}/review/${groupId}/${prevStu.studentId}`)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            title={prevStu?.name}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-xs text-gray-400">{sibIdx + 1} / {siblings.length}</span>
          <button
            disabled={!nextStu}
            onClick={() => nextStu && navigate(`/homeworks/${hwId}/review/${groupId}/${nextStu.studentId}`)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            title={nextStu?.name}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

        {/* Student header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-11 h-11 rounded-full flex items-center justify-center text-base font-bold',
              sub?.status === 'checked'   ? 'bg-green-100 text-green-700' :
              sub?.status === 'submitted' ? 'bg-orange-100 text-orange-700' :
              sub?.status === 'revision'  ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-gray-100 text-gray-400'
            )}>
              {student?.name.charAt(0)}
            </div>
            <div>
              <div className="font-semibold text-gray-900">{student?.name}</div>
              <div className="text-xs text-gray-400">
                {hw?.title}
                {sub?.submitted_at && (
                  <span className="ml-2">
                    Сдано: {new Date(sub.submitted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className={cn(
            'text-xs font-medium px-3 py-1.5 rounded-full',
            sub?.status === 'checked'   ? 'bg-green-100 text-green-700' :
            sub?.status === 'revision'  ? 'bg-yellow-100 text-yellow-700' :
            sub?.status === 'submitted' ? 'bg-orange-100 text-orange-700' :
                                          'bg-gray-100 text-gray-500'
          )}>
            {sub?.status === 'checked'   ? '✓ Проверено' :
             sub?.status === 'revision'  ? '↩ На доработке' :
             sub?.status === 'submitted' ? '⏳ Ожидает проверки' :
                                          'Не сдал'}
          </span>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* No submission */}
          {!sub && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-gray-400">
              <AlertTriangle size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Ученик ещё не сдал работу</p>
            </div>
          )}

          {/* Answer text */}
          {sub?.answer_text && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Ответ ученика</label>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {sub.answer_text}
              </div>
            </div>
          )}

          {/* File */}
          {sub?.file_url && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Прикреплённый файл</label>
              {(() => {
                if (canPreview) {
                  return (
                    <Suspense fallback={<ReviewerFallback />}>
                      <SubmissionReviewer submissionId={sub.id} filePath={sub.file_url!} onPublish={() => handleSave('checked')} onPublishComplete={finishReview} />
                    </Suspense>
                  )
                }
                return (
                  <SignedFileLink
                    bucket="homeworks"
                    url={sub.file_url!}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={16} />
                    {decodeURIComponent(sub.file_url!.split('/').pop() || 'Открыть файл').replace(/\?\S*$/, '')}
                  </SignedFileLink>
                )
              })()}
            </div>
          )}

          {sub && !sub.answer_text && !sub.file_url && (
            <div className="text-sm text-gray-400 italic text-center py-4 bg-gray-50 rounded-xl">
              Ученик не прикрепил ответ
            </div>
          )}

          {/* Review form */}
          {sub && (
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <MessageSquare size={15} className="text-primary-500" />
                Оценка и комментарий
              </div>

              {/* Score */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Балл <span className="text-gray-400">(0 – {hw?.max_score})</span>
                </label>
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
                      'w-24 border rounded-xl px-3 py-2 text-sm text-center font-bold text-primary-700 focus:outline-none focus:ring-2',
                      scoreInvalid ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200 focus:ring-primary-500',
                    )}
                  />
                  <span className="text-sm text-gray-400">из {hw?.max_score}</span>
                  {score !== '' && !isNaN(parseInt(score)) && (
                    <span className={cn('text-sm font-semibold',
                      parseInt(score) / (hw?.max_score || 100) >= 0.8 ? 'text-green-600' :
                      parseInt(score) / (hw?.max_score || 100) >= 0.5 ? 'text-yellow-600' : 'text-red-500'
                    )}>
                      {Math.round(parseInt(score) / (hw?.max_score || 100) * 100)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Quick phrases */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Комментарий для ученика</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUICK_PHRASES.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFeedback(prev => prev ? `${prev} ${p}` : p)}
                      className="px-2.5 py-1 text-xs rounded-full border border-gray-200 bg-gray-50 text-gray-600 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="Что сделано хорошо, что нужно исправить…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                {saved
                  ? <span className="text-sm text-green-600 font-medium flex items-center gap-1"><CheckCircle size={14} />Сохранено</span>
                  : <span />
                }
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))} loading={saving}>
                    <RotateCcw size={14} className="mr-1" />На доработку
                  </Button>
                  {/* Когда есть файл — единственная точка "принять" это кнопка публикации во вьювере (там же аннотации) */}
                  {!canPreview && (
                    <Button size="sm" onClick={() => void handleSave('checked').then(ok => finishReview(ok))} loading={saving}>
                      <CheckCircle size={14} className="mr-1" />Принять
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewerFallback() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" />Загрузка редактора…</div>
}
