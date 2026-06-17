import { useState, useRef } from 'react'
import { X, Upload, Paperclip, FileText, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'

interface Props {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
  homework: { id: string; title: string; max_score: number; file_url?: string } | null
  studentId: string | null
}

export function SubmitHomeworkModal({ open, onClose, onSubmitted, homework, studentId }: Props) {
  const [content, setContent]     = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) {
      setError('Файл слишком большой. Максимум 10 МБ.')
      return
    }
    setFile(f)
    setError('')
  }

  function removeFile() {
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function uploadFile(): Promise<string | null> {
    if (!file || !studentId || !homework) return null
    const ext  = file.name.split('.').pop()
    const path = `submissions/${homework.id}/${studentId}/${Date.now()}.${ext}`
    const { error: err } = await supabase.storage
      .from('homeworks')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (err) throw new Error('Ошибка загрузки файла: ' + err.message)
    const { data } = supabase.storage.from('homeworks').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleSubmit() {
    if (!homework || !studentId) return
    if (!content.trim() && !file) {
      setError('Введите ответ или прикрепите файл')
      return
    }
    setError('')
    setUploading(true)
    try {
      let fileUrl: string | null = null
      if (file) fileUrl = await uploadFile()

      const { error: err } = await supabase
        .from('homework_submissions')
        .upsert({
          homework_id:  homework.id,
          student_id:   studentId,
          answer_text:  content.trim() || null,
          file_url:     fileUrl,
          status:       'submitted',
          submitted_at: new Date().toISOString(),
        }, { onConflict: 'homework_id,student_id' })

      if (err) throw err

      setContent('')
      setFile(null)
      onSubmitted()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Ошибка при отправке')
    } finally {
      setUploading(false)
    }
  }

  if (!open || !homework) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Upload size={20} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Сдать задание</h2>
              <p className="text-xs text-gray-500 max-w-[220px] truncate">{homework.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">

          {/* Task file from teacher */}
          {homework.file_url && (
            <a
              href={homework.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group"
            >
              <FileText size={18} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
              <span className="text-sm text-gray-600 group-hover:text-blue-600 flex-1">
                Открыть файл задания
              </span>
              <span className="text-xs text-gray-400">↗</span>
            </a>
          )}

          {/* Text answer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Текстовый ответ
            </label>
            <textarea
              rows={4}
              value={content}
              onChange={e => { setContent(e.target.value); setError('') }}
              placeholder="Введите ответ, решение или ссылку на Google Docs…"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Прикрепить файл
            </label>
            {file ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                <FileText size={20} className="text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-green-800 truncate">{file.name}</div>
                  <div className="text-xs text-green-500">{(file.size / 1024).toFixed(0)} КБ</div>
                </div>
                <button type="button" onClick={removeFile} className="text-green-400 hover:text-red-500 transition-colors">
                  <XCircle size={18} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-green-300 hover:text-green-500 transition-colors"
              >
                <Paperclip size={16} />
                Прикрепить PDF / изображение
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG — до 10 МБ</p>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</p>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={uploading}>
              Отмена
            </Button>
            <Button className="flex-1" onClick={handleSubmit} loading={uploading}>
              {uploading ? 'Загрузка…' : 'Отправить'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
