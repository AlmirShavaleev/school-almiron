import { fireEvent,render,screen,within } from '@testing-library/react'
import { describe,it,expect,vi } from 'vitest'
vi.mock('@/lib/supabase',()=>({supabase:{}}))
vi.mock('recharts',()=>Object.fromEntries(['ResponsiveContainer','AreaChart','Area','XAxis','YAxis','Tooltip'].map(k=>[k,()=>null])))
vi.mock('framer-motion',()=>({useReducedMotion:()=>true,motion:{div:({children}: {children?:React.ReactNode})=><div>{children}</div>,span:({children,className}: {children?:React.ReactNode;className?:string})=><span className={className}>{children}</span>}}))
import { FinanceCharts } from '../FinanceCharts'
import { financeReport,monthLabel } from '@/lib/finance'
function fixture(){
 const r=financeReport({now:'2026-11-12T10:00:00Z',courses:[],unknown_payments:0,payments:[],refunds:[],subscriptions:[],enrollments:[]},'2026-11','','real')
 r.monthly=r.monthly.map((p,i)=>({...p,newRevenue:(i+1)*100,renewRevenue:50,newCount:i+1,renewCount:1}))
 r.daily=Array.from({length:30},(_,i)=>({day:i+1,amount:i<12?100:null}));r.gross=1200;r.previous=1000
 return r
}
describe('графики финансов в стиле stat card',()=>{
 it('переключает 3/6/12 месяцев и считает сумму фактических точек',()=>{
  render(<FinanceCharts report={fixture()} month="2026-11"/>);
  const chart=screen.getByRole('region',{name:'Поступления по месяцам'})
  expect(within(chart).getByRole('status')).toHaveTextContent(/6\s*000\s*₽/)
  fireEvent.click(within(chart).getByRole('button',{name:'3 месяца'}))
  expect(within(chart).getByRole('status')).toHaveTextContent(/3\s*450\s*₽/)
  expect(within(chart).getByRole('button',{name:'3 месяца'})).toHaveAttribute('aria-pressed','true')
  fireEvent.click(within(chart).getByRole('button',{name:'Год'}))
  expect(within(chart).getByRole('status')).toHaveTextContent(/8\s*400\s*₽/)
  expect(within(chart).getByText('—')).toBeInTheDocument()
 })
 it('неделя — последние 7 доступных дней, без будущих точек и выдуманного сравнения',()=>{
  render(<FinanceCharts report={fixture()} month="2026-11"/>);
  const chart=screen.getByRole('region',{name:'Поступления по дням'})
  expect(within(chart).getByRole('status')).toHaveTextContent(/1\s*200\s*₽/)
  fireEvent.click(within(chart).getByRole('button',{name:'Неделя'}))
  expect(within(chart).getByRole('status')).toHaveTextContent(/700\s*₽/)
  expect(within(chart).getByText(`6–12 · ${monthLabel('2026-11')}`)).toBeInTheDocument()
  expect(within(chart).getByText('—')).toBeInTheDocument()
 })
 it('ноль остаётся нулём и не заменяется демоданными',()=>{
  const r=fixture();r.monthly=r.monthly.map(p=>({...p,newRevenue:0,renewRevenue:0}))
  render(<FinanceCharts report={r} month="2026-11"/>);
  const chart=screen.getByRole('region',{name:'Поступления по месяцам'})
  expect(within(chart).getByRole('status')).toHaveTextContent(/0\s*₽/)
  expect(within(chart).getByText(/нет оплат/)).toBeInTheDocument()
 })
})
