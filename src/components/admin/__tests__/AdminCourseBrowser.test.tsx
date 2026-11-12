import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AdminCourseBrowser } from '../AdminCourseBrowser'
import type { AdminCourse } from '@/hooks/useAdminDashboard'
const course = (id: string, title: string, is_active = true): AdminCourse => ({ id, title, is_active, subject: 'physics', exam_type: 'ege', duration_weeks: null, price: null, description: null, start_date: null, end_date: null, enrollment_open_until: null })
const rows = [course('a', 'Физика 11А'), course('b', 'Физика 10Б'), course('c', 'Физика 2025', false)]
function setup() { return render(<AdminCourseBrowser courses={rows} renderCourse={c => <button>Изменить {c.title}</button>} />) }
describe('каталог админки', () => {
 it('сворачивает группы и сохраняет управление курсами внутри', () => { const { container } = setup(); expect(container.querySelector('details')).not.toHaveAttribute('open'); const row = screen.getByText('Физика 11А').closest('details')!; expect(row).not.toHaveAttribute('open'); fireEvent.click(screen.getByText('Физика 11А')); expect(screen.getByText('Изменить Физика 11А')).toBeInTheDocument() })
 it('находит курс без ручного раскрытия и показывает архив по фильтру', () => { const { container } = setup(); fireEvent.change(screen.getByRole('searchbox'), {target:{value:'  10б  '}}); expect(screen.queryByText('Физика 11А')).not.toBeInTheDocument(); expect(screen.getByText('Физика 10Б')).toBeInTheDocument(); expect(container.querySelector('details')).toHaveAttribute('open'); fireEvent.change(screen.getByRole('searchbox'),{target:{value:''}}); fireEvent.change(screen.getByLabelText('Статус курсов'),{target:{value:'archived'}}); expect(screen.getByText('Физика 2025')).toBeInTheDocument(); expect(screen.queryByText('Физика 11А')).not.toBeInTheDocument() })
 it('объясняет пустой результат, не удаляя данные', () => { setup(); fireEvent.change(screen.getByRole('searchbox'),{target:{value:'несуществующий'}}); expect(screen.getByText(/Курсы не найдены/)).toBeInTheDocument(); fireEvent.change(screen.getByRole('searchbox'),{target:{value:''}}); expect(screen.getByText('Физика 11А')).toBeInTheDocument() })
})
