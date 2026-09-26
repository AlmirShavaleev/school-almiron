import { useEffect } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { SignedImage } from '@/components/ui/SignedImage'
import { useSignedPdf } from '@/hooks/useSignedPdf'
import { MOCK_EXAMS_BUCKET } from '@/lib/mockExamLesson'
import { isPdfFile } from '@/lib/mockExamVariants'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §229. Миниатюра файла второй части у ученика. Картинка — как была; PDF —
 * плитка «PDF · N стр.» (раньше на его месте стояло «Не удалось показать
 * изображение»: `<img>` PDF не рисует). Файл, который не открылся (битый,
 * HEIC в браузере без HEIC), — сообщается наверх: окно сдачи предупредит.
 */
export function WorkFileThumb({ file, index, className, onBroken }: {
  file: { storage_path: string; file_name: string; mime_type: string | null }
  index: number
  className?: string
  onBroken?: (broken: boolean) => void
}) {
  if (isPdfFile(file)) return <PdfTile path={file.storage_path} index={index} className={className} onBroken={onBroken} />
  return (
    <SignedImage bucket={MOCK_EXAMS_BUCKET} path={file.storage_path} alt={`Фото ${index + 1}`} onFailed={() => onBroken?.(true)}
      className={cn('rounded border border-graphite-200 object-cover', className)} />
  )
}

function PdfTile({ path, index, className, onBroken }: { path: string; index: number; className?: string; onBroken?: (broken: boolean) => void }) {
  const pdf = useSignedPdf(MOCK_EXAMS_BUCKET, path)
  useEffect(() => {
    if (pdf.status === 'failed') onBroken?.(true)
    if (pdf.status === 'ready') onBroken?.(false)
    // onBroken — колбэк родителя, новый на каждый рендер; важен только исход загрузки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.status])
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1 rounded border border-graphite-200 bg-primary-50 text-primary-600', className)}
      data-testid="mock-lesson-pdf-tile" role="img" aria-label={`Файл ${index + 1}: PDF${pdf.status === 'ready' ? `, ${pdf.pages} ${plural(pdf.pages, 'страница', 'страницы', 'страниц')}` : ''}`}>
      <FileText size={22} aria-hidden />
      <span className="text-[11px] font-bold leading-tight">PDF</span>
      <span className="text-[11px] leading-tight text-graphite-600">
        {pdf.status === 'ready' ? `${pdf.pages} стр.` : pdf.status === 'failed' ? 'не открылся' : <Loader2 size={11} className="animate-spin" aria-label="считаю страницы" />}
      </span>
    </div>
  )
}
