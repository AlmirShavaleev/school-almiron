import { beforeEach,describe,it,expect,vi } from 'vitest'
import { fireEvent,render,screen,waitFor,within } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
const api=vi.hoisted(()=>({fetchFinance:vi.fn(),verifyFinancePayments:vi.fn()}))
vi.mock('@/lib/finance',async orig=>({...await orig<object>(),...api}))
vi.mock('recharts',()=>Object.fromEntries(['ResponsiveContainer','BarChart','Bar','LineChart','Line','XAxis','YAxis','CartesianGrid','Tooltip','Legend'].map(k=>[k,()=>null])))
import { FinancePage } from '../FinancePage'
const now=new Date().toISOString()
const snapshot=()=>({now,courses:[{id:'c1',title:'Физика'}],unknown_payments:0,refunds:[],enrollments:[],subscriptions:[],payments:[{id:'p1',student_id:'s1',subscription_id:'sub1',course_id:'c1',kind:'initial',status:'succeeded',amount_rub:500,is_test:true,paid_at:now,created_at:now,refunded_at:null,period_end:null,is_first:true}]})
const show=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><FinancePage/></MemoryRouter></QueryClientProvider>)
beforeEach(()=>{vi.clearAllMocks();api.verifyFinancePayments.mockResolvedValue(null);api.fetchFinance.mockResolvedValue(snapshot())})
describe('Финансы',()=>{
 it('сначала сверяет режимы, показывает реальную статистику без тестовых сумм',async()=>{
  show();await screen.findByText('В выбранном месяце и режиме успешных оплат пока нет. Графики показывают фактические данные, без демонстрационных значений.')
  expect(api.verifyFinancePayments).toHaveBeenCalledTimes(1)
  const card=screen.getByText('Поступления',{selector:'span'}).closest('section')!
  expect(within(card).getByText(/0\s*₽/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Тестовые'}))
  expect(await screen.findByText(/Тестовые платежи: эти суммы/)).toBeInTheDocument()
  expect(within(card).getByText(/500\s*₽/)).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'Поступления по месяцам'})).toBeInTheDocument()
 })
 it('неизвестные платежи видны предупреждением и можно повторить сверку',async()=>{
  api.fetchFinance.mockResolvedValue({...snapshot(),unknown_payments:3})
  show();await screen.findByText(/Непроверенных платежей: 3/)
  fireEvent.click(screen.getByRole('button',{name:'Обновить и сверить'}))
  await waitFor(()=>expect(api.verifyFinancePayments).toHaveBeenCalledTimes(2))
 })
 it('ошибка RPC не маскируется нулевыми поступлениями',async()=>{
  api.fetchFinance.mockRejectedValue(new Error('offline'));show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить статистику')
  expect(screen.queryByText('Активные платные ученики')).toBeNull()
 })
 it('фильтр месяца запрашивает другой период',async()=>{
  show();await screen.findByText('Активные платные ученики')
  fireEvent.change(screen.getByLabelText('Месяц'),{target:{value:'2025-12'}})
  await waitFor(()=>expect(api.fetchFinance).toHaveBeenCalledWith('2025-12'))
 })
})
