import { describe, expect, it } from 'vitest'
import { getMaterialFileExtension } from '@/lib/materialIcons'

describe('topic link helpers', () => {
  it('extracts file extension from storage paths and signed urls', () => {
    expect(getMaterialFileExtension('topics/a/tasks/12345.pdf')).toBe('pdf')
    expect(getMaterialFileExtension('topics/a/tasks/file.PPTX?token=abc')).toBe('pptx')
    expect(getMaterialFileExtension(null)).toBe('')
  })
})
