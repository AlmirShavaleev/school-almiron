import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

const downloadsDir = argValue('--downloads', join(homedir(), 'Downloads'))
const targetRoot = argValue('--target', 'D:\\школково парсим заново')
const recentMinutes = Number(argValue('--minutes', '60'))
const since = Date.now() - recentMinutes * 60 * 1000

function cleanFileName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim()
    .slice(0, 180)
}

function uniquePath(dir, filename) {
  const parsed = parse(filename)
  let candidate = join(dir, filename)
  let counter = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${parsed.name} (${counter})${parsed.ext}`)
    counter++
  }
  return candidate
}

if (!existsSync(downloadsDir)) {
  throw new Error(`Downloads folder not found: ${downloadsDir}`)
}

mkdirSync(targetRoot, { recursive: true })

const files = readdirSync(downloadsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
  .map((entry) => {
    const fullPath = join(downloadsDir, entry.name)
    return { name: entry.name, fullPath }
  })

const recentFiles = files
  .map((file) => {
    return { ...file, mtimeMs: statSync(file.fullPath).mtimeMs }
  })
  .filter((file) => file.mtimeMs >= since)
  .sort((a, b) => a.mtimeMs - b.mtimeMs)

let moved = 0

for (const file of recentFiles) {
  const nameWithoutExt = file.name.replace(/\.pdf$/i, '')
  const match = nameWithoutExt.match(/^\d+\s*-\s*(.+?)\s*-\s*(.+)$/)
  if (!match) {
    console.log(`SKIP: ${file.name}`)
    continue
  }

  const lessonTitle = cleanFileName(match[1])
  const attachmentTitle = cleanFileName(match[2])
  const lessonDir = join(targetRoot, lessonTitle)
  mkdirSync(lessonDir, { recursive: true })

  const targetPath = uniquePath(lessonDir, `${attachmentTitle}.pdf`)
  renameSync(file.fullPath, targetPath)
  console.log(`OK: ${file.name} -> ${targetPath}`)
  moved++
}

console.log(`Done. Moved PDFs: ${moved}`)
