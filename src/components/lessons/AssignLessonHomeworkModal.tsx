import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Send, CalendarClock, BookOpen, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCollections } from '@/hooks/useCollections'
import { useAssignLessonHomework } from '@/hooks/useAssignments'
import { setLessonHomeworkDraftContext } from '@/utils/lessonHomeworkDraft'

interface Props {
  lessonId:            string
  preselectCollectionId?: string
  onClose:    () => void
  onAssigned: () => void
}

export function AssignLessonHomeworkModal({ lessonId, preselectCollectionId, onClose, onAssigned }: Props) {
  const navigate = useNavigate()
  const { collections, loading: collectionsLoading } = useCollections()
  const { assign, loading, error, isDuplicate } = useAssignLessonHomework()

  const [collectionId, setCollectionId] = useState(preselectCollectionId ?? '')
  const [dueDate, setDueDate] = useState('')
  const [success, setSuccess] = useState(false)

  function goBuildNewCollection() {
    setLessonHomeworkDraftContext(lessonId)
    navigate('/catalog')
  }

  async function handleAssign(confirmDup = false) {
    if (!collectionId) return
    setSuccess(false)
    const ok = await assign(lessonId, collectionId, dueDate ? new Date(dueDate).toISOString() : null, confirmDup)
    if (ok) { setSuccess(true); onAssigned() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><BookOpen size={18} />Добавить домашнее задание</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Подборка задач</label>
          {collectionsLoading ? (
            <p className="text-sm text-gray-400">Загрузка…</p>
          ) : (
            <select
              value={collectionId}
              onChange={e => setCollectionId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">Выберите подборку…</option>
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}
          <button onClick={goBuildNewCollection} className="mt-2 text-xs text-primary-600 hover:text-primary-700">
            Собрать новую подборку в каталоге →
          </button>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
            <CalendarClock size={14} />Дедлайн (необязательно)
          </label>
          <input
            type="datetime-local"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>

        {isDuplicate && (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <div>
              Эта подборка уже назначена на это занятие.
              <button onClick={() => handleAssign(true)} className="block mt-1 font-medium underline">
                Всё равно назначить ещё раз
              </button>
            </div>
          </div>
        )}
        {error && !isDuplicate && <p className="text-sm text-red-600">{error}</p>}
        {success && (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            <CheckCircle2 size={16} /> Домашнее задание назначено
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Закрыть</Button>
          <Button className="flex-1" onClick={() => handleAssign(false)} loading={loading} disabled={!collectionId}>
            <Send size={15} />Назначить
          </Button>
        </div>
      </div>
    </div>
  )
}
