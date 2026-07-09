import { useState, useRef, useEffect } from 'react'
import { X, Upload, Paperclip, FileText, XCircle, MessageSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { toast } from '@/store/toastStore'
import { getOrderedSubmissionFiles } from '@/lib/homeworkSubmissionFiles'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_TOTAL_SIZE = 40 * 1024 * 1024
const ACCEPTED_EXTS = ['pdf', 'png', 'jpg', 'jpeg']

interface Props {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
  homework: { id: string; title: string; max_score: number; file_url?: string } | null
  studentId: string | null
  isResubmit?: boolean
  previousFileUrl?: string | null
  previousFilePaths?: string[]
  feedback?: string | null
}

export function SubmitHomeworkModal({
  open, onClose, onSubmitted, homework, studentId,
  isResubmit = false, previousFileUrl = null, previousFilePaths = [], feedback = null,
}: Props) {
  const [files, setFiles]         = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFiles([])
    setError('')
  }, [open])

  function validateFiles(nextFiles: File[]): string | null {
    for (const file of nextFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const mime = file.type.toLowerCase()
      if (ext === 'heic' || ext === 'heif' || mime.includes('heic') || mime.includes('heif')) {
        return 'Сохраните как JPG или PDF'
      }
      if (!ACCEPTED_EXTS.includes(ext)) {
        return 'Поддерживаются только PDF, JPG и PNG'
      }
      if (file.size > MAX_FILE_SIZE) {
        return 'Файл слишком большой. Максимум 10 МБ.'
      }
    }
    const total = nextFiles.reduce((sum, file) => sum + file.size, 0)
    if (total > MAX_TOTAL_SIZE) return 'Суммарный размер файлов не должен превышать 40 МБ.'
    return null
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    const nextFiles = [...files, ...selected]
    const validationError = validateFiles(nextFiles)
    if (fileRef.current) fileRef.current.value = ''
    if (validationError) {
      setError(validationError)
      return
    }
    setFiles(nextFiles)
    setError('')
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_file, fileIndex) => fileIndex !== index))
  }

  async function ensureSubmissionRow() {
    if (!studentId || !homework) return null
    const { data: existing, error: existingError } = await supabase
      .from('homework_submissions')
      .select('id, status')
      .eq('homework_id', homework.id)
      .eq('student_id', studentId)
      .maybeSingle()

    if (existingError) throw existingError
    if (existing?.status && !['not_submitted', 'revision'].includes(existing.status)) {
      throw new Error('Работа уже проверена, обнови страницу')
    }
    if (existing?.id) return existing.id

    const { data: created, error: createError } = await supabase
      .from('homework_submissions')
      .insert({
        homework_id: homework.id,
        student_id: studentId,
        answer_text: null,
        file_url: null,
        status: 'not_submitted',
        score: null,
        checked_by: null,
        submitted_at: null,
      })
      .select('id')
      .single()

    if (createError) throw createError
    return created?.id || null
  }

  async function uploadFiles() {
    if (!files.length || !studentId || !homework) return []
    const stamp = Date.now()
    const uploaded: { storage_path: string; mime_type: string; position: number }[] = []
    for (const [index, file] of files.entries()) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
      const path = `submissions/${homework.id}/${studentId}/${stamp}-${index}-${crypto.randomUUID()}.${ext}`
      const { error: err } = await supabase.storage
        .from('homeworks')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (err) throw new Error('Ошибка загрузки файла: ' + err.message)
      uploaded.push({ storage_path: path, mime_type: file.type, position: index + 1 })
    }
    return uploaded
  }

  async function handleSubmit() {
    if (!homework || !studentId) return
    if (!files.length) {
      setError('Прикрепите хотя бы один файл')
      return
    }
    setError('')
    setUploading(true)
    try {
      const submissionId = await ensureSubmissionRow()
      if (!submissionId) throw new Error('Не удалось создать сдачу')

      if (isResubmit) {
        const { error: deleteError } = await (supabase as any)
          .from('homework_submission_files')
          .delete()
          .eq('submission_id', submissionId)
        if (deleteError) throw deleteError
      }

      const uploadedFiles = await uploadFiles()
      const { error: filesError } = await (supabase as any)
        .from('homework_submission_files')
        .insert(uploadedFiles.map(file => ({
          submission_id: submissionId,
          storage_path: file.storage_path,
          mime_type: file.mime_type,
          position: file.position,
        })))
      if (filesError) throw filesError

      const primaryFile = getOrderedSubmissionFiles(uploadedFiles)[0]?.storage_path ?? null
      const { data, error: err } = await supabase
        .from('homework_submissions')
        .update({
          answer_text: null,
          file_url: primaryFile,
          status: 'submitted',
          score: null,
          checked_by: null,
          submitted_at: new Date().toISOString(),
        })
        .eq('id', submissionId)
        .in('status', ['not_submitted', 'revision'])
        .select('id')

      if (err) throw err
      if (!data || data.length === 0) {
        setError('Работа уже проверена, обнови страницу')
        return
      }

      setFiles([])
      toast.success(isResubmit ? 'Работа отправлена на повторную проверку' : 'Работа отправлена на проверку')
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
    <div data-testid="submit-homework-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Upload size={20} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{isResubmit ? 'Пересдать задание' : 'Сдать задание'}</h2>
              <p className="text-xs text-gray-500 max-w-[220px] truncate">{homework.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">

          {/* Teacher feedback on the previous attempt */}
          {isResubmit && feedback && (
            <div className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded-xl">
              <MessageSquare size={16} className="text-orange-500 shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-orange-700 mb-0.5">Комментарий преподавателя</div>
                <p className="text-sm text-orange-800">{feedback}</p>
              </div>
            </div>
          )}

          {/* Previous attempt's files, for reference */}
          {isResubmit && (previousFilePaths.length > 0 || previousFileUrl) && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-500">Прошлая сдача</div>
              {(previousFilePaths.length > 0 ? previousFilePaths : previousFileUrl ? [previousFileUrl] : []).map((path, index) => (
                <SignedFileLink
                  key={`${path}-${index}`}
                  bucket="homeworks"
                  url={path}
                  className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                >
                  <FileText size={18} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
                  <span className="text-sm text-gray-600 group-hover:text-blue-600 flex-1 truncate">
                    {(previousFilePaths.length > 0 ? `Файл ${index + 1}` : 'Открыть прошлый файл')}
                  </span>
                  <span className="text-xs text-gray-400">↗</span>
                </SignedFileLink>
              ))}
            </div>
          )}

          {/* Task file from teacher */}
          {homework.file_url && (
            <SignedFileLink
              bucket="homeworks"
              url={homework.file_url}
              className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group"
            >
              <FileText size={18} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
              <span className="text-sm text-gray-600 group-hover:text-blue-600 flex-1">
                Открыть файл задания
              </span>
              <span className="text-xs text-gray-400">↗</span>
            </SignedFileLink>
          )}

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Прикрепить файл
            </label>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <FileText size={20} className="text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-green-800 truncate">{file.name}</div>
                    <div className="text-xs text-green-500">{(file.size / 1024).toFixed(0)} КБ</div>
                  </div>
                  <button type="button" aria-label={`Удалить файл ${index + 1}`} onClick={() => removeFile(index)} className="text-green-400 hover:text-red-500 transition-colors">
                    <XCircle size={18} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-green-300 hover:text-green-500 transition-colors"
              >
                <Paperclip size={16} />
                {files.length > 0 ? 'Добавить ещё файлы' : 'Прикрепить PDF / изображение'}
              </button>
            </div>
            <input
              data-testid="submit-homework-file-input"
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG — до 10 МБ на файл и до 40 МБ суммарно. HEIC/HEIF не поддерживаются.</p>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</p>
          )}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={uploading}>
              Отмена
            </Button>
            <Button data-testid="submit-homework-submit" className="flex-1" onClick={handleSubmit} loading={uploading}>
              {uploading ? 'Загрузка…' : isResubmit ? 'Отправить пересдачу' : 'Отправить'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
