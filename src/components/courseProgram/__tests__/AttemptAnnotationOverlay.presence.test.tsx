import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'
import type { PresenceMeta } from '@/lib/reviewPresence'

/**
 * Полоса присутствия в разборе работы. Без файлов аннотатор (pdfjs) не
 * подгружается вовсе — это позволяет проверить именно баннер и вердикт,
 * не поднимая тяжёлый редактор.
 */

const ANNA: PresenceMeta = { profileId: 'p-anna', name: 'Аня', attemptId: 'a1' }

function renderOverlay(props: Partial<Parameters<typeof AttemptAnnotationOverlay>[0]> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={[]}
      title="Домашнее задание"
      onClose={() => {}}
      footer={() => <div data-testid="verdict-form">форма вердикта</div>}
      {...props}
    />,
  )
}

describe('AttemptAnnotationOverlay — присутствие коллег', () => {
  it('без коллег полосы нет, вердикт доступен', () => {
    renderOverlay()
    expect(screen.queryByTestId('presence-banner-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('presence-banner-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('verdict-form')).toBeInTheDocument()
  })

  it('в режиме чтения называет коллегу и убирает форму вердикта', () => {
    renderOverlay({ viewers: [ANNA], locked: true })

    const banner = screen.getByTestId('presence-banner-locked')
    expect(banner).toHaveTextContent('Смотрит: Аня')
    expect(banner).toHaveTextContent('только для чтения')
    expect(screen.queryByTestId('verdict-form')).not.toBeInTheDocument()
  })

  it('кнопка «Всё равно редактировать» зовёт наружу', () => {
    const onForceEdit = vi.fn()
    renderOverlay({ viewers: [ANNA], locked: true, onForceEdit })

    fireEvent.click(screen.getByTestId('presence-force-edit'))
    expect(onForceEdit).toHaveBeenCalledTimes(1)
  })

  it('коллега, пришедший позже, только предупреждает — вердикт остаётся', () => {
    renderOverlay({ viewers: [ANNA], locked: false })

    expect(screen.getByTestId('presence-banner-warning')).toHaveTextContent('Смотрит: Аня')
    expect(screen.queryByTestId('presence-force-edit')).not.toBeInTheDocument()
    expect(screen.getByTestId('verdict-form')).toBeInTheDocument()
  })
})
