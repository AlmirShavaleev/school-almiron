import { useState, useEffect } from 'react'
import { Save, Pencil, Lightbulb, MessageSquare, Lock } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useLessonSummary, useSaveLessonSummary } from '@/hooks/useLessonSummary'

interface Props {
  lessonId: string
  canEdit:  boolean
}

/**
 * Единая форма итогов занятия. teacher_notes виден и редактируется только
 * учителем/админом — RPC get_lesson_summary сам обнуляет его для ученика,
 * так что даже при ошибке во фронтенде поле не может утечь.
 */
export function LessonSummaryCard({ lessonId, canEdit }: Props) {
  const { summary, loading, reload } = useLessonSummary(lessonId)
  const { save, loading: saving, error: saveError } = useSaveLessonSummary()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(summary)

  useEffect(() => { if (!editing) setDraft(summary) }, [summary, editing])

  async function handleSave() {
    const ok = await save(lessonId, draft)
    if (ok) { setEditing(false); reload() }
  }

  if (loading) return <Card><div className="h-24 bg-gray-100 rounded-lg animate-pulse" /></Card>

  const hasAnyVisibleContent = summary.planned_topic || summary.actual_topic || summary.lesson_summary
    || summary.student_feedback || summary.recommendations || summary.board_url

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lightbulb size={17} />Итоги занятия</CardTitle>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
            <Pencil size={12} />Редактировать
          </button>
        )}
      </CardHeader>

      {editing ? (
        <div className="space-y-3">
          <Field label="Запланированная тема" value={draft.planned_topic} onChange={v => setDraft(d => ({ ...d, planned_topic: v }))} />
          <Field label="Фактически пройдено" value={draft.actual_topic} onChange={v => setDraft(d => ({ ...d, actual_topic: v }))} />
          <Field label="Итоги занятия" value={draft.lesson_summary} onChange={v => setDraft(d => ({ ...d, lesson_summary: v }))} multiline />
          <Field label="Что получилось хорошо (комментарий ученику)" value={draft.student_feedback} onChange={v => setDraft(d => ({ ...d, student_feedback: v }))} multiline />
          <Field label="Что нужно повторить (рекомендации)" value={draft.recommendations} onChange={v => setDraft(d => ({ ...d, recommendations: v }))} multiline />
          <Field label="Ссылка на доску" value={draft.board_url} onChange={v => setDraft(d => ({ ...d, board_url: v }))} />
          <Field label="Ссылка для подключения" value={draft.meeting_url} onChange={v => setDraft(d => ({ ...d, meeting_url: v }))} />
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">
              <Lock size={11} />Внутренняя заметка (ученик не увидит)
            </label>
            <textarea
              value={draft.teacher_notes ?? ''}
              onChange={e => setDraft(d => ({ ...d, teacher_notes: e.target.value || null }))}
              rows={2}
              className="w-full px-3 py-2 border border-amber-200 bg-amber-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave} loading={saving}><Save size={13} className="mr-1" />Сохранить</Button>
            <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setDraft(summary) }}>Отмена</Button>
          </div>
        </div>
      ) : !hasAnyVisibleContent ? (
        <p className="text-sm text-gray-400 italic">Итоги пока не заполнены</p>
      ) : (
        <div className="space-y-3 text-sm">
          {summary.planned_topic && <Row label="Тема">{summary.planned_topic}</Row>}
          {summary.actual_topic && <Row label="Прошли">{summary.actual_topic}</Row>}
          {summary.lesson_summary && <Row label="Итоги">{summary.lesson_summary}</Row>}
          {summary.student_feedback && (
            <Row label={<span className="flex items-center gap-1"><MessageSquare size={12} />Комментарий</span>}>{summary.student_feedback}</Row>
          )}
          {summary.recommendations && <Row label="Рекомендации">{summary.recommendations}</Row>}
          {summary.board_url && (
            <Row label="Доска"><a href={summary.board_url} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{summary.board_url}</a></Row>
          )}
          {canEdit && summary.teacher_notes && (
            <Row label={<span className="flex items-center gap-1 text-amber-700"><Lock size={12} />Заметка (только вам)</span>}>{summary.teacher_notes}</Row>
          )}
        </div>
      )}
    </Card>
  )
}

function Field({ label, value, onChange, multiline }: {
  label: string; value: string | null; onChange: (v: string | null) => void; multiline?: boolean
}) {
  const props = {
    value: value ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value || null),
    className: 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400',
  }
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}
    </div>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-0.5">{label}</p>
      <p className="text-gray-800 whitespace-pre-wrap">{children}</p>
    </div>
  )
}
