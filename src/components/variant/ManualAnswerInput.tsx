import { useRef, useState } from 'react'
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { SaveState } from '@/hooks/useVariantAttempt'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface AttachmentRecord {
  id:           string
  storage_path: string
  file_name:    string
  file_size:    number | null
  mime_type:    string | null
  uploaded_at:  string
}

interface Props {
  itemId:              string
  studentAssignmentId: string
  value:               string
  onChange:            (itemId: string, value: string) => void
  saveState:           SaveState
  disabled?:           boolean
  attachments:         AttachmentRecord[]
  onAttachmentAdd:     (itemId: string, attachment: AttachmentRecord) => void
  onAttachmentDelete:  (itemId: string, attachmentId: string) => void
}

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp,application/pdf'
const MAX_MB  = 20

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function FileIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith('image/')) return <ImageIcon size={16} className="text-blue-500 shrink-0" />
  return <FileText size={16} className="text-red-500 shrink-0" />
}

export function ManualAnswerInput({
  itemId, studentAssignmentId, value, onChange, saveState,
  disabled = false, attachments, onAttachmentAdd, onAttachmentDelete,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileRef.current) fileRef.current!.value = ''
    if (!file) return

    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadError(`Файл слишком большой (максимум ${MAX_MB} МБ)`)
      return
    }

    setUploadError(null)
    setUploading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Не авторизован')

      const ext      = file.name.split('.').pop()
      const safeName = `${Date.now()}.${ext}`
      const path     = `${user.id}/${studentAssignmentId}/${itemId}/${safeName}`

      const { error: uploadErr } = await supabase.storage
        .from('variant-solutions')
        .upload(path, file, { upsert: false })

      if (uploadErr) throw uploadErr

      const { data: rpcData, error: rpcErr } = await db.rpc('save_answer_attachment', {
        p_student_assignment_id: studentAssignmentId,
        p_variant_item_id:       itemId,
        p_storage_path:          path,
        p_file_name:             file.name,
        p_file_size:             file.size,
        p_mime_type:             file.type,
      })

      if (rpcErr) {
        // Roll back storage upload on RPC failure
        await supabase.storage.from('variant-solutions').remove([path])
        throw rpcErr
      }

      onAttachmentAdd(itemId, {
        id:           rpcData?.id ?? crypto.randomUUID(),
        storage_path: path,
        file_name:    file.name,
        file_size:    file.size,
        mime_type:    file.type,
        uploaded_at:  new Date().toISOString(),
      })
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Ошибка загрузки файла')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(att: AttachmentRecord) {
    setDeleting(att.id)
    try {
      const { error: rpcErr } = await db.rpc('delete_answer_attachment', {
        p_student_assignment_id: studentAssignmentId,
        p_attachment_id:         att.id,
      })
      if (rpcErr) throw rpcErr

      await supabase.storage.from('variant-solutions').remove([att.storage_path])
      onAttachmentDelete(itemId, att.id)
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Ошибка удаления файла')
    } finally {
      setDeleting(null)
    }
  }

  async function openFile(path: string) {
    const { data } = await supabase.storage
      .from('variant-solutions')
      .createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="mt-3 space-y-3" data-testid={`manual-answer-${itemId}`}>
      {/* Text solution */}
      <div className="relative">
        <textarea
          value={value}
          onChange={e => onChange(itemId, e.target.value)}
          disabled={disabled}
          placeholder="Введите решение..."
          rows={5}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm resize-y
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                     disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          data-testid={`manual-text-${itemId}`}
        />
        {saveState === 'saving' && (
          <Loader2 size={14} className="absolute top-2 right-2 animate-spin text-gray-400" />
        )}
        {saveState === 'error' && (
          <XCircle size={14} className="absolute top-2 right-2 text-red-500" aria-label="Ошибка сохранения" />
        )}
      </div>

      {/* Attachments list */}
      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map(att => (
            <li key={att.id}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
            >
              <FileIcon mime={att.mime_type} />
              <button
                type="button"
                onClick={() => openFile(att.storage_path)}
                className="flex-1 text-left text-primary-600 hover:underline truncate"
              >
                {att.file_name}
              </button>
              {att.file_size && (
                <span className="text-xs text-gray-400 shrink-0">{formatBytes(att.file_size)}</span>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(att)}
                  disabled={deleting === att.id}
                  className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
                  aria-label="Удалить файл"
                >
                  {deleting === att.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />
                  }
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload button */}
      {!disabled && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700
                       border border-primary-200 rounded-lg px-3 py-1.5 hover:bg-primary-50
                       transition-colors disabled:opacity-50"
          >
            {uploading
              ? <Loader2 size={14} className="animate-spin" />
              : <Paperclip size={14} />
            }
            {uploading ? 'Загрузка...' : 'Прикрепить файл'}
          </button>
          <span className="text-xs text-gray-400">PNG, JPG, PDF до {MAX_MB} МБ</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={handleFilePick}
          />
        </div>
      )}

      {uploadError && (
        <p className="text-xs text-red-600">{uploadError}</p>
      )}
    </div>
  )
}
