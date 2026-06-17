import { useEffect, useState } from 'react'
import { X, BookOpen, Calendar, Search, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'

interface CourseRow {
  id: string
  title: string
  subject: string | null
  exam_type: string | null
  price: number | null
  is_active: boolean
}

interface Props {
  open:     boolean
  onClose:  () => void
  onAdded:  () => void
  studentId: string
  /** course ids the student is already enrolled in (to disable) */
  excludeIds: string[]
}

const SOURCE_LABELS: Record<string, string> = {
  purchase: 'Покупка',
  manual:   'Вручную (админ)',
  trial:    'Триал',
  gift:     'Подарок',
}

export function EnrollCourseModal({ open, onClose, onAdded, studentId, excludeIds }: Props) {
  const [courses,    setCourses]    = useState<CourseRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [source,     setSource]     = useState<'manual'|'purchase'|'trial'|'gift'>('manual')
  const [expiresAt,  setExpiresAt]  = useState('')
  const [notes,      setNotes]      = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true); setSelectedId(null); setExpiresAt(''); setNotes(''); setErr(null)
    supabase.from('courses')
      .select('id, title, subject, exam_type, price, is_active')
      .eq('is_active', true)
      .order('title')
      .then(({ data }) => {
        setCourses((data || []) as CourseRow[])
        setLoading(false)
      })
  }, [open])

  if (!open) return null

  const available = courses.filter(c =>
    !excludeIds.includes(c.id) &&
    (search === '' || c.title.toLowerCase().includes(search.toLowerCase()))
  )

  async function handleSubmit() {
    if (!selectedId) return
    setSubmitting(true); setErr(null)
    const { error } = await supabase.from('student_courses').insert({
      student_id: studentId,
      course_id:  selectedId,
      status:     'active',
      source,
      expires_at: expiresAt || null,
      notes:      notes.trim() || null,
    })
    setSubmitting(false)
    if (error) { setErr(error.message); return }
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary-600" />
            <h2 className="text-lg font-semibold text-gray-900">Записать на курс</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск курса…"
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>

          {/* Course list */}
          <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
                <Loader2 size={16} className="animate-spin" />Загрузка…
              </div>
            ) : available.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                {search ? 'Ничего не найдено' : 'Все курсы уже добавлены'}
              </div>
            ) : (
              available.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors',
                    selectedId === c.id
                      ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                      : 'border-gray-200 hover:border-primary-300'
                  )}
                >
                  <BookOpen size={16} className={cn(selectedId === c.id ? 'text-primary-600' : 'text-gray-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{c.title}</div>
                    <div className="text-xs text-gray-500">
                      {c.subject === 'physics' ? 'Физика' : c.subject === 'math' ? 'Математика' : c.subject}
                      {c.exam_type && ` · ${c.exam_type.toUpperCase()}`}
                      {c.price != null && c.price > 0 && ` · ${new Intl.NumberFormat('ru-RU').format(c.price)} ₽`}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Options for selected */}
          {selectedId && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Источник</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(['manual','purchase','trial','gift'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSource(s)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                        source === s ? 'bg-primary-50 border-primary-300 text-primary-700'
                                     : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {SOURCE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="Действует до (необязательно)"
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                icon={<Calendar size={14} />}
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Заметка (необязательно)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Например: подарок к дню рождения, тестовый доступ…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">
              <AlertCircle size={15} />{err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>Отмена</Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={!selectedId}>
              Записать
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
