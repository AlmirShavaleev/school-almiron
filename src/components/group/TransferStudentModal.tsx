import { useState, useEffect } from 'react'
import { X, ArrowLeftRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'

export function TransferStudentModal({
  open, onClose, onDone, studentId, studentName, fromGroupId,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
  studentId: string
  studentName: string
  fromGroupId: string
}) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (!open) return
    setTarget(''); setError('')
    supabase.from('groups').select('id, name').neq('id', fromGroupId).order('name')
      .then(({ data }) => setGroups((data || []) as any))
  }, [open, fromGroupId])

  async function transfer() {
    if (!target) { setError('Выберите группу'); return }
    setSaving(true); setError('')
    // insert в новую, затем удалить из старой
    const { error: insErr } = await supabase.from('group_students').insert({ group_id: target, student_id: studentId })
    if (insErr && !insErr.message.includes('duplicate')) { setSaving(false); setError(insErr.message); return }
    const { error: delErr } = await supabase.from('group_students').delete().eq('group_id', fromGroupId).eq('student_id', studentId)
    setSaving(false)
    if (delErr) { setError(delErr.message); return }
    onDone(); onClose()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm z-10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><ArrowLeftRight size={18} className="text-blue-500" />Перевод ученика</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <p className="text-sm text-gray-500">Перевести <strong>{studentName}</strong> в другую группу. История сдач сохранится.</p>
        <Select
          label="Целевая группа"
          value={target}
          onChange={e => setTarget(e.target.value)}
          options={[{ value: '', label: '— выберите группу —' }, ...groups.map(g => ({ value: g.id, label: g.name }))]}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
          <Button onClick={transfer} loading={saving} className="flex-1">Перевести</Button>
        </div>
      </div>
    </div>
  )
}
