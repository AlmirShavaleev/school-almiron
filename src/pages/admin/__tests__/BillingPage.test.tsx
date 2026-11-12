import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
vi.mock('../FinancePage', () => ({ FinancePage: ({embedded}: {embedded: boolean}) => <div data-testid="overview" data-embedded={embedded}>Финансовая сводка</div> }))
vi.mock('../SubscriptionsAdminPage', () => ({ SubscriptionAdminPanel: ({tab, search}: {tab: string; search: string}) => <div data-testid="panel" data-tab={tab}>{search}</div> }))
import { BillingPage } from '../BillingPage'
function Location() { const l=useLocation(), n=useNavigate(); return <><output data-testid="url">{l.search}</output><button onClick={()=>n(-1)}>Назад</button></> }
function show(url='/admin/finance') { render(<MemoryRouter initialEntries={[url]}><BillingPage/><Location/></MemoryRouter>) }
describe('единый финансовый раздел', () => {
 it('открывает обзор с одним заголовком и монтирует только выбранную панель', () => { show(); expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1); expect(screen.getByTestId('overview')).toHaveAttribute('data-embedded','true'); expect(screen.queryByTestId('panel')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button',{name:'Подписчики'})); expect(screen.queryByTestId('overview')).not.toBeInTheDocument(); expect(screen.getByTestId('panel')).toHaveAttribute('data-tab','subs'); fireEvent.click(screen.getByRole('button',{name:'Назад'})); expect(screen.getByTestId('overview')).toBeInTheDocument() })
 it('прямая ссылка открывает нужного подписчика, настройки объединяют служебные экраны', () => { show('/admin/finance?tab=subs&search=ivan%40example.ru'); expect(screen.getByTestId('panel')).toHaveTextContent('ivan@example.ru'); fireEvent.click(screen.getByRole('button',{name:'Настройки'})); fireEvent.click(screen.getByRole('button',{name:'Промокоды'})); expect(screen.getByTestId('panel')).toHaveAttribute('data-tab','promo'); expect(screen.getByRole('button',{name:'Настройки'})).toHaveAttribute('aria-pressed','true'); expect(screen.getByTestId('url')).not.toHaveTextContent('search=') })
 it('неизвестная вкладка безопасно открывает обзор', () => { show('/admin/finance?tab=missing'); expect(screen.getByTestId('overview')).toBeInTheDocument() })
})
