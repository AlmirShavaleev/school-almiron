import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(
  path.resolve(__dirname, '../StudentManager.tsx'),
  'utf-8',
)

describe('StudentManager labels', () => {
  it('does not expose the word Legacy in the add-student UI', () => {
    expect(SRC).not.toContain('Legacy-поиск')
    expect(SRC).toContain('Добавить зарегистрированного ученика')
  })
})
