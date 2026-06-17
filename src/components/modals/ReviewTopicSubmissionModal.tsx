import { useState, useEffect } from 'react'
import {
  X, FileText, MessageSquare, CheckCircle, RotateCcw,
  Loader2, BookMarked, Users, GraduationCap,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { notifyHomeworkChecked } from '@/utils/notify'

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
  const [score,    setScore]    = useState('')
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
    setLoading(true); setSaved(false)

    supabase
      .from('homework_submissions')
      .select(`
        id, student_id, status, answer_text, file_url, score, feedback, submitted_at,
        homeworks(title, topics(title, modules(title)), groups(name)),
        students(id, profile_id, profiles(full_name))
      `)
      .eq('id', submissionId)
      .single()
      .then(({ data }) => {
        if (!data) return
        const d: any = data
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
          group_name:         d.homeworks?.groups?.name || '—',
          student_name:       d.students?.profiles?.full_name || '—',
          student_profile_id: d.students?.profile_id || '',
        })
        setScore(d.score != null ? String(d.score) : '')
        setFeedback(d.feedback || '')
        setLoading(false)
      })
  }, [open, submissionId])

  async function handleSave(newStatus: 'checked' | 'revision') {
    if (!sub) return
    const parsedScore = score !== '' ? parseInt(score) : null

    if (newStatus === 'checked' && parsedScore !== null && (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
      alert('Балл должен быть от 0 до 100')
      return
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
    if (error) { alert(error.message); return }

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
  }

  if (!open) return null

  const fileName = sub?.file_url
    ? decodeURIComponent(sub.file_url.split('/').pop() || 'Файл').replace(/\?\S*$/, '')
    : null

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
                  <a
                    href={sub.file_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={16} />{fileName || 'Открыть файл'}
                  </a>
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
                      type="number" min={0} max={100} value={score}
                      onChange={e => setScore(e.target.value)}
                      placeholder="—"
                      className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center font-bold text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              <Button size="sm" variant="secondary" onClick={() => handleSave('revision')} loading={saving}>
                <RotateCcw size={14} className="mr-1" />На доработку
              </Button>
              <Button size="sm" onClick={() => handleSave('checked')} loading={saving}>
                <CheckCircle size={14} className="mr-1" />Принять
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
