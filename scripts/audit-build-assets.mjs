import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const assetLiteral = /["'](\/?assets\/[\w./-]+)["']/g

function javascriptReferences(file, source) {
  const refs = Array.from(source.matchAll(assetLiteral), match => '/' + match[1].replace(/^\//, ''))
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      refs.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteralLike(argument)) refs.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return refs
}

function references(file, source) {
  if (file.endsWith('.html')) {
    return Array.from(source.matchAll(/\b(?:src|href)=["'](\/?assets\/[^"']+)["']/g), match => '/' + match[1].replace(/^\//, ''))
  }
  if (file.endsWith('.css')) {
    return Array.from(source.matchAll(/\burl\(\s*["']?([^\s"')]+)["']?\s*\)/g), match => {
      const ref = match[1]
      return !ref.startsWith('#') && !/^(?:[\w+.-]+:|\/\/)/.test(ref) && !ref.startsWith('/') ? './' + ref : ref
    })
  }
  return javascriptReferences(file, source)
}

function* files(directory, relative) {
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const name = posix.join(relative, entry.name)
    if (entry.isDirectory()) yield* files(directory, name)
    else if (entry.isFile()) yield name
  }
}

export function auditBuild(directory) {
  const missing = []
  const assets = Array.from(files(directory, 'assets'))
  const inspect = ['index.html', ...assets.filter(file => /\.(?:m?js|css)$/.test(file))]
  for (const file of inspect) {
    const source = readFileSync(join(directory, file), 'utf8')
    const dependencies = new Set()
    for (const ref of references(file, source)) {
      const path = ref.split(/[?#]/, 1)[0]
      if (!path.startsWith('/assets/') && !/^\.{1,2}\//.test(path)) continue
      const resolved = posix.normalize(path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(file), path))
      if (resolved.startsWith('assets/')) dependencies.add(resolved)
    }
    for (const dependency of dependencies) {
      if (!statSync(join(directory, dependency), { throwIfNoEntry: false })?.isFile()) {
        missing.push({ file, dependency })
      }
    }
  }
  return { assets: assets.length, inspected: inspect.length, missing }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const directory of process.argv.slice(2).length ? process.argv.slice(2) : ['dist']) {
    const result = auditBuild(directory)
    console.log(JSON.stringify({ directory, ...result }))
    if (result.missing.length) process.exitCode = 1
  }
}
