import { useEffect, useState } from 'react'
import { X, Loader2, Check, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { notifyMockExamResult } from '@/utils/notify'

interface StudentRow {
  student_id: string
  profile_id: string
  full_name:  string
  avatar_url: string | null
  score:      string
  feedback:   string
}

interface Props {
  open:     boolean
  onClose:  () => void
  onSaved:  () => void
  examId:   string | null
  groupId:  string | null
  maxScore: number
  examTitle?: string
}

export function MockExamResultsModal({ open, onClose, onSaved, examId, groupId, maxScore, examTitle }: Props) {
  const [rows,    setRows]    = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    if (!open || !groupId || !examId) return
    setLoading(true)
    setSaved(false)

    async function load() {
      // Students in group
      const { data: gs } = await supabase
        .from('group_students')
        .select('student_id, students(id, profile_id, profiles(full_name, avatar_url))')
        .eq('group_id', groupId!)

      // Existing results for this exam
      const { data: existing } = await (supabase as any)
        .from('mock_exam_results')
        .select('student_id, score, feedback')
        .eq('mock_exam_id', examId!)

      const existMap: Record<string, { score: number; feedback: string }> = {}
      for (const r of (existing || []) as any[]) existMap[r.student_id] = r

      setRows((gs || []).map((g: any) => ({
        student_id: g.student_id,
        profile_id: g.students?.profile_id || '',
        full_name:  g.students?.profiles?.full_name || '—',
        avatar_url: g.students?.profiles?.avatar_url || null,
        score:      existMap[g.student_id] != null ? String(existMap[g.student_id].score) : '',
        feedback:   existMap[g.student_id]?.feedback || '',
      })))
      setLoading(false)
    }
    load()
  }, [open, groupId, examId])

  function setScore(studentId: string, score: string) {
    setRows(prev => prev.map(r => r.student_id === studentId ? { ...r, score } : r))
  }
  function setFeedback(studentId: string, feedback: string) {
    setRows(prev => prev.map(r => r.student_id === studentId ? { ...r, feedback } : r))
  }

  async function handleSave() {
    if (!examId) return
    setSaving(true)

    const toUpsert = rows
      .filter(r => r.score !== '')
      .map(r => ({
        mock_exam_id: examId,
        student_id:   r.student_id,
        score:        parseInt(r.score),
        feedback:     r.feedback.trim() || null,
      }))

    const { error } = await supabase
      .from('mock_exam_results')
      .upsert(toUpsert as any, { onConflict: 'mock_exam_id,student_id' })

    setSaving(false)
    if (error) { alert(error.message); return }

    // Уведомить студентов
    const examTitleStr = examTitle || 'Пробный экзамен'
    for (const r of toUpsert) {
      const row = rows.find(x => x.student_id === r.student_id)
      if (row?.profile_id) {
        notifyMockExamResult(row.profile_id, examTitleStr, r.score, maxScore)
      }
    }

    setSaved(true)
    onSaved()
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  if (!open) return null

  const filledCount = rows.filter(r => r.score !== '').length
  const avg = filledCount > 0
    ? Math.round(rows.filter(r => r.score !== '').reduce((s, r) => s + parseInt(r.score), 0) / filledCount)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Результаты</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {examTitle} · макс. {maxScore} б.
              {avg != null && <span className="ml-2 text-primary-600 font-medium">среднее: {avg}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3"><X size={20} /></button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />Загрузка…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">В группе нет студентов</div>
          ) : (
            rows.map(row => {
              const scoreNum = parseInt(row.score)
              const pct = !isNaN(scoreNum) && row.score !== '' ? Math.round(scoreNum / maxScore * 100) : null
              return (
                <div key={row.student_id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm shrink-0 overflow-hidden">
                      {row.avatar_url
                        ? <img src={row.avatar_url} className="w-full h-full object-cover" />
                        : row.full_name.charAt(0)
                      }
                    </div>
                    <span className="flex-1 text-sm font-medium text-gray-800">{row.full_name}</span>

                    {/* Score input */}
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={maxScore}
                        value={row.score}
                        onChange={e => setScore(row.student_id, e.target.value)}
                        placeholder="—"
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-bold text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <span className="text-xs text-gray-400">/ {maxScore}</span>
                      {pct != null && (
                        <span className={cn(
                          'text-xs font-semibold w-10 text-right',
                          pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500'
                        )}>{pct}%</span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {pct != null && (
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden mx-11">
                      <div
                        className={cn('h-full rounded-full transition-all', pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}

                  {/* Feedback */}
                  <input
                    type="text"
                    value={row.feedback}
                    onChange={e => setFeedback(row.student_id, e.target.value)}
                    placeholder="Комментарий (необязательно)"
                    className="w-full border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-400 bg-gray-50"
                  />
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between">
          <span className="text-xs text-gray-400">{filledCount} / {rows.length} заполнено</span>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <Check size={13} />Сохранено
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={onClose}>Отмена</Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={filledCount === 0}>
              <Save size={14} className="mr-1" />Сохранить результаты
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
