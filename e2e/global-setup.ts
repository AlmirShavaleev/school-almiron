import { chromium, type FullConfig } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { createFixture } from './pdf-fixtures'

export const AUTH_FILE          = path.resolve('test-results/auth.json')
export const PDF_FIXTURES_FILE  = path.resolve('test-results/pdf-fixtures.json')

// Mixed math+physics task ids (some with answers, some with <img> in the
// statement) — used to build disposable [E2E] fixture collections for
// e2e/pdf-export.spec.ts. Not hardcoded collection UUIDs: these are catalog
// task ids, stable published content, and a fresh collection is created from
// them on every run then deleted in global-teardown.ts.
const MIXED_TASK_IDS = [
  '1ea1be3e-b88c-46e5-8261-29a28184e5f8', 'e8fa0a18-0a48-4e41-866a-be80b3756760',
  '59d7f042-0100-495c-a58a-9c2a8d727ba0', 'fa6e179b-e648-43a3-877f-c9abcf3d3a75',
  '8d2d5219-66c6-4b86-9a38-577db58caa8b', 'f2b733cd-b2e4-4ada-9c34-18911e0678f8',
  '44b235a9-fbac-45c9-b5b8-d0cc11e2473c', '592a9a7d-5f90-47e8-9eb9-4fde5f7889bb',
  'ac12bbe8-fe7c-4e4b-a791-699a9229e977', 'c29761b0-5817-4fee-b9f8-878ca048ebaf',
  '56e33327-3c38-4d25-ae24-fb5c3aedff92', 'b6ece4bc-374d-4fb8-9aac-b88e1954a0f3',
  'd1cae17c-b21d-473c-ba6a-9347d3b424fd', '8f7c3a7e-a24f-4ed7-85cc-a7be8cb4d508',
  '0b1c5617-a9b4-4e53-8399-70ca9a5ac9a9', 'd2ebb671-ee70-40fa-9da1-7133603c1e38',
  '2b815402-f52a-491c-b65f-6e0cef1a11d8', '9c0b1d99-6456-4bc8-a71a-237cc5adf33d',
  'cd38217d-23f4-44f4-8991-d7ba8f5c2c89', '56c78cb6-2bae-4ee7-bf9c-e90627f8f0b2',
  '29a65a10-6481-4966-814f-b13e1a11570b', '93ebcb4b-3eee-412c-ab16-858de4b1a40b',
  '77be665f-4af1-4d91-b330-538316b692e7', '961c33b9-8ddf-45a7-a939-362916bdd1d5',
  '88423911-99a8-480d-bbd6-fa8d6a1a7e25', '71809585-b092-41c7-9e22-cd388c05b562',
  'd974ab76-abc3-4b89-bdc1-57061e2391b0', '2e5207c2-27d3-441e-8ab6-d30d2f986975',
  'c2812823-f2c2-40a7-afba-db7003f91482', 'd88105f5-eddc-41b1-95c9-ba7da25ae513',
]

export interface PdfFixtures {
  collection1:  string
  collection15: string
  collection30: string
}

async function createPdfFixtures(): Promise<PdfFixtures> {
  const runTag = Date.now().toString(36)

  const [c1, c15, c30] = await Promise.all([
    createFixture({
      title:    `PDF single task (${runTag})`,
      subject:  'Математика',
      workType: 'custom',
      taskIds:  MIXED_TASK_IDS.slice(0, 1),
    }),
    createFixture({
      title:    `PDF 15 mixed tasks (${runTag})`,
      subject:  'Математика',
      workType: 'custom',
      taskIds:  MIXED_TASK_IDS.slice(0, 15),
    }),
    createFixture({
      title:    `PDF 30 mixed tasks (${runTag})`,
      subject:  'Математика',
      workType: 'ege_variant',
      taskIds:  MIXED_TASK_IDS.slice(0, 30),
    }),
  ])

  return { collection1: c1.id, collection15: c15.id, collection30: c30.id }
}

export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true })

  const browser = await chromium.launch()
  const ctx     = await browser.newContext()
  const page    = await ctx.newPage()

  await page.goto('http://localhost:5173/login')
  await page.waitForSelector('input[type="email"]', { timeout: 30_000 })
  await page.fill('input[type="email"]', 'physics@demo.ru')
  await page.fill('input[type="password"]', 'demo123')
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30_000 })
  await ctx.storageState({ path: AUTH_FILE })
  await browser.close()

  const fixtures = await createPdfFixtures()
  fs.writeFileSync(PDF_FIXTURES_FILE, JSON.stringify(fixtures, null, 2))
  console.log('[global-setup] created PDF E2E fixtures:', fixtures)
}
