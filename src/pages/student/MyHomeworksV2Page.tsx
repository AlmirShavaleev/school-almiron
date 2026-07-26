import { useMemo, useState } from 'react'
import { Clock, FileText, Loader2, Paperclip, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useMyHomeworkAssignments } from '@/hooks/useMyHomeworkAssignments'
import { useHomeworkAttemptV2 } from '@/hooks/useHomeworkAttemptV2'
import { HW_V2_CATEGORY_LABELS, type HomeworkV2Category, type HomeworkV2Row } from '@/types/homeworkV2'
import { formatDate } from '@/utils/format'
import { cn } from '@/utils/cn'

const TABS: HomeworkV2Category[] = ['new', 'to_do', 'under_review', 'returned_for_revision', 'checked']

export function MyHomeworksV2Page() {
  const { rows, loading, error, reload } = useMyHomeworkAssignments()
  const [tab, setTab] = useState<HomeworkV2Category>('to_do')
  const [target, setTarget] = useState<HomeworkV2Row | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.category] = (c[r.category] || 0) + 1
    return c
  }, [rows])

  const visible = rows.filter(r => r.category === tab)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} />Загрузка…</div>
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Мои задания</h1>
        <p className="text-gray-500 mt-1">Домашние задания по вашим группам</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
              tab === t ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            )}
          >
            {HW_V2_CATEGORY_LABELS[t]} {counts[t] ? <span className="opacity-70">({counts[t]})</span> : null}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{HW_V2_CATEGORY_LABELS[tab]}</CardTitle>
          <Badge variant="default">{visible.length}</Badge>
        </CardHeader>

        {visible.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Пусто</p>
        ) : (
          <div className="space-y-4">
            {visible.map(r => (
              <div key={r.assignment_id} className={cn(
                'p-5 rounded-xl border transition-all hover:shadow-sm',
                r.overdue ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
              )}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{r.template_title}</h3>
                      {r.overdue && <Badge variant="error">Просрочено</Badge>}
                      {r.is_excused && <Badge variant="default">Освобождён</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Clock size={12} />До {formatDate(r.effective_due_at)}</span>
                      <span>{r.group_name}</span>
                      <span>Попытка {r.attempts_count}{r.max_attempts ? ` / ${r.max_attempts}` : ''}</span>
                    </div>
                    {r.latest_review_comment && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                        <strong>Комментарий:</strong> {r.latest_review_comment}
                      </div>
                    )}
                    {r.latest_score != null && (
                      <div className="mt-2 text-sm font-bold text-primary-600">Оценка: {r.latest_score}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {(tab === 'new' || tab === 'to_do' || tab === 'returned_for_revision') && !r.is_excused && (
                      <Button size="sm" onClick={() => setTarget(r)}>
                        {tab === 'returned_for_revision' ? 'Пересдать' : 'Сдать'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {target && (
        <SubmitAttemptModal row={target} onClose={() => setTarget(null)} onSubmitted={() => { setTarget(null); reload() }} />
      )}
    </div>
  )
}

function SubmitAttemptModal({ row, onClose, onSubmitted }: { row: HomeworkV2Row; onClose: () => void; onSubmitted: () => void }) {
  const { submitAttempt, submitting, error } = useHomeworkAttemptV2()
  const [answerText, setAnswerText] = useState('')
  const [files, setFiles] = useState<File[]>([])

  async function handleSubmit() {
    await submitAttempt(row.assignment_id, answerText, files)
    onSubmitted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{row.template_title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ответ</label>
            <textarea rows={4} value={answerText} onChange={e => setAnswerText(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Файлы</label>
            <label className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-primary-300 hover:text-primary-500 cursor-pointer transition-colors">
              <Paperclip size={16} />Прикрепить файлы
              <input type="file" multiple className="hidden" onChange={e => setFiles(Array.from(e.target.files || []))} />
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-gray-600"><FileText size={12} />{f.name}</li>
                ))}
              </ul>
            )}
          </div>
          {error && <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
            <Button type="button" loading={submitting} onClick={handleSubmit} className="flex-1">Отправить</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
