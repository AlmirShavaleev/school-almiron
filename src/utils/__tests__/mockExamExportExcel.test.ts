import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { exportMockExamTable } from '@/utils/exportExcel'

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn<(workbook: XLSX.WorkBook, name: string) => void>() }))
vi.mock('xlsx', async original => ({ ...await original<typeof XLSX>(), writeFile }))

describe('Excel одного пробника', () => {
  it('записывает читаемый xlsx с числами, пустыми ячейками и фильтром только по ученикам', () => {
    exportMockExamTable({ title: 'Физика / №1', date: '2026-11-26' }, {
      columns: [{ label: 'Ученик', width: 34 }, { label: '№1', width: 8 }, { label: '№2', width: 8 }],
      rows: [['=Тестовый ученик', 0, null], ['Другой ученик', null, 2]],
      footer: [['Набрано по номеру, %', { t: 'n', v: 0, z: '0%' }, { t: 'n', v: 1, z: '0%' }]],
    })
    const [workbook, name] = writeFile.mock.calls[0]
    expect(name).toBe('Результаты — Физика _ №1 — 2026-11-26.xlsx')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const roundTrip = XLSX.read(bytes, { type: 'array', cellNF: true })
    expect(roundTrip.SheetNames).toEqual(['Результаты'])
    const sheet = roundTrip.Sheets['Результаты']
    expect(sheet.A2).toMatchObject({ t: 's', v: '=Тестовый ученик' })
    expect(sheet.A2.f).toBeUndefined()
    expect(sheet.B2).toMatchObject({ t: 'n', v: 0 })
    expect(sheet.C2).toBeUndefined()
    expect(sheet.C3).toMatchObject({ t: 'n', v: 2 })
    expect(sheet['!autofilter']).toEqual({ ref: 'A1:C3' })
    expect(sheet.C5).toMatchObject({ t: 'n', v: 1, z: '0%' })
  })
})
