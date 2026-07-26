import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, X, Plus } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useHomeworkReviewQueueV2, type ReviewQueueMode } from '@/hooks/useHomeworkReviewQueueV2'
import { useHomeworkReviewV2, type HomeworkReviewDecision } from '@/hooks/useHomeworkReviewV2'
import type { HomeworkV2Row } from '@/types/homeworkV2'
import { formatDate } from '@/utils/format'
import { cn } from '@/utils/cn'

const TABS: { mode: ReviewQueueMode; label: string }[] = [
  { mode: 'pending', label: 'На проверке' },
  { mode: 'returned', label: 'На доработке' },
  { mode: 'checked', label: 'Проверенные' },
]

export function HomeworkReviewV2Page() {
  const [mode, setMode] = useState<ReviewQueueMode>('pending')
  const { items, loading, error, reload } = useHomeworkReviewQueueV2(mode)
  const [target, setTarget] = useState<HomeworkV2Row | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Проверка ДЗ</h1>
          <p className="text-gray-500 mt-1">Очередь по всем вашим группам</p>
        </div>
        <Link to="/homework-templates/new">
          <Button size="sm"><Plus size={15} className="mr-1.5" />Конструктор шаблона ДЗ</Button>
        </Link>
      </div>

      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.mode}
            onClick={() => setMode(t.mode)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
              mode === t.mode ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{TABS.find(t => t.mode === mode)?.label}</CardTitle>
          <Badge variant="default">{items.length}</Badge>
        </CardHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} />Загрузка…</div>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Пусто</p>
        ) : (
          <div className="space-y-4">
            {items.map(r => (
              <div key={`${r.assignment_id}-${r.student_id}`} className="p-5 rounded-xl border border-gray-200 bg-white hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{r.template_title}</h3>
                      <span className="text-xs text-gray-400">{r.student_name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span>{r.group_name}</span>
                      <span>Попытка {r.latest_attempt_number}</span>
                      {r.latest_submitted_at && <span>Сдано {formatDate(r.latest_submitted_at)}</span>}
                    </div>
                  </div>
                  {mode !== 'checked' && (
                    <Button size="sm" onClick={() => setTarget(r)}>Проверить</Button>
                  )}
                  {mode === 'checked' && r.latest_score != null && (
                    <span className="text-sm font-bold text-primary-600">{r.latest_score}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {target && (
        <ReviewModal row={target} onClose={() => setTarget(null)} onReviewed={() => { setTarget(null); reload() }} />
      )}
    </div>
  )
}

function ReviewModal({ row, onClose, onReviewed }: { row: HomeworkV2Row; onClose: () => void; onReviewed: () => void }) {
  const { review, submitting, error } = useHomeworkReviewV2()
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')

  async function handleDecision(decision: HomeworkReviewDecision) {
    if (!row.latest_attempt_id) return
    await review(row.latest_attempt_id, decision, score ? Number(score) : null, comment)
    onReviewed()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{row.template_title} — {row.student_name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Оценка</label>
            <input type="number" min={0} value={score} onChange={e => setScore(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Комментарий</label>
            <textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
          </div>
          {error && <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" loading={submitting} onClick={() => handleDecision('returned_for_revision')} className="flex-1">На доработку</Button>
            <Button type="button" variant="secondary" loading={submitting} onClick={() => handleDecision('rejected')} className="flex-1">Отклонить</Button>
            <Button type="button" loading={submitting} onClick={() => handleDecision('accepted')} className="flex-1">Принять</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
