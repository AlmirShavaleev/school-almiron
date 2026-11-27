import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const [baseline, candidate] = process.argv.slice(2, 4).map(value => resolve(value))
const load = process.argv.includes('--load')
const rounds = Number(process.env.ALMIRON_LOAD_ROUNDS ?? 2)
if (!baseline || !candidate) throw new Error('Usage: node scripts/measure-frontend.mjs BASELINE_DIST CANDIDATE_DIST')
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('ALMIRON_LOAD_ROUNDS must be a positive integer')
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
const profile = '10000000-0000-4000-8000-000000000001'
const student = '10000000-0000-4000-8000-000000000002'
const group = '10000000-0000-4000-8000-000000000003'
const topic = '10000000-0000-4000-8000-000000000004'
const title = 'Synthetic benchmark lesson'
const ref = 'kthfozyfruorwjhvvsbw'
const epoch = Math.floor(Date.now() / 1000)
function sessionFor(index) {
  const id = index ? `31000000-0000-4000-8000-${String(index).padStart(12, '0')}` : profile
  const user = { id, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  const token = ['e30', Buffer.from(JSON.stringify({ sub: id, exp: epoch + 3600, role: 'authenticated' })).toString('base64url'), 'Zml4dHVyZQ'].join('.')
  return { access_token: token, refresh_token: 'synthetic-fixture', expires_in: 3600, expires_at: epoch + 3600, token_type: 'bearer', user }
}

function mockResponse(path, request, user) {
  switch (path) {
    case '/auth/v1/user': return user
    case '/rest/v1/profiles': return [{ ...user, full_name: 'Fixture learner', role: 'student' }]
    case '/rest/v1/students': return [{ id: student, profile_id: user.id, full_name: 'Fixture learner', is_active: true }]
    case '/rest/v1/topics': {
      const row = { id: topic, title, order_index: 1, is_open: true, kind: 'lesson', modules: { id: group, title: 'Fixture module', courses: { id: group, title: 'Fixture course', subject: 'math' } } }
      return request.headers().accept?.includes('vnd.pgrst.object') ? row : [row]
    }
    case '/rest/v1/groups': return request.headers().accept?.includes('vnd.pgrst.object') ? { id: group, name: 'Fixture group' } : []
    case '/rest/v1/rpc/my_subscription': return null
    case '/rest/v1/rpc/perf_ingest': return 0
    default: return []
  }
}

async function serve(directory) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = pathname === '/login' || pathname.startsWith('/my-course/') ? '/index.html' : pathname
    try {
      const contents = await readFile(join(directory, file))
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
      response.end(contents)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

async function measure(browser, origin, signed, index = 0, readyToStart = async () => {}) {
  const context = await browser.newContext()
  const calls = []
  const transfers = []
  const pending = new Set()
  let lastActivity = 0
  let apiBytes = 0
  const session = sessionFor(index)
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      if (url.hostname !== `${ref}.supabase.co`) return route.abort()
      calls.push(url.pathname)
      const headers = { 'Content-Range': '0-0/0', 'Content-Type': 'application/json' }
      const body = route.request().method() === 'HEAD' ? '' : JSON.stringify(mockResponse(url.pathname, route.request(), session.user))
      apiBytes += Buffer.byteLength(body) + Buffer.byteLength(route.request().postData() ?? '')
      return route.fulfill({
        headers,
        body,
      })
    })
    if (signed) {
      await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: `sb-${ref}-auth-token`, value: JSON.stringify(session),
      })
    }
    const page = await context.newPage()
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== origin && url.hostname !== `${ref}.supabase.co`) return
      pending.add(request)
      lastActivity = Date.now()
    })
    function requestEnded(request) {
      if (pending.delete(request)) lastActivity = Date.now()
    }
    page.on('requestfailed', requestEnded)
    page.on('requestfinished', request => {
      requestEnded(request)
      transfers.push(request.sizes().then(sizes => Object.values(sizes).reduce((sum, size) => sum + Math.max(0, size), 0), () => 0))
    })
    await readyToStart()
    await page.goto(origin + (signed ? `/my-course/${group}/topic/${topic}` : '/login'), { waitUntil: 'commit', timeout: 90_000 })
    const ready = await page.waitForFunction((text) => {
      const element = text
        ? Array.from(document.querySelectorAll('h1')).find(heading => heading.textContent === text)
        : document.querySelector('[data-testid=login-email]')
      return element?.getBoundingClientRect().width ? performance.now() : false
    }, signed ? title : null, { timeout: 90_000 })
    const readyMs = await ready.jsonValue()
    const readyAt = Date.now()
    while (pending.size || Date.now() - Math.max(readyAt, lastActivity) < 1000) {
      if (Date.now() - readyAt > 90_000) throw new Error('Startup HTTP requests did not settle')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const httpBytes = (await Promise.all(transfers)).reduce((sum, bytes) => sum + bytes, 0)
    return { readyMs, calls: calls.filter(path => path !== '/rest/v1/rpc/perf_ingest').length, rum: calls.filter(path => path === '/rest/v1/rpc/perf_ingest').length, apiBytes, httpBytes }
  } catch (error) {
    throw new Error(`Fixture measurement failed for ${signed ? 'lesson' : 'login'}: ${JSON.stringify(calls)}`, { cause: error })
  } finally { await context.close() }
}

async function entryBytes(directory) {
  const index = await readFile(join(directory, 'index.html'), 'utf8')
  const paths = new Set(Array.from(index.matchAll(/\b(?:src|href)="(\/assets\/[^"]+)"/g), match => match[1]))
  let bytes = 0
  for (const path of paths) bytes += gzipSync(await readFile(join(directory, path))).byteLength
  return bytes
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
function workloadStats(samples) {
  const times = samples.map(row => row.readyMs).sort((a, b) => a - b)
  const percentile = value => Math.round(times[Math.ceil(value * times.length) - 1])
  return {
    samples: samples.length, p50_ms: Math.round(median(times)), p95_ms: percentile(0.95), p99_ms: percentile(0.99),
    supabase_requests: samples.reduce((sum, row) => sum + row.calls + row.rum, 0),
    rum_requests: samples.reduce((sum, row) => sum + row.rum, 0),
    api_payload_bytes: samples.reduce((sum, row) => sum + row.apiBytes, 0),
    http_bytes: samples.reduce((sum, row) => sum + row.httpBytes, 0),
  }
}

async function cohort(browser, server, count) {
  let open
  let waiting = 0
  const gate = new Promise(resolve => { open = resolve })
  const timer = setTimeout(open, 30_000)
  const readyToStart = () => {
    if (++waiting === count) open()
    return gate
  }
  try { return await Promise.all(Array.from({ length: count }, (_, index) => measure(browser, server.origin, true, index + 1, readyToStart))) }
  finally { clearTimeout(timer) }
}
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
})
const servers = await Promise.all([serve(baseline), serve(candidate)])
try {
  if (load) {
    for (const count of [1, 5, 10, 20, 30]) {
      const samples = [[], []]
      for (let round = 0; round < rounds; round++) {
        for (const index of round ? [1, 0] : [0, 1]) {
          samples[index].push(...await cohort(browser, servers[index], count))
        }
      }
      console.log(JSON.stringify({ learners: count, baseline: workloadStats(samples[0]), candidate: workloadStats(samples[1]) }))
    }
  } else {
  for (const signed of [false, true]) {
    const measurements = [[], []]
    for (let run = 0; run < 9; run++) {
      for (const index of run % 2 ? [1, 0] : [0, 1]) {
        const result = await measure(browser, servers[index].origin, signed)
        if (run > 0) measurements[index].push(result)
      }
    }
    const stats = measurements.map(samples => ({
      readyMedianMs: Math.round(median(samples.map(row => row.readyMs))),
      supabaseCalls: samples.map(row => row.calls),
      rumCalls: samples.map(row => row.rum),
    }))
    console.log(JSON.stringify({ scenario: signed ? 'authenticated lesson (mock backend)' : 'public sign-in', baseline: stats[0], candidate: stats[1] }))
  }
  }
  console.log(JSON.stringify({ entryGzipBytes: { baseline: await entryBytes(baseline), candidate: await entryBytes(candidate) } }))
} finally {
  await browser.close()
  await Promise.all(servers.map(server => server.close()))
}
