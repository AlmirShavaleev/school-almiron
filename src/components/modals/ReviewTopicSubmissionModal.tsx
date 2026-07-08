import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import {
  X, FileText, MessageSquare, CheckCircle, RotateCcw,
  Loader2, BookMarked, Users, GraduationCap,
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

interface FullSubmission {
  id:           string
  student_id:   string
  status:       string
  answer_text:  string | null
  file_url:     string | null
  score:        number | null
  feedback:     string | null
  submitted_at: string | null
  topic_title:  string
  module_title: string
  group_name:   string
  student_name: string
  student_profile_id: string
}

interface Props {
  open:        boolean
  onClose:     () => void
  onReviewed:  () => void
  submissionId: string | null
}

export function ReviewTopicSubmissionModal({ open, onClose, onReviewed, submissionId }: Props) {
  const profile = useAuthStore(s => s.profile)

  const [sub,      setSub]      = useState<FullSubmission | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [loadError, setLoadError] = useState('')
  const [score,    setScore]    = useState('')
  const [scoreInvalid, setScoreInvalid] = useState(false)
  const scoreInputRef = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [teacherId, setTeacherId] = useState<string | null>(null)

  // Load teacher id
  useEffect(() => {
    if (!profile || profile.role !== 'teacher') return
    supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setTeacherId(data?.id || null))
  }, [profile])

  // Load submission
  useEffect(() => {
    if (!open || !submissionId) return
    setLoading(true); setSaved(false); setLoadError('')

    supabase
      .from('homework_submissions')
      .select(`
        id, student_id, status, answer_text, file_url, score, feedback, submitted_at,
        homeworks(title, topics(title, modules(course_id, title))),
        students(id, profile_id, profiles(full_name))
      `)
      .eq('id', submissionId)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setLoadError(error?.message || 'Не удалось загрузить сдачу')
          setLoading(false)
          return
        }
        const d: any = data
        const courseId = d.homeworks?.topics?.modules?.course_id || null

        let groupName = '—'
        const { data: gsRows, error: gsError } = await supabase
          .from('group_students')
          .select('group_id, groups(name, course_id)')
          .eq('student_id', d.student_id)
        if (!gsError && gsRows?.length) {
          const courseMatch = gsRows.find((r: any) => r.groups?.course_id === courseId)
          if (courseMatch) groupName = (courseMatch as any).groups?.name || '—'
          else if (gsRows.length === 1) groupName = (gsRows[0] as any).groups?.name || '—'
        }

        setSub({
          id:                 d.id,
          student_id:         d.student_id,
          status:             d.status,
          answer_text:        d.answer_text,
          file_url:           d.file_url,
          score:              d.score,
          feedback:           d.feedback,
          submitted_at:       d.submitted_at,
          topic_title:        d.homeworks?.topics?.title || d.homeworks?.title || '—',
          module_title:       d.homeworks?.topics?.modules?.title || '',
          group_name:         groupName,
          student_name:       d.students?.profiles?.full_name || '—',
          student_profile_id: d.students?.profile_id || '',
        })
        setScore(d.score != null ? String(d.score) : '')
        setFeedback(d.feedback || '')
        setScoreInvalid(false)
        setLoading(false)
      })
  }, [open, submissionId])

  async function handleSave(newStatus: 'checked' | 'revision'): Promise<boolean> {
    if (!sub) return false
    const parsedScore = score !== '' ? parseInt(score) : null

    if (newStatus === 'checked' && parsedScore !== null && (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
      toast.error('Балл должен быть от 0 до 100')
      setScoreInvalid(true)
      scoreInputRef.current?.focus()
      return false
    }

    setSaving(true)
    const { error } = await supabase
      .from('homework_submissions')
      .update({
        score:      newStatus === 'checked' ? parsedScore : null,
        feedback:   feedback.trim() || null,
        status:     newStatus,
        checked_at: new Date().toISOString(),
        checked_by: teacherId,
      })
      .eq('id', sub.id)

    setSaving(false)
    if (error) { toast.error(error.message); return false }

    setSub(prev => prev ? { ...prev, score: parsedScore, feedback: feedback.trim() || null, status: newStatus } : prev)
    setSaved(true)
    onReviewed()

    // Уведомление студенту
    if (sub.student_profile_id) {
      notifyHomeworkChecked(
        sub.student_profile_id,
        sub.topic_title,
        newStatus,
        newStatus === 'checked' ? parsedScore : null,
        100,
      )
    }
    return true
  }

  // Single post-save entry point for BOTH paths: the file viewer's own
  // publish button (via onPublishComplete, after annotations are done) and
  // the footer buttons (called directly once handleSave resolves) — this
  // is a single-submission modal, so a full success always closes it.
  function finishReview(success: boolean, message = 'Проверка опубликована') {
    if (!success) return
    toast.success(message)
    onClose()
  }

  if (!open) return null

  const fileName = sub?.file_url
    ? decodeURIComponent(sub.file_url.split('/').pop() || 'Файл').replace(/\?\S*$/, '')
    : null
  const fileExt = sub?.file_url?.split('?')[0].split('.').pop()?.toLowerCase()
  const canPreview = !!fileExt && PREVIEWABLE_EXTS.includes(fileExt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">Проверка работы</h2>
            {sub && (
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1"><BookMarked size={11} />{sub.module_title && `${sub.module_title} · `}{sub.topic_title}</span>
                <span className="flex items-center gap-1"><Users size={11} />{sub.group_name}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3 shrink-0">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 size={20} className="animate-spin" />Загрузка…
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 px-6">
            <p role="alert" className="text-sm text-red-600 text-center">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={onClose}>Закрыть</Button>
          </div>
        ) : !sub ? (
          <div className="flex items-center justify-center py-20 text-gray-400">Запись не найдена</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Student + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">
                    <GraduationCap size={16} />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{sub.student_name}</div>
                    {sub.submitted_at && (
                      <div className="text-xs text-gray-400">
                        Сдано: {new Date(sub.submitted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </div>
                <span className={cn(
                  'text-xs font-medium px-2.5 py-1 rounded-full',
                  sub.status === 'checked'   ? 'bg-green-100 text-green-700' :
                  sub.status === 'revision'  ? 'bg-orange-100 text-orange-700' :
                  sub.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                )}>
                  {sub.status === 'checked' ? '✓ Проверено' : sub.status === 'revision' ? '↩ На доработку' : '⏳ Ожидает проверки'}
                </span>
              </div>

              {/* Answer text */}
              {sub.answer_text && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Ответ ученика</label>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {sub.answer_text}
                  </div>
                </div>
              )}

              {/* File */}
              {sub.file_url && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Прикреплённый файл</label>
                  {canPreview ? (
                    <Suspense fallback={<ReviewerFallback />}>
                      <SubmissionReviewer submissionId={sub.id} filePath={sub.file_url} onPublish={() => handleSave('checked')} onPublishComplete={finishReview} />
                    </Suspense>
                  ) : (
                    <SignedFileLink
                      bucket="homeworks" url={sub.file_url}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <FileText size={16} />{fileName || 'Открыть файл'}
                    </SignedFileLink>
                  )}
                </div>
              )}

              {!sub.answer_text && !sub.file_url && (
                <div className="text-sm text-gray-400 italic py-4 text-center">Ученик не прикрепил ответ</div>
              )}

              {/* Grade section */}
              <div className="border-t border-gray-100 pt-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <MessageSquare size={15} className="text-primary-500" />
                  Оценка и комментарий
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Балл <span className="text-gray-400">(0 – 100, необязательно)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      ref={scoreInputRef}
                      type="number" min={0} max={100} value={score}
                      onChange={e => { setScore(e.target.value); setScoreInvalid(false) }}
                      placeholder="—"
                      className={cn(
                        'w-24 border rounded-xl px-3 py-2 text-sm text-center font-bold text-primary-700 focus:outline-none focus:ring-2',
                        scoreInvalid ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200 focus:ring-primary-500',
                      )}
                    />
                    <span className="text-sm text-gray-400">из 100</span>
                    {score !== '' && !isNaN(parseInt(score)) && (
                      <span className={cn(
                        'text-sm font-semibold',
                        parseInt(score) >= 80 ? 'text-green-600' :
                        parseInt(score) >= 50 ? 'text-yellow-600' : 'text-red-500'
                      )}>
                        {parseInt(score)}%
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Комментарий для ученика
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      'Молодец!',
                      'Хорошая работа',
                      'Отличный результат!',
                      'Проверь вычисления',
                      'Нужно переделать',
                      'Невнимательность',
                      'Не забудь единицы измерения',
                      'Покажи решение полностью',
                      'Ошибка в формуле',
                      'Почти правильно',
                    ].map(phrase => (
                      <button
                        key={phrase}
                        type="button"
                        onClick={() => setFeedback(prev => prev ? `${prev} ${phrase}` : phrase)}
                        className="px-2.5 py-1 text-xs rounded-full border border-gray-200 bg-gray-50 text-gray-600 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors"
                      >
                        {phrase}
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={3} value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    placeholder="Что сделано хорошо, что нужно исправить…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-end gap-3">
              {saved && (
                <span className="text-xs text-green-600 font-medium flex items-center gap-1 mr-auto">
                  <CheckCircle size={13} />Сохранено
                </span>
              )}
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
          </>
        )}
      </div>
    </div>
  )
}

function ReviewerFallback() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500"><Loader2 size={18} className="mr-2 animate-spin" />Загрузка редактора…</div>
}
