/**
 * Billing business-logic unit tests.
 * These tests cover the client-side interpretation of billing trigger outcomes.
 * DB-level E2E SQL tests are in the migration: fix_billing_atomicity_and_security.
 */
import { describe, it, expect } from 'vitest'

// ── Helpers that mirror what the billing trigger produces ────────────────────

/** Parses billing error messages returned by the Supabase RPC trigger. */
function parseBillingError(message: string): {
  code: 'no_student' | 'no_rate' | 'transition_denied' | 'unknown'
  detail: string
} {
  if (message.includes('billing_error') && message.includes('students не найдена')) {
    return { code: 'no_student', detail: message }
  }
  if (message.includes('billing_error') && message.includes('ставк')) {
    return { code: 'no_rate', detail: message }
  }
  if (message.includes('transition_denied')) {
    return { code: 'transition_denied', detail: message }
  }
  return { code: 'unknown', detail: message }
}

/** Returns true when a lesson UPDATE error should block completion and show a toast. */
function isBillingBlocker(errorMessage: string): boolean {
  return (
    errorMessage.includes('billing_error') ||
    errorMessage.includes('transition_denied')
  )
}

/**
 * Simulates the financial invariant check:
 * sum(balance_changes) must equal sum(lesson_charge amounts).
 */
function checkFinancialInvariant(params: {
  balanceBefore: number
  balanceAfter: number
  chargeAmount: number  // negative value, e.g. -1750
}): boolean {
  const balanceDelta = params.balanceAfter - params.balanceBefore
  return Math.abs(balanceDelta - params.chargeAmount) < 0.001
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseBillingError', () => {
  it('detects no_student error', () => {
    const err = parseBillingError(
      'billing_error: запись students не найдена для профиля abc-123'
    )
    expect(err.code).toBe('no_student')
  })

  it('detects no_rate error (individual)', () => {
    const err = parseBillingError(
      'billing_error: для ученика «Артём Орлов» не назначена ставка. Назначьте ставку в lesson_rates перед завершением занятия.'
    )
    expect(err.code).toBe('no_rate')
  })

  it('detects no_rate error (group)', () => {
    const err = parseBillingError(
      'billing_error: ученики без ставки — Артём Орлов. Назначьте ставки всем участникам группы перед завершением занятия.'
    )
    expect(err.code).toBe('no_rate')
  })

  it('detects transition_denied: completed→scheduled', () => {
    const err = parseBillingError(
      'transition_denied: нельзя вернуть завершённое занятие в статус «scheduled»'
    )
    expect(err.code).toBe('transition_denied')
  })

  it('detects transition_denied: cancelled→completed', () => {
    const err = parseBillingError(
      'transition_denied: нельзя завершить отменённое занятие'
    )
    expect(err.code).toBe('transition_denied')
  })

  it('returns unknown for unrelated errors', () => {
    const err = parseBillingError('network timeout')
    expect(err.code).toBe('unknown')
  })
})

describe('isBillingBlocker', () => {
  it('blocks on billing_error', () => {
    expect(isBillingBlocker('billing_error: ставка не назначена')).toBe(true)
  })

  it('blocks on transition_denied', () => {
    expect(isBillingBlocker('transition_denied: нельзя')).toBe(true)
  })

  it('does not block on unrelated error', () => {
    expect(isBillingBlocker('network error')).toBe(false)
  })
})

describe('checkFinancialInvariant — individual charge', () => {
  it('passes when balance decreases exactly by rate', () => {
    expect(checkFinancialInvariant({
      balanceBefore: 3500,
      balanceAfter: 1750,
      chargeAmount: -1750,
    })).toBe(true)
  })

  it('fails on phantom deduction (balance changed, no tx)', () => {
    // Simulates the old bug: balance went down but no transaction was created
    // In that case chargeAmount would be 0 (no tx inserted) but balance still dropped
    expect(checkFinancialInvariant({
      balanceBefore: 3500,
      balanceAfter: 1750,
      chargeAmount: 0,   // no tx was actually inserted
    })).toBe(false)
  })

  it('passes when repeat completion is a true no-op', () => {
    expect(checkFinancialInvariant({
      balanceBefore: 1750,
      balanceAfter: 1750,
      chargeAmount: 0,   // unique index blocked tx, balance unchanged
    })).toBe(true)
  })
})

describe('checkFinancialInvariant — group charge', () => {
  it('passes when both students charged correctly', () => {
    // alex: 3500 → 1750 (charge -1750)
    expect(checkFinancialInvariant({ balanceBefore: 3500, balanceAfter: 1750, chargeAmount: -1750 })).toBe(true)
    // anna: 1500 → 0 (charge -1500)
    expect(checkFinancialInvariant({ balanceBefore: 1500, balanceAfter: 0, chargeAmount: -1500 })).toBe(true)
  })

  it('fails when partial deduction happened (atomicity broken)', () => {
    // alex was charged but artem was not → group charge was partial
    // From alex perspective: balance changed but group tx total doesn't match
    expect(checkFinancialInvariant({
      balanceBefore: 3500,
      balanceAfter: 1750,
      chargeAmount: 0,   // Artem's missing rate blocked tx for Artem, but alex was already charged
    })).toBe(false)
  })
})
