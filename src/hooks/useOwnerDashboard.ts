import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface OwnerDashboardData {
  studentCount: number
  groupCount: number
  archivedGroupCount: number
  totalRevenue: number
  overdueAmount: number
  payments: any[]
  groups: any[]
  teachers: any[]
  courses: any[]
  loading: boolean
}

export function useOwnerDashboard(): OwnerDashboardData {
  const [data, setData] = useState<OwnerDashboardData>({
    studentCount: 0,
    groupCount: 0,
    archivedGroupCount: 0,
    totalRevenue: 0,
    overdueAmount: 0,
    payments: [],
    groups: [],
    teachers: [],
    courses: [],
    loading: true,
  })

  useEffect(() => {
    async function load() {
      const [studentsRes, groupsRes, paymentsRes, teachersRes, coursesRes] = await Promise.all([
        supabase.from('students').select('id', { count: 'exact', head: true }),
        supabase.from('groups').select('*, is_active, group_students(count), courses(title, subject), teachers(profiles(full_name))').order('name'),
        supabase.from('payments').select('*').order('due_date', { ascending: false }),
        supabase.from('teachers').select('*, profiles(full_name)'),
        supabase.from('courses').select('*'),
      ])

      const payments = paymentsRes.data || []
      const totalRevenue = payments.filter(p => p.status === 'paid').reduce((s: number, p: any) => s + p.amount, 0)
      const overdueAmount = payments.filter(p => p.status === 'overdue').reduce((s: number, p: any) => s + p.amount, 0)

      const groupsWithCount = (groupsRes.data || []).map((g: any) => ({
        ...g,
        student_count: g.group_students?.[0]?.count || 0,
      }))

      setData({
        studentCount: studentsRes.count || 0,
        groupCount: groupsWithCount.filter((g: any) => g.is_active !== false).length,
        archivedGroupCount: groupsWithCount.filter((g: any) => g.is_active === false).length,
        totalRevenue,
        overdueAmount,
        payments,
        groups: groupsWithCount,
        teachers: teachersRes.data || [],
        courses: coursesRes.data || [],
        loading: false,
      })
    }

    load()
  }, [])

  return data
}
