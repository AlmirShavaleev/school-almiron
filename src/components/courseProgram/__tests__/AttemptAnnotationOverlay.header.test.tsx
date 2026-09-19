import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * §208. Шапка разбора работы.
 *
 * Владелец: «не нужны ссылки на сами файлы, а чья работа и тема можно сделать
 * шрифтом побольше». Полоса с машинными именами файлов убрана с глаз, но не
 * выброшена — через неё скачивают оригинал, и это единственный путь, когда
 * встроенный просмотр не завёлся.
 */

vi.mock('@/components/courseProgram/SolutionReferencePanel', () => ({
  SolutionReferencePanel: () => <div data-testid="solution-reference-panel" />,
  useTopicSolutionMaterials: () => ({ materials: [], loading: false }),
}))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: () => <div data-testid="submission-reviewer" />,
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ url, children }: { url: string; children: React.ReactNode }) => (
    <a href={`signed:${url}`}>{children}</a>
  ),
}))

import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'

const files = [
  {
    id: 'f1', attempt_id: 'a1', storage_path: 'a1/1789646586292_img_0214.webp',
    file_name: '1789646586292_img_0214.webp', mime_type: 'image/webp', size_bytes: 10, position: 0, created_at: '',
  },
  {
    id: 'f2', attempt_id: 'a1', storage_path: 'a1/1789646586293_img_0215.webp',
    file_name: '1789646586293_img_0215.webp', mime_type: 'image/webp', size_bytes: 10, position: 1, created_at: '',
  },
]

function renderOverlay(props: Record<string, unknown> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ к теме «Механика»"
      lead="Иванов Иван · Кинематика"
      subtitle="сдано с опозданием"
      onClose={() => {}}
      {...props}
    />,
  )
}

describe('шапка разбора работы', () => {
  it('крупная строка — чья работа и тема, название задания уходит вниз', () => {
    renderOverlay()
    expect(screen.getByTestId('attempt-header-lead')).toHaveTextContent('Иванов Иван · Кинематика')
    expect(screen.getByTestId('attempt-header-secondary'))
      .toHaveTextContent('ДЗ к теме «Механика» · сдано с опозданием')
  })

  it('без «чьей работы» крупной остаётся сама работа — это экран ученика', () => {
    renderOverlay({ lead: undefined, subtitle: 'Пометки учителя' })
    expect(screen.getByTestId('attempt-header-lead')).toHaveTextContent('ДЗ к теме «Механика»')
    expect(screen.getByTestId('attempt-header-secondary')).toHaveTextContent('Пометки учителя')
  })

  it('имена файлов не висят на экране', () => {
    renderOverlay()
    expect(screen.queryByTestId('attempt-files-strip')).not.toBeInTheDocument()
    // Полное имя живёт в `title` чипа: на экране оно обрезано по середине.
    expect(screen.queryByTitle('1789646586292_img_0214.webp')).not.toBeInTheDocument()
  })

  it('кнопка «Файлы (2)» раскрывает список, и ссылки рабочие', () => {
    renderOverlay()
    const toggle = screen.getByTestId('attempt-files-toggle')
    expect(toggle).toHaveTextContent('Файлы (2)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(screen.getByTestId('attempt-files-strip')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'signed:a1/1789646586292_img_0214.webp')
    expect(screen.getByTitle('1789646586292_img_0214.webp')).toBeInTheDocument()
    expect(screen.getByTitle('1789646586293_img_0215.webp')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.queryByTestId('attempt-files-strip')).not.toBeInTheDocument()
  })

  it('файлов нет — нет и кнопки', () => {
    renderOverlay({ files: [] })
    expect(screen.queryByTestId('attempt-files-toggle')).not.toBeInTheDocument()
  })
})
