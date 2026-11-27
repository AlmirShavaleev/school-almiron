import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { chromium, devices, expect } from '@playwright/test'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' }
const assetsByRelease = new Map()
const releases = ['fixture-a', 'fixture-b']
let temporary
let browser

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'almiron-browser-'))
  const previousId = process.env.ALMIRON_BUILD_ID
  try {
    for (const release of releases) {
      process.env.ALMIRON_BUILD_ID = release
      const dist = join(temporary, release)
      await build({
        root: join(root, 'e2e/deploy-fixture'),
        configFile: join(root, 'vite.config.ts'),
        logLevel: 'warn',
        build: { outDir: dist, emptyOutDir: true },
      })
      assetsByRelease.set(release, await readdir(join(dist, 'assets')))
    }
  } finally {
    if (previousId === undefined) delete process.env.ALMIRON_BUILD_ID
    else process.env.ALMIRON_BUILD_ID = previousId
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
  })
})

after(async () => {
  await browser?.close()
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

async function fixture(t, device = {}) {
  let active = releases[0]
  const files = new Map()
  for (const release of releases) {
    for (const name of assetsByRelease.get(release)) files.set('/assets/' + name, join(temporary, release, 'assets', name))
  }
  const failures = new Map()
  const requests = []
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const asset = path.startsWith('/assets/')
    const name = asset ? files.get(path) : join(temporary, active, path === '/version.json' ? 'version.json' : 'index.html')
    const status = failures.get(path) ?? (name ? 200 : 404)
    requests.push({ path, status })
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('test failure')
      return
    }
    const headers = {
      'Content-Type': (mime[extname(name)] || 'application/octet-stream') + '; charset=utf-8',
      'Cache-Control': asset ? 'public, max-age=31536000, immutable' : path === '/version.json' ? 'no-store' : 'no-cache',
    }
    const contents = await readFile(name)
    res.writeHead(200, headers)
    res.end(contents)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext(device)
  t.after(async () => { await context.close(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  await context.route(url => url.origin !== base, route => route.abort())
  const page = await context.newPage()
  await page.goto(base + '/lesson/1')
  await expect(page.getByRole('heading', { name: 'Урок 1 · fixture-a' })).toBeVisible()
  return { page, context, base, requests, failures, activate: release => { active = release } }
}

const lessonAsset = (release, extension) => '/assets/' + assetsByRelease.get(release).find(file => file.startsWith('lesson-two-') && file.endsWith(extension))
const nextLesson = page => page.getByRole('link', { name: 'Другой урок' }).click()
const checks = requests => requests.filter(request => request.path === '/version.json').length
const documents = requests => requests.filter(request => request.path.startsWith('/lesson/')).length

for (const [label, device] of [['desktop', devices['Desktop Chrome']], ['mobile', devices['Pixel 7']]]) {
  test(`old tab survives activation and rollback in ${label}`, async t => {
    const f = await fixture(t, device)
    assert(!f.requests.some(request => request.path === lessonAsset('fixture-a', '.js')))
    await f.page.getByRole('textbox', { name: 'Ответ' }).fill('тестовый черновик')
    f.activate('fixture-b')
    await nextLesson(f.page)
    await expect(f.page.getByRole('heading', { name: 'Урок 2 · fixture-a' })).toBeVisible()
    assert(f.requests.some(request => request.path === lessonAsset('fixture-a', '.js') && request.status === 200))
    assert.equal(documents(f.requests), 1)
    assert.equal(checks(f.requests), 0)

    const second = await f.context.newPage()
    await second.goto(f.base + '/lesson/1')
    await expect(second.getByRole('heading', { name: 'Урок 1 · fixture-b' })).toBeVisible()
    f.activate('fixture-a')
    await nextLesson(second)
    await expect(second.getByRole('heading', { name: 'Урок 2 · fixture-b' })).toBeVisible()
    assert.equal(documents(f.requests), 2)
    assert.equal(checks(f.requests), 0)
  })
}

test('404 after deployment waits for explicit update and restores text and file bytes', async t => {
  const f = await fixture(t)
  const answer = f.page.getByRole('textbox', { name: 'Ответ' })
  await answer.fill('тестовый ответ')
  await f.page.locator('input[type=file]').setInputFiles({
    name: 'worksheet.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture worksheet bytes'),
  })
  await expect(f.page.getByRole('button', { name: 'worksheet.txt' })).toBeVisible()
  f.activate('fixture-b')
  f.failures.set(lessonAsset('fixture-a', '.js'), 404)
  await nextLesson(f.page)
  const update = f.page.getByRole('button', { name: 'Обновить страницу' })
  await expect(update).toBeVisible()
  assert.equal(documents(f.requests), 1)
  await update.click()
  await expect(f.page.getByRole('heading', { name: 'Урок 2 · fixture-b' })).toBeVisible()
  await f.page.getByRole('link', { name: 'Первый урок' }).click()
  await expect(answer).toHaveValue('тестовый ответ')
  await f.page.getByRole('button', { name: 'worksheet.txt' }).click()
  await expect(f.page.getByText('fixture worksheet bytes')).toBeVisible()
  assert.equal(checks(f.requests), 1)
})

for (const [extension, status, type] of [['.js', 500, 'chunk_js'], ['.css', 404, 'chunk_css']]) {
  test(`${status} on ${extension} of current version is recoverable and sends one diagnostic`, async t => {
    const f = await fixture(t)
    f.failures.set(lessonAsset('fixture-a', extension), status)
    await nextLesson(f.page)
    const retry = f.page.getByRole('button', { name: 'Повторить загрузку' })
    await expect(retry).toBeVisible()
    assert.equal(documents(f.requests), 1)
    await expect(f.page.getByTestId('diagnostics')).toContainText(`"error_type":"${type}"`)
    const sent = JSON.parse(await f.page.getByTestId('diagnostics').textContent())
    assert.equal(sent.length, 1)
    assert.equal(sent[0].resource_url, lessonAsset('fixture-a', extension))
    f.failures.clear()
    await retry.click()
    await expect(f.page.getByRole('heading', { name: 'Урок 2 · fixture-a' })).toBeVisible()
  })
}

test('offline never reloads before recovery of connectivity and manual retry', async t => {
  const f = await fixture(t)
  await f.context.setOffline(true)
  await nextLesson(f.page)
  await expect(f.page.getByText(/Связь с сайтом прервалась/)).toBeVisible()
  assert.equal(documents(f.requests), 1)
  assert.equal(checks(f.requests), 0)
  await f.context.setOffline(false)
  await f.page.getByRole('button', { name: 'Проверить связь' }).click()
  await f.page.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(f.page.getByRole('heading', { name: 'Урок 2 · fixture-a' })).toBeVisible()
})

test('a failed draft write blocks the explicit reload', async t => {
  const f = await fixture(t)
  await f.page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('almiron:student-draft:')) throw new Error('fixture storage unavailable')
      return original.call(this, key, value)
    }
  })
  await f.page.getByRole('textbox', { name: 'Ответ' }).fill('только в памяти')
  f.activate('fixture-b')
  f.failures.set(lessonAsset('fixture-a', '.js'), 404)
  await nextLesson(f.page)
  await f.page.getByRole('button', { name: 'Обновить страницу' }).click()
  await expect(f.page.getByText(/Обновление остановлено/)).toBeVisible()
  assert.equal(documents(f.requests), 1)
  await f.page.getByRole('link', { name: 'Первый урок' }).click()
  await expect(f.page.getByRole('textbox', { name: 'Ответ' })).toHaveValue('только в памяти')
})

test('drafts and attachments stay isolated across auth transitions, expiry and browser tabs', async t => {
  const f = await fixture(t)
  const accounts = f.base + '/accounts'
  await f.page.goto(accounts)
  const answer = page => page.getByRole('textbox', { name: 'Ответ' })
  const click = (page, name) => page.getByRole('button', { name }).click()
  await click(f.page, 'Sign in A')
  await answer(f.page).fill('private A')
  await f.page.locator('input[type=file]').setInputFiles({
    name: 'synthetic-a.txt', mimeType: 'text/plain', buffer: Buffer.from('private attachment A'),
  })
  await expect(f.page.getByRole('button', { name: 'synthetic-a.txt' })).toBeVisible()

  await click(f.page, 'Pending B')
  await expect(answer(f.page)).toHaveCount(0)
  await click(f.page, 'Confirm B')
  await expect(answer(f.page)).toHaveValue('')
  await expect(f.page.getByRole('button', { name: 'synthetic-a.txt' })).toHaveCount(0)
  await answer(f.page).fill('private B')
  await click(f.page, 'Sign out')
  await expect(answer(f.page)).toHaveCount(0)
  await click(f.page, 'Sign in A')
  await expect(answer(f.page)).toHaveValue('private A')
  await click(f.page, 'synthetic-a.txt')
  await expect(f.page.getByText('private attachment A')).toBeVisible()

  const second = await f.context.newPage()
  await second.goto(accounts)
  await click(second, 'Sign in A')
  await expect(answer(second)).toHaveValue('')
  await expect(second.getByRole('button', { name: 'synthetic-a.txt' })).toHaveCount(0)
  await answer(second).fill('another tab')
  await expect(answer(f.page)).toHaveValue('private A')

  await f.context.setOffline(true)
  await answer(f.page).fill('written offline by A')
  await click(f.page, 'Expire A')
  await expect(answer(f.page)).toHaveCount(0)
  await click(f.page, 'Sign in A')
  await expect(answer(f.page)).toHaveValue('written offline by A')
})
