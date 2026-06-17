import { useState, useEffect } from 'react'
import {
  X, FileText, MessageSquare, CheckCircle, RotateCcw,
  ChevronLeft, ChevronRight, Loader2, Clock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { notifyHomeworkChecked } from '@/utils/notify'

interface Submission {
  id: string
  student_id: string
  status: string
  answer_text: string | null
  file_url: string | null
  score: number | null
  feedback: string | null
  submitted_at: string | null
  students: { profile_id: string; profiles: { full_name: string } }
}

interface Props {
  open: boolean
  onClose: () => void
  onReviewed: () => void
  homework: { id: string; title: string; max_score: number } | null
}

export function ReviewHomeworkModal({ open, onClose, onReviewed, homework }: Props) {
  const profile = useAuthStore(s => s.profile)

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading,     setLoading]     = useState(false)
  const [index,       setIndex]       = useState(0)

  // Per-submission edit state
  const [score,    setScore]    = useState<string>('')
  const [feedback, setFeedback] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [teacherId, setTeacherId] = useState<string | null>(null)

  // Load teacher id once
  useEffect(() => {
    if (!profile || profile.role !== 'teacher') return
    supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
      .then(({ data }) => setTeacherId(data?.id || null))
  }, [profile])

  // Load submissions when modal opens
  useEffect(() => {
    if (!open || !homework) return
    setLoading(true)
    setIndex(0)

    supabase
      .from('homework_submissions')
      .select('*, students(profile_id, profiles(full_name))')
      .eq('homework_id', homework.id)
      .in('status', ['submitted', 'checked', 'revision'])
      .order('submitted_at', { ascending: true })
      .then(({ data }) => {
        setSubmissions(data || [])
        setLoading(false)
      })
  }, [open, homework])

  // Sync form when switching between submissions
  useEffect(() => {
    const sub = submissions[index]
    if (!sub) return
    setScore(sub.score != null ? String(sub.score) : '')
    setFeedback(sub.feedback || '')
    setSaved(false)
  }, [index, submissions])

  async function handleSave(newStatus: 'checked' | 'revision') {
    const sub = submissions[index]
    if (!sub) return

    const parsedScore = parseInt(score)
    if (newStatus === 'checked' && (isNaN(parsedScore) || parsedScore < 0 || parsedScore > (homework?.max_score || 100))) {
      alert(`Балл должен быть от 0 до ${homework?.max_score}`)
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

    // Update local state
    setSubmissions(prev => prev.map((s, i) =>
      i === index
        ? { ...s, score: newStatus === 'checked' ? parsedScore : null, feedback: feedback.trim() || null, status: newStatus }
        : s
    ))
    setSaved(true)
    onReviewed()

    // Уведомление студенту
    const profileId = sub.students?.profile_id
    if (profileId) {
      notifyHomeworkChecked(
        profileId,
        homework?.title || '',
        newStatus,
        newStatus === 'checked' ? parsedScore : null,
        homework?.max_score,
      )
    }

    // Auto-advance to next unchecked
    const nextUnchecked = submissions.findIndex((s, i) => i > index && s.status === 'submitted')
    if (nextUnchecked !== -1) setTimeout(() => setIndex(nextUnchecked), 600)
  }

  if (!open || !homework) return null

  const sub = submissions[index]
  const total = submissions.length
  const checkedCount = submissions.filter(s => s.status === 'checked').length
  const pendingCount = submissions.filter(s => s.status === 'submitted').length

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
            <h2 className="font-bold text-gray-900 truncate">Проверка: {homework.title}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span className="flex items-center gap-1"><CheckCircle size={11} className="text-green-500" />{checkedCount} проверено</span>
              <span className="flex items-center gap-1"><Clock size={11} className="text-orange-400" />{pendingCount} ожидают</span>
              <span>Макс: {homework.max_score} б.</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3 shrink-0">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
            <Loader2 size={20} className="animate-spin" />Загрузка…
          </div>
        ) : submissions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
            <CheckCircle size={36} className="opacity-30" />
            <p>Нет сданных работ</p>
          </div>
        ) : (
          <>
            {/* Student nav */}
            <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 shrink-0 overflow-x-auto">
              {submissions.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setIndex(i)}
                  title={s.students?.profiles?.full_name}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border',
                    i === index
                      ? 'bg-primary-600 text-white border-primary-600'
                      : s.status === 'checked'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : s.status === 'revision'
                          ? 'bg-orange-50 text-orange-700 border-orange-200'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  {s.status === 'checked' && <CheckCircle size={11} />}
                  {s.status === 'revision' && <RotateCcw size={11} />}
                  {s.students?.profiles?.full_name?.split(' ')[1] || `Ученик ${i + 1}`}
                </button>
              ))}
            </div>

            {/* Submission content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Student info + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">
                    {sub?.students?.profiles?.full_name?.charAt(0)}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{sub?.students?.profiles?.full_name}</div>
                    {sub?.submitted_at && (
                      <div className="text-xs text-gray-400">
                        Сдано: {new Date(sub.submitted_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                </div>
                <span className={cn(
                  'text-xs font-medium px-2.5 py-1 rounded-full',
                  sub?.status === 'checked'   ? 'bg-green-100 text-green-700' :
                  sub?.status === 'revision'  ? 'bg-orange-100 text-orange-700' :
                  sub?.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                )}>
                  {sub?.status === 'checked' ? '✓ Проверено' : sub?.status === 'revision' ? '↩ На доработку' : '⏳ Ожидает проверки'}
                </span>
              </div>

              {/* Answer text */}
              {sub?.answer_text ? (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Ответ ученика</label>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {sub.answer_text}
                  </div>
                </div>
              ) : null}

              {/* File */}
              {sub?.file_url && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Прикреплённый файл</label>
                  <a
                    href={sub.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={16} />
                    {fileName || 'Открыть файл'}
                  </a>
                </div>
              )}

              {!sub?.answer_text && !sub?.file_url && (
                <div className="text-sm text-gray-400 italic py-4 text-center">Ученик не прикрепил ответ</div>
              )}

              {/* Divider */}
              <div className="border-t border-gray-100 pt-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <MessageSquare size={15} className="text-primary-500" />
                  Оценка и комментарий
                </div>

                {/* Score */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Балл <span className="text-gray-400">(0 – {homework.max_score})</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={homework.max_score}
                      value={score}
                      onChange={e => setScore(e.target.value)}
                      placeholder="—"
                      className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center font-bold text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-400">из {homework.max_score}</span>
                    {score !== '' && !isNaN(parseInt(score)) && (
                      <span className={cn(
                        'text-sm font-semibold',
                        parseInt(score) / homework.max_score >= 0.8 ? 'text-green-600' :
                        parseInt(score) / homework.max_score >= 0.5 ? 'text-yellow-600' : 'text-red-500'
                      )}>
                        {Math.round(parseInt(score) / homework.max_score * 100)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Feedback */}
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
                    rows={3}
                    value={feedback}
                    onChange={e => setFeedback(e.target.value)}
                    placeholder="Что сделано хорошо, что нужно исправить…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
              {/* Navigation */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIndex(i => Math.max(0, i - 1))}
                  disabled={index === 0}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-gray-500">{index + 1} / {total}</span>
                <button
                  onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
                  disabled={index === total - 1}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle size={13} />Сохранено
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleSave('revision')}
                  loading={saving}
                  title="Отправить на доработку"
                >
                  <RotateCcw size={14} className="mr-1" />На доработку
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSave('checked')}
                  loading={saving}
                >
                  <CheckCircle size={14} className="mr-1" />Принять
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
