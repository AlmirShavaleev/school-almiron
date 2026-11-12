import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../MySubscriptionPage',()=>({MySubscriptionPage:()=> <div data-testid="payments-content">Платежи ученика</div>}))
vi.mock('../CoursesPage',()=>({CoursesPage:()=> <div data-testid="storefront-content">Другие курсы</div>}))
import { SubscriptionHubPage } from '../SubscriptionHubPage'
it('оплата показывает платежи, а не витрину',()=>{
 render(<MemoryRouter initialEntries={['/my-subscription']}><SubscriptionHubPage tab="payments"/></MemoryRouter>)
 expect(screen.getByTestId('payments-content')).toBeInTheDocument()
 expect(screen.queryByTestId('storefront-content')).toBeNull()
 expect(screen.getByRole('link',{name:'Оплата'})).toHaveAttribute('aria-current','page')
})
it('витрина показывает другие курсы, а не платежи',()=>{
 render(<MemoryRouter initialEntries={['/courses?subject=physics']}><SubscriptionHubPage tab="courses"/></MemoryRouter>)
 expect(screen.getByTestId('storefront-content')).toBeInTheDocument()
 expect(screen.queryByTestId('payments-content')).toBeNull()
 expect(screen.getByRole('link',{name:'Оплата'})).toHaveAttribute('href','/my-subscription?subject=physics')
 expect(screen.getByRole('link',{name:'Мои курсы →'})).toHaveAttribute('href','/my-course')
})
