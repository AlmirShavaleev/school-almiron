import { beforeEach, describe, expect, it, vi } from 'vitest'
const from = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { from } }))
import { loadCourseExtras } from '../courseMeta'
const A='00000000-0000-0000-0000-000000000001', B='00000000-0000-0000-0000-000000000002'
beforeEach(() => from.mockReset())
describe('course metadata UUID filters', () => {
  it('does not send empty or invalid lists to PostgREST', async () => {
    for (const ids of [[],['undefined','null','','c1']]) {
      const r=await loadCourseExtras(ids)
      expect(r.showcase.size).toBe(0)
      expect(r.progressMode.size).toBe(0)
    }
    expect(from).not.toHaveBeenCalled()
  })
  it('keeps valid IDs, removes duplicates and preserves the returned metadata', async () => {
    const inCalls:unknown[]=[]
    from.mockImplementation((table:string) => {
      const q:any={ select:()=>q, in:(_key:string,ids:string[])=>{inCalls.push(ids);return q},eq:()=>q,
        then:(resolve:any)=>Promise.resolve({data:table==='course_showcase'?[{course_id:A,title:'Course'}]:[{course_id:B,mode:'progress'}],error:null}).then(resolve)}
      return q
    })
    const r=await loadCourseExtras([A,'undefined',A,B])
    expect(inCalls).toEqual([[A,B],[A,B]])
    expect(r.showcase.get(A)).toBe('Course')
    expect([...r.progressMode]).toEqual([B])
  })
})

