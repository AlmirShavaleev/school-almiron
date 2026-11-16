import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import type { TopicMaterial, TopicMaterialSection } from '@/lib/topicMaterialItems'

/**
 * Теория только в PDF (старые темы планиметрии и векторов): ученик видит её
 * листами прямо во вкладке «Теория», плитка для скачивания остаётся под ней.
 */

let materials: TopicMaterial[] = []
let pdfStatus: 'ready' | 'loading' | 'failed' = 'ready'
const signedPdfCalls: Array<[string, string | null | undefined]> = []

const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) },
}))

vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({
    materials, loading: false, error: null, reload: vi.fn(),
    uploadMaterialFile: vi.fn(), addMaterial: vi.fn(), deleteMaterial: vi.fn(),
    toggleVisibility: vi.fn(), moveMaterial: vi.fn(),
  }),
}))

vi.mock('@/hooks/useSignedPdf', () => ({
  useSignedPdf: (bucket: string, path: string | null | undefined) => {
    signedPdfCalls.push([bucket, path])
    return pdfStatus === 'ready'
      ? { status: 'ready', doc: {}, pages: 3 }
      : { status: pdfStatus, doc: null, pages: 0 }
  },
}))

vi.mock('@/components/pdf/PdfPageView', () => ({
  PdfPageView: ({ page, label }: { page: number; label?: string }) => (
    <div data-testid="pdf-page-stub" aria-label={label}>страница {page}</div>
  ),
}))

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const pdf = (id: string, section: TopicMaterialSection = 'theory', fileName = 'Теория.pdf'): TopicMaterial =>
  ({ kind: 'file', id, title: 'Теория', position: 0, isVisible: true, section,
     storagePath: `${TOPIC}/1_teoriya.pdf`, fileName, sizeBytes: 2048 })

const theoryText = (): TopicMaterial =>
  ({ kind: 'text', id: 'th', title: 'Теория', position: 0, isVisible: true, section: 'theory',
     content: '<!--theory-->\n## Т1. Раздел\n\nТекст теории.' })

function renderTab(canManage: boolean, section: TopicMaterialSection = 'theory') {
  return render(<TopicMaterialItems topicId={TOPIC} canManage={canManage} section={section} hideAddForm />)
}

beforeEach(() => {
  materials = []
  pdfStatus = 'ready'
  signedPdfCalls.length = 0
  rpc.mockClear()
})

describe('Теория только в PDF', () => {
  it('ученик видит листы PDF во вкладке, плитка для скачивания остаётся', () => {
    materials = [pdf('p1')]
    renderTab(false)

    expect(screen.getByTestId('theory-pdf-pages')).toBeInTheDocument()
    expect(screen.getAllByTestId('pdf-page-stub')).toHaveLength(3)
    expect(screen.getByLabelText('Теория, страница 3 из 3')).toBeInTheDocument()
    expect(screen.getByText('Теория.pdf')).toBeInTheDocument()
    expect(signedPdfCalls[0]).toEqual(['topic-materials', `${TOPIC}/1_teoriya.pdf`])
  })

  it('показанная теория засчитывается как просмотр файла', async () => {
    materials = [pdf('p1')]
    renderTab(false)

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('record_material_view', { p_item_id: 'p1' }))
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('есть теория страницей — PDF остаётся плиткой, листами не рисуется', () => {
    materials = [pdf('p1'), theoryText()]
    renderTab(false)

    expect(screen.getByTestId('theory-article')).toBeInTheDocument()
    expect(screen.queryByTestId('theory-pdf-pages')).not.toBeInTheDocument()
    expect(signedPdfCalls).toHaveLength(0)
  })

  it('у преподавателя рубрика остаётся списком файлов', () => {
    materials = [pdf('p1')]
    renderTab(true)

    expect(screen.queryByTestId('theory-pdf-pages')).not.toBeInTheDocument()
    expect(signedPdfCalls).toHaveLength(0)
  })

  it('в других рубриках PDF листами не показывается', () => {
    materials = [pdf('p1', 'tasks')]
    renderTab(false, 'tasks')

    expect(screen.queryByTestId('theory-pdf-pages')).not.toBeInTheDocument()
  })

  it('из нескольких PDF листами показывается только первый', () => {
    materials = [pdf('p1'), { ...pdf('p2'), fileName: 'Конспект.pdf' } as TopicMaterial]
    renderTab(false)

    expect(screen.getAllByTestId('theory-pdf-pages')).toHaveLength(1)
    expect(screen.getByText('Конспект.pdf')).toBeInTheDocument()
  })

  it('не PDF (документ Word) листами не рисуется', () => {
    materials = [{ ...pdf('p1'), fileName: 'конспект.docx', storagePath: `${TOPIC}/1_konspekt.docx` } as TopicMaterial]
    renderTab(false)

    expect(screen.queryByTestId('theory-pdf-pages')).not.toBeInTheDocument()
  })

  it('PDF не загрузился — подсказка открыть файл, плитка на месте, просмотр не засчитан', () => {
    pdfStatus = 'failed'
    materials = [pdf('p1')]
    renderTab(false)

    expect(screen.getByText(/Не удалось показать теорию страницами/)).toBeInTheDocument()
    expect(screen.getByText('Теория.pdf')).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
  })
})
