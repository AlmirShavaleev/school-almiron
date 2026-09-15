import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StaffModeSwitch } from '@/components/layout/StaffModeSwitch'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * §181. Кнопка «Телефон» рядом с тремя режимами: только admin/owner, включает
 * `mobilePreview`, режим не трогает; внутри вложенного окна не рисуется.
 */

/**
 * «Мы во вложенном окне» — настоящее условие `isInsideMobilePreview` без
 * подмены модуля: в jsdom `window.top` переопределяем, `window.name` — как его
 * ставит родитель через `<iframe name>`.
 */
function enterFrame() {
  Object.defineProperty(window, 'top', { value: {}, configurable: true, writable: true })
  window.name = 'mobile-preview'
}
function leaveFrame() {
  Object.defineProperty(window, 'top', { value: window, configurable: true, writable: true })
  window.name = ''
}

const OWNER_ID = 'owner-profile'

function setProfile(role: string, id = OWNER_ID) {
  useAuthStore.setState({
    profile: {
      id, email: 'owner@almiron.ru', full_name: 'Владелец', role,
      created_at: '2026-08-04T00:00:00.000Z', updated_at: '2026-08-04T00:00:00.000Z',
    },
    loading: false,
  } as any)
}

function renderAt(path = '/catalog') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaffModeSwitch />
    </MemoryRouter>,
  )
}

describe('Кнопка «Мобильный вид» в переключателе (§181)', () => {
  afterEach(() => leaveFrame())

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', mobilePreview: false, profileId: null, choiceMade: true })
  })

  it('admin и owner видят кнопку, преподаватель и ученик — нет', () => {
    setProfile('admin')
    const r1 = renderAt()
    expect(screen.getByTestId('staff-mode-mobile')).toHaveAttribute('title', 'Мобильный вид')
    r1.unmount()

    setProfile('owner')
    const r2 = renderAt()
    expect(screen.getByTestId('staff-mode-mobile')).toBeInTheDocument()
    r2.unmount()

    setProfile('teacher', 'teacher-profile')
    const r3 = renderAt()
    expect(screen.queryByTestId('staff-mode-mobile')).not.toBeInTheDocument()
    r3.unmount()

    setProfile('student', 'student-profile')
    renderAt()
    expect(screen.queryByTestId('staff-mode-mobile')).not.toBeInTheDocument()
  })

  it('нажатие включает mobilePreview, режим не меняется, повторное — выключает', () => {
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, 'teacher')
    renderAt()
    expect(screen.getByTestId('staff-mode-mobile')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByTestId('staff-mode-mobile'))

    expect(useStaffModeStore.getState().mobilePreview).toBe(true)
    expect(useStaffModeStore.getState().mode).toBe('teacher')
    expect(screen.getByTestId('staff-mode-mobile')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('staff-mode-teacher')).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(localStorage.getItem(`almiron:staff-mode:${OWNER_ID}`)!)).toEqual({ mode: 'teacher', mobilePreview: true })

    fireEvent.click(screen.getByTestId('staff-mode-mobile'))
    expect(useStaffModeStore.getState().mobilePreview).toBe(false)
    expect(useStaffModeStore.getState().mode).toBe('teacher')
  })

  it('«телефон» ортогонален режиму: смена режима его не сбрасывает', () => {
    setProfile('owner')
    renderAt()
    fireEvent.click(screen.getByTestId('staff-mode-mobile'))
    fireEvent.click(screen.getByTestId('staff-mode-student'))
    expect(useStaffModeStore.getState().mode).toBe('student')
    expect(useStaffModeStore.getState().mobilePreview).toBe(true)
  })

  it('внутри вложенного окна кнопки нет, режимы на месте', () => {
    enterFrame()
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, JSON.stringify({ mode: 'teacher', mobilePreview: true }))
    renderAt()
    expect(screen.getByTestId('staff-mode-teacher')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('staff-mode-mobile')).not.toBeInTheDocument()
  })
})
