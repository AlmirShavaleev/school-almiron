import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/tutoring/api',async original=>({...await original<object>(),tutoringRpc:rpc}))
vi.mock('@/store/authStore',()=>({useAuthStore:(select:(s:unknown)=>unknown)=>select({profile:{id:'demo',email:'student@example.ru',role:'student'}})}))
import { TutoringPage } from '../TutoringPage'
it('предпросмотр: выбор даты, времени и подтверждение без сети и оплаты',async()=>{
 render(<MemoryRouter><TutoringPage demo/></MemoryRouter>)
 fireEvent.click(await screen.findByRole('button',{name:'15:00'}))
 fireEvent.change(screen.getByRole('textbox',{name:'Что хотите разобрать?'}),{target:{value:'Не понимаю второй закон Ньютона'}})
 fireEvent.click(screen.getByRole('checkbox'))
 fireEvent.click(screen.getByRole('button',{name:/Посмотреть подтверждение/}))
 expect(await screen.findByText('Запись подтверждена')).toBeInTheDocument()
 expect(rpc).not.toHaveBeenCalled()
})
