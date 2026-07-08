import { useState, useEffect } from 'react'
import { Paperclip, Link2, Video, PenTool, StickyNote, X, Plus, Eye, EyeOff } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import {
  useLessonMaterials, useAddLessonMaterial, useDeleteLessonMaterial,
  uploadLessonMaterialFile, getLessonMaterialSignedUrl,
} from '@/hooks/useLessonMaterials'
import { MATERIAL_TYPE_LABELS } from '@/types/lessons'
import type { LessonMaterial, MaterialType } from '@/types/lessons'

const TYPE_ICON: Record<MaterialType, React.ReactNode> = {
  file: <Paperclip size={14} />, link: <Link2 size={14} />, recording: <Video size={14} />,
  board: <PenTool size={14} />, note: <StickyNote size={14} />,
}

interface Props {
  lessonId: string
  canEdit:  boolean
}

export function LessonMaterialsCard({ lessonId, canEdit }: Props) {
  const { materials, loading, reload } = useLessonMaterials(lessonId)
  const { remove } = useDeleteLessonMaterial()
  const [showForm, setShowForm] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Paperclip size={17} />Материалы занятия</CardTitle>
        {canEdit && (
          <button onClick={() => setShowForm(v => !v)} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
            <Plus size={12} />Добавить
          </button>
        )}
      </CardHeader>

      {showForm && (
        <AddMaterialForm lessonId={lessonId} onDone={() => { setShowForm(false); reload() }} />
      )}

      {loading ? (
        <div className="h-16 bg-gray-100 rounded-lg animate-pulse mt-2" />
      ) : materials.length === 0 ? (
        <p className="text-sm text-gray-400 py-3 text-center">Материалов пока нет</p>
      ) : (
        <div className="space-y-2 mt-2">
          {materials.map(m => (
            <MaterialRow key={m.id} material={m} canEdit={canEdit} onDeleted={reload} onDelete={remove} />
          ))}
        </div>
      )}
    </Card>
  )
}

function MaterialRow({ material, canEdit, onDeleted, onDelete }: {
  material: LessonMaterial
  canEdit: boolean
  onDeleted: () => void
  onDelete: (id: string, path: string | null) => Promise<boolean>
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (material.storage_path) getLessonMaterialSignedUrl(material.storage_path).then(setSignedUrl)
  }, [material.storage_path])

  const href = material.url ?? signedUrl
  const label = material.title || MATERIAL_TYPE_LABELS[material.material_type]

  return (
    <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2" data-testid="material-row" data-material-id={material.id}>
      <span className="text-gray-500 flex-shrink-0">{TYPE_ICON[material.material_type]}</span>
      <div className="flex-1 min-w-0">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-sm text-primary-700 hover:underline truncate block">{label}</a>
        ) : (
          <span className="text-sm text-gray-700 truncate block">{label}</span>
        )}
      </div>
      {canEdit && (
        <>
          <span title={material.is_visible_to_student ? 'Видно ученику' : 'Скрыто от ученика'} className="flex-shrink-0">
            {material.is_visible_to_student
              ? <Eye size={13} className="text-gray-400" />
              : <EyeOff size={13} className="text-gray-300" />
            }
          </span>
          <button
            data-testid="material-delete-button"
            onClick={async () => { if (await onDelete(material.id, material.storage_path)) onDeleted() }}
            className="text-gray-300 hover:text-red-500 flex-shrink-0"
          >
            <X size={14} />
          </button>
        </>
      )}
    </div>
  )
}

function AddMaterialForm({ lessonId, onDone }: { lessonId: string; onDone: () => void }) {
  const profile = useAuthStore(s => s.profile)
  const { add, loading, error } = useAddLessonMaterial(lessonId)
  const [type, setType] = useState<MaterialType>('link')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [visible, setVisible] = useState(true)
  const [uploading, setUploading] = useState(false)

  async function handleSubmit() {
    if (type === 'file') return // file submits via its own input handler
    if (!url.trim() && type !== 'note') return
    const ok = await add({ material_type: type, title: title || null, url: url || null, is_visible_to_student: visible })
    if (ok) onDone()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile) return
    setUploading(true)
    const path = await uploadLessonMaterialFile(lessonId, profile.id, file)
    setUploading(false)
    if (!path) return
    const ok = await add({ material_type: 'file', title: title || file.name, storage_path: path, is_visible_to_student: visible })
    if (ok) onDone()
  }

  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2 mb-2">
      <div className="flex gap-2 flex-wrap">
        {(['link', 'recording', 'board', 'note', 'file'] as MaterialType[]).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${type === t ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
          >
            {MATERIAL_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <input
        type="text" value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Название (необязательно)"
        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
      />

      {type === 'file' ? (
        <input type="file" onChange={handleFileChange} disabled={uploading} className="text-sm" />
      ) : (
        <input
          type="text" value={url} onChange={e => setUrl(e.target.value)}
          placeholder={type === 'note' ? 'Текст комментария' : 'URL'}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
        />
      )}

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} className="accent-primary-600" />
        Видно ученику
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {type !== 'file' && (
        <Button size="sm" onClick={handleSubmit} loading={loading}>Добавить</Button>
      )}
    </div>
  )
}
