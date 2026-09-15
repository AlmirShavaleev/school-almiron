import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/store/authStore'
import { MOBILE_PREVIEW_SYNC_MS, useStaffModeStore } from '@/store/staffModeStore'

/**
 * §181. «Мобильный вид» в `DashboardLayout`: при включённом переключателе
 * вместо сайдбара, шапки и страницы — iframe 390×844 с тем же приложением на
 * текущем адресе; «Выйти» возвращает обычное дерево туда, куда человек дошёл
 * внутри «телефона»; внутри вложенного окна iframe не создаётся никогда.
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

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/hooks/useSidebarBadges', () => ({
  useSidebarBadges: () => ({}),
}))

vi.mock('@/components/demo/ImpersonationBanner', () => ({
  ImpersonationBanner: () => null,
}))

vi.mock('@/components/shared/SupportWidget', () => ({
  SupportWidget: () => null,
}))

vi.mock('@/components/shared/TelegramOnboarding', () => ({
  TelegramOnboarding: () => null,
}))

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

function WhereAmI({ label }: { label: string }) {
  const location = useLocation()
  return <div data-testid="where">{label}:{location.pathname}{location.search}{location.hash}</div>
}

function renderLayout(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/course-program/:id" element={<WhereAmI label="program" />} />
          <Route path="/groups" element={<WhereAmI label="groups" />} />
          <Route path="/my-course/:id" element={<WhereAmI label="course" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const frame = () => document.querySelector('iframe[title="Мобильный вид"]') as HTMLIFrameElement | null

describe('DashboardLayout в мобильном виде (§181)', () => {
  beforeEach(() => {
    leaveFrame()
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', mobilePreview: false, profileId: null, choiceMade: true })
    sessionStorage.setItem(`almiron:staff-mode-chosen:${OWNER_ID}`, '1')
  })

  afterEach(() => {
    vi.useRealTimers()
    leaveFrame()
  })

  it('включён: iframe с текущим адресом и mobile-preview=1, без сайдбара, шапки и страницы', () => {
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, JSON.stringify({ mode: 'teacher', mobilePreview: true }))
    renderLayout('/course-program/c1?tab=materials#top')

    const iframe = frame()
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('src')).toBe('/course-program/c1?tab=materials&mobile-preview=1#top')
    expect(iframe!.getAttribute('width')).toBe('390')
    expect(iframe!.getAttribute('height')).toBe('844')
    expect(iframe!.getAttribute('name')).toBe('mobile-preview')

    expect(screen.getByTestId('mobile-preview-bar')).toHaveTextContent('Мобильный вид')
    expect(screen.getByTestId('mobile-preview-bar')).toHaveTextContent('390×844')
    expect(screen.getByTestId('mobile-preview-exit')).toBeInTheDocument()

    // Обычного дерева нет: ни бургера шапки, ни переключателя, ни навигации, ни страницы.
    expect(screen.queryByLabelText('Открыть меню')).not.toBeInTheDocument()
    expect(screen.queryByTestId('staff-mode-switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('where')).not.toBeInTheDocument()
  })

  it('«Выйти» выключает и возвращает обычное дерево на том же адресе', () => {
    setProfile('admin')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, JSON.stringify({ mode: 'admin', mobilePreview: true }))
    renderLayout('/course-program/c1?tab=materials')
    expect(frame()).not.toBeNull()

    fireEvent.click(screen.getByTestId('mobile-preview-exit'))

    expect(useStaffModeStore.getState().mobilePreview).toBe(false)
    expect(useStaffModeStore.getState().mode).toBe('admin')
    expect(frame()).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('program:/course-program/c1?tab=materials')
    expect(screen.getByTestId('staff-mode-switch')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(`almiron:staff-mode:${OWNER_ID}`)!)).toEqual({ mode: 'admin', mobilePreview: false })
  })

  it('переход внутри «телефона» подтягивает внешний адрес, «Выйти» ведёт туда же', () => {
    vi.useFakeTimers()
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, JSON.stringify({ mode: 'admin', mobilePreview: true }))
    renderLayout('/course-program/c1')
    const iframe = frame()!

    // Внутри вложенного окна человек дошёл до групп (параметр там уже потерян —
    // так делает React Router внутри).
    act(() => { iframe.contentWindow!.history.replaceState(null, '', '/groups?q=10') })
    act(() => { vi.advanceTimersByTime(MOBILE_PREVIEW_SYNC_MS + 50) })

    // Телефон не перезагружен: src тот же, что при включении.
    expect(frame()).toBe(iframe)
    expect(iframe.getAttribute('src')).toBe('/course-program/c1?mobile-preview=1')

    fireEvent.click(screen.getByTestId('mobile-preview-exit'))
    expect(frame()).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('groups:/groups?q=10')
  })

  it('внутри вложенного окна iframe не создаётся, что бы ни лежало в сторе и хранилище', () => {
    enterFrame()
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, JSON.stringify({ mode: 'student', mobilePreview: true }))
    useStaffModeStore.setState({ mode: 'student', mobilePreview: true, profileId: OWNER_ID, choiceMade: true })
    renderLayout('/my-course/g1')

    expect(frame()).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('course:/my-course/g1')
    expect(screen.getByLabelText('Открыть меню')).toBeInTheDocument()
    expect(screen.queryByTestId('staff-mode-mobile')).not.toBeInTheDocument()
    // Режим роли внутри тот же — «Ученик + телефон»: жёлтая полоса на месте.
    expect(screen.getByTestId('student-preview-banner')).toBeInTheDocument()
  })

  it('у преподавателя iframe нет даже с «телефоном» в хранилище', () => {
    setProfile('teacher', 'teacher-profile')
    localStorage.setItem('almiron:staff-mode:teacher-profile', JSON.stringify({ mode: 'admin', mobilePreview: true }))
    renderLayout('/groups')
    expect(frame()).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('groups:/groups')
  })

  it('старое строковое значение в хранилище читается как режим, без ошибок и без iframe', () => {
    setProfile('owner')
    localStorage.setItem(`almiron:staff-mode:${OWNER_ID}`, 'teacher')
    renderLayout('/groups')
    expect(frame()).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('groups:/groups')
    expect(screen.getByTestId('staff-mode-teacher')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('staff-mode-mobile')).toHaveAttribute('aria-pressed', 'false')
  })
})
