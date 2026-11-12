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

it('показывает имя, сумму и тип оплаты; поиск скрывает других учеников',async()=>{
 const data={...snapshot(),subscriptions:[{id:'sub1',student_id:'s1',course_id:'c1',status:'active',access_until:null,auto_renew:false,source:'purchase',full_name:'Иван Петров',email:'ivan@example.ru',is_test:true},{id:'sub2',student_id:'s2',course_id:'c1',status:'active',access_until:null,auto_renew:false,source:'purchase',full_name:'Анна Иванова',email:'anna@example.ru',is_test:true}]}
 data.payments.push({...data.payments[0],id:'p2',student_id:'s2',subscription_id:'sub2',amount_rub:1500,is_first:false})
 api.fetchFinance.mockResolvedValue(data);show();await screen.findByText('Кто оплатил')
 fireEvent.click(screen.getByRole('button',{name:'Тестовые'}))
 const table=screen.getByRole('table',{name:'Успешные оплаты учеников'})
 expect(within(table).getByText('Иван Петров')).toBeInTheDocument()
 expect(within(table).getByText(/^500\s*₽$/)).toBeInTheDocument()
 expect(within(table).getByText(/1\s*500\s*₽/)).toBeInTheDocument()
 expect(within(table).getByText('Продление вручную')).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Найти ученика'),{target:{value:'ivan@example'}})
 expect(within(table).queryByText('Анна Иванова')).toBeNull()
 expect(within(table).getByText('Иван Петров')).toBeInTheDocument()
})
