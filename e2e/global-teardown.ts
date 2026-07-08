import fs from 'fs'
import { PDF_FIXTURES_FILE, type PdfFixtures } from './global-setup'
import { deleteFixtures } from './pdf-fixtures'

/**
 * Runs once after the whole Playwright run, regardless of whether any test
 * passed or failed (Playwright always invokes globalTeardown once
 * globalSetup has succeeded) — so [E2E] fixture collections never linger as
 * permanent user data even if e2e/pdf-export.spec.ts fails mid-run.
 */
export default async function globalTeardown() {
  if (!fs.existsSync(PDF_FIXTURES_FILE)) {
    console.log('[global-teardown] no PDF fixtures file — nothing to clean up')
    return
  }

  const fixtures: PdfFixtures = JSON.parse(fs.readFileSync(PDF_FIXTURES_FILE, 'utf8'))
  const ids = Object.values(fixtures)

  console.log('[global-teardown] deleting PDF E2E fixtures:', ids)
  await deleteFixtures(ids)

  fs.rmSync(PDF_FIXTURES_FILE, { force: true })
}
