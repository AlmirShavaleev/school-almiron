import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { StaffModeSwitch } from '@/components/layout/StaffModeSwitch'
import { StudentPreviewBanner } from '@/components/layout/StudentPreviewBanner'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * §178. Третий режим «Ученик» в переключателе шапки: виден только admin/owner,
 * включает предпросмотр, под шапкой — жёлтая полоса, «Вернуться» возвращает в
 * режим учителя. Проверяется поведение, а не текст исходника.
 */

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

function WhereAmI() {
  const location = useLocation()
  return <div data-testid="where">{location.pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaffModeSwitch />
      <StudentPreviewBanner />
      <Routes>
        <Route path="*" element={<WhereAmI />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Переключатель с режимом «Ученик» (§178)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
  })

  it('admin видит три режима: Администратор, Учитель, Ученик', () => {
    setProfile('admin')
    renderAt('/admin')
    expect(screen.getByTestId('staff-mode-admin')).toBeInTheDocument()
    expect(screen.getByTestId('staff-mode-teacher')).toBeInTheDocument()
    expect(screen.getByTestId('staff-mode-student')).toHaveTextContent('Ученик')
  })

  it('owner тоже видит три режима', () => {
    setProfile('owner')
    renderAt('/admin')
    expect(screen.getByTestId('staff-mode-student')).toBeInTheDocument()
  })

  it('преподаватель и ученик переключателя не видят вовсе', () => {
    setProfile('teacher', 'teacher-profile')
    const { unmount } = renderAt('/teacher')
    expect(screen.queryByTestId('staff-mode-switch')).not.toBeInTheDocument()
    unmount()

    setProfile('student', 'student-profile')
    renderAt('/student')
    expect(screen.queryByTestId('staff-mode-switch')).not.toBeInTheDocument()
  })

  it('«Ученик» включает предпросмотр: полоса появляется, с дашборда уводит на /dashboard', () => {
    setProfile('owner')
    renderAt('/admin')
    expect(screen.queryByTestId('student-preview-banner')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('staff-mode-student'))

    expect(useStaffModeStore.getState().mode).toBe('student')
    expect(screen.getByTestId('staff-mode-student')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('student-preview-banner')).toHaveTextContent('Предпросмотр глазами ученика')
    expect(screen.getByTestId('student-preview-banner')).toHaveTextContent('ответы и отметки не сохраняются')
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
    // Тем же ключом, что и прежние два режима.
    expect(localStorage.getItem(`almiron:staff-mode:${OWNER_ID}`)).toBe('student')
  })

  it('посреди работы (не на дашборде) переключение не выбрасывает со страницы', () => {
    setProfile('owner')
    renderAt('/catalog')
    fireEvent.click(screen.getByTestId('staff-mode-student'))
    expect(screen.getByTestId('where')).toHaveTextContent('/catalog')
    expect(screen.getByTestId('student-preview-banner')).toBeInTheDocument()
  })

  it('«Вернуться» на полосе возвращает в режим учителя и уводит на /dashboard', () => {
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, 'student')
    renderAt('/my-course/g1')
    expect(screen.getByTestId('student-preview-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('student-preview-exit'))

    expect(useStaffModeStore.getState().mode).toBe('teacher')
    expect(screen.queryByTestId('student-preview-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-mode-teacher')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard')
  })

  it('у настоящего ученика полосы нет, даже если в хранилище лежит student', () => {
    setProfile('student', 'student-profile')
    localStorage.setItem('almiron:staff-mode:student-profile', 'student')
    renderAt('/my-course')
    expect(screen.queryByTestId('student-preview-banner')).not.toBeInTheDocument()
  })
})
