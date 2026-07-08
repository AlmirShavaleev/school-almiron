import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

const pdf = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
  'utf8',
)
fs.writeFileSync(path.join(dir, 'test-material.pdf'), pdf)

// 1x1 PNG (valid, tiny)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
fs.writeFileSync(path.join(dir, 'test-image.png'), png)

// Executable disguised as .pdf (real MIME should still be checked by extension+content-type at upload,
// this file has a valid MZ header but a .exe extension — used for the "executable rejected" test)
const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
fs.writeFileSync(path.join(dir, 'malicious.exe'), exe)

// Oversized file (21MB, exceeds the 20MB bucket limit)
fs.writeFileSync(path.join(dir, 'oversized.pdf'), Buffer.alloc(21 * 1024 * 1024, 0x41))

console.log('fixtures written to', dir)
