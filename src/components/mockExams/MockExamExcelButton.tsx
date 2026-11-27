import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { MockExamTableExport } from '@/utils/exportExcel'

export function MockExamExcelButton({ exam, getTable, disabled }: {
  exam: { title: string; date: string; groupName?: string | null }
  getTable: () => MockExamTableExport
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function onDownload() {
    setLoading(true)
    setFailed(false)
    try {
      const table = getTable()
      const { exportMockExamTable } = await import('@/utils/exportExcel')
      exportMockExamTable(exam, table)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-w-0">
      <Button type="button" variant="secondary" loading={loading} disabled={disabled} onClick={onDownload}>
        <Download size={15} aria-hidden /> Скачать Excel
      </Button>
      {failed && <p className="mt-1 text-xs text-verdict-bad-ink" role="alert">Не удалось скачать Excel. Попробуйте ещё раз.</p>}
    </div>
  )
}
