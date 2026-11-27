import { useCallback, useEffect, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { useAuthStore } from '@/store/authStore'
import type { PlanCatalog, PlanInput, PlanItemInput, WorkPlanRead } from '@/lib/studentWorkPlan'

export const workPlansUnavailable = 'Планы работы пока не подключены к этой базе.'

async function readStaffPlanIndex(body: string, cancelled: () => boolean) {
  const args = JSON.parse(body)
  const first = await safeRpc('student_work_plan_read', args)
  const index = first.data as WorkPlanRead | null
  if (!index || first.error || !index.total_plans || index.plans.length >= index.total_plans) return first

  const plans = new Map(index.plans.map(plan => [plan.id, plan]))
  for (let offset = args.p_limit; offset < index.total_plans && !cancelled(); offset += args.p_limit) {
    const next = await safeRpc('student_work_plan_read', { ...args, p_offset: offset })
    if (next.error) return next
    const page = next.data as WorkPlanRead | null
    if (!page?.plans.length) break
    for (const plan of page.plans) plans.set(plan.id, plan)
  }
  return { data: { ...index, plans: [...plans.values()] }, error: null }
}

export function useWorkPlanRequest<T>(rpc: string, body: string | null, staffIndex = false) {
  const profileId = useAuthStore(state => state.profile?.id)
  const key = body ? JSON.stringify([rpc, profileId, body]) : null
  const [request, setRequest] = useState<{ key: string; data: T | null; error: string | null; unavailable: boolean } | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!body || !key) return
    let cancelled = false
    const result = staffIndex ? readStaffPlanIndex(body, () => cancelled) : safeRpc(rpc, JSON.parse(body))
    void result.then(({ data, error }) => {
      const unavailable = error?.code === 'PGRST202'
      if (!cancelled) setRequest({
        key, data: data as T | null, unavailable,
        error: unavailable ? workPlansUnavailable : error?.message ?? null,
      })
    })
    return () => { cancelled = true }
  }, [rpc, body, key, generation, staffIndex])
  const reload = useCallback(() => {
    setRequest(null)
    setGeneration(i => i + 1)
  }, [])
  const current = key && request?.key === key ? request : null
  return {
    data: current?.data ?? null, error: current?.error ?? null, unavailable: current?.unavailable ?? false,
    loading: !!body && !current, reload,
  }
}

type PlanView = 'home' | 'mine' | 'detail' | 'staff' | 'staff_detail'

export function useStudentWorkPlans(
  view: PlanView, planId?: string | null, studentId?: string | null, enabled = true,
) {
  return useWorkPlanRequest<WorkPlanRead>('student_work_plan_read', enabled ? JSON.stringify({
    p_view: view,
    ...(planId ? { p_plan_id: planId } : {}),
    ...(studentId ? { p_student_id: studentId } : {}),
    ...(view === 'staff' ? { p_limit: 250, p_offset: 0, p_sort: 'deadline' } : {}),
  }) : null, view === 'staff')
}

export function useWorkPlanCatalog(studentId: string | null, courseId: string) {
  return useWorkPlanRequest<PlanCatalog>('student_work_plan_catalog', studentId ? JSON.stringify({
    p_student_id: studentId,
    p_course_ids: courseId ? [courseId] : [],
  }) : null)
}

export async function saveStudentWorkPlan(
  plan: PlanInput, items: PlanItemInput[], requestId: string, revision?: number,
) {
  const { data, error } = await safeRpc('student_work_plan_save', {
    p_plan: plan, p_items: items, p_request_id: requestId, p_expected_revision: revision ?? null,
  })
  if (error) throw new Error(error.code === 'PGRST202' ? workPlansUnavailable : error.message)
  return data as { id: string; revision: number }
}
