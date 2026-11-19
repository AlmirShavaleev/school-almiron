import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopicAutocheckStudent } from '@/components/courseProgram/TopicAutocheckStudent'
import { parseAutocheckState } from '@/lib/autocheck'
vi.mock('@/lib/katexLoader',()=>({upgradeMathIn:vi.fn()}))
vi.mock('@/lib/catalogContent',()=>({renderCatalogContent:(s:string)=>s}))
const raw={topic_id:'topic',is_staff:false,solutions_after_finish:true,total:2,solved:1,closed:1,finished:false,grade:null,tasks:[
  {id:'task1',code:'D1',position:1,statement_md:'Первая задача',answer_type:'number',closed:true,solved:true,attempts_used:1,attempts_left:2,answers:[],solution_md:null,answer_value:null},
  {id:'task2',code:'D2',position:2,statement_md:'Вторая задача',answer_type:'number',closed:false,solved:false,attempts_used:0,attempts_left:3,answers:[],solution_md:null,answer_value:null},
]}
describe('решения после всего ДЗ',()=>{
  it('объясняет задержку и не показывает решение до окончания',()=>{
    render(<TopicAutocheckStudent state={parseAutocheckState(raw)!} onCheck={vi.fn()} />)
    expect(screen.getByText(/после завершения всех задач ДЗ/)).toBeInTheDocument()
    expect(screen.queryByTestId('autocheck-solution')).toBeNull()
  })
  it('показывает решения после завершения всех задач',()=>{
    const state=parseAutocheckState({...raw,finished:true,closed:2,tasks:raw.tasks.map(t=>({...t,closed:true,solution_md:'Решение после всего ДЗ',answer_value:42}))})!
    render(<TopicAutocheckStudent state={state} onCheck={vi.fn()} />)
    expect(screen.getByTestId('autocheck-solution')).toHaveTextContent('Решение после всего ДЗ')
  })
})
