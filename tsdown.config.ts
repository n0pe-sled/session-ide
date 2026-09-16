/**
 * tsdown config for dsh-session-ide: the node-half library build plus the
 * browser client bundle.
 *
 * The browser half replicates the client-bundle contract from
 * packages/client/tsdown.client.ts (clientConfig): a lazy CJS factory
 * artifact served from lib/client.js, wrapped in the window.__ModuleLoader__
 * .load handoff, with the platform baseline (PLATFORM_MODULES +
 * PRELOADED_CLIENT_EXTERNALS from packages/client/web/src/platform.ts) kept
 * external so those specifiers materialize through the loader module table
 * instead of being duplicated into this bundle. clean stays off on both
 * halves so neither build wipes the other's output.
 *
 * Monaco is an ordinary third-party library (no shared runtime identity) and
 * is BUNDLED into lib/client.js — the harness serves no separate chunk or
 * asset files for plugin bundles. Monaco's ESM sources import plain
 * `.css` side-effect modules (codicons, tree, inputbox, ...), so a tiny
 * rolldown plugin below inlines those stylesheets as injected style tags and
 * rewrites every relative `url(...)` (the codicon font, small SVGs) into a
 * data: URI — the whole editor travels inside one file with zero extra
 * requests.
 *
 * Node half: every production runtime dependency stays external
 * (@deepseek-ai/* peers resolve through the profile node_modules fallback).
 */

import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'rolldown'

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

const PRELOADED_CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime/client',
] as const

const CLIENT_EXTERNALS = new Set<string>([
  ...PLATFORM_MODULES,
  ...PRELOADED_CLIENT_EXTERNALS,
  // Type-only import surface (erased at compile time; never a runtime request,
  // but listed defensively so a future accidental value import fails loud).
  '@deepseek-ai/dsh-client-ui-conversation',
])

/** Production runtime sections of this package: peer deps resolved host-side. */
const PRODUCTION_DEPENDENCIES = Object.keys({
  '@deepseek-ai/cordis': '4.0.1',
  '@deepseek-ai/dsh-session': '0.1.1-rc.2',
  '@deepseek-ai/dsh-typert-protocol': '0.1.1-rc.2',
  '@deepseek-ai/dsh-typert-registry': '0.1.1-rc.2',
  '@deepseek-ai/schemastery': '3.18.1',
}).map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`))

const matchesProduction = (specifier: string): boolean =>
  PRODUCTION_DEPENDENCIES.some(pattern => pattern.test(specifier))

// --- Monaco CSS inlining ------------------------------------------------------

const CSS_VIRTUAL_PREFIX = '\0dsh-session-ide-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Simple stable hash for style-tag ids. */
function hashOf(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
}

/** Rewrite every relative url(...) in a stylesheet into a data: URI. */
async function inlineAssets(file: string, css: string): Promise<string> {
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g
  const replacements: Array<{ start: number; end: number; data: string }> = []
  for (const match of css.matchAll(urlPattern)) {
    const raw = match[2]
    if (raw === undefined) continue
    if (/^(data:|https?:|#|\/)/.test(raw)) continue
    const assetPath = resolve(dirname(file), raw)
    let buffer: Buffer
    try {
      buffer = await readFile(assetPath)
    } catch {
      continue
    }
    const mime = MIME_BY_EXTENSION[extname(assetPath).toLowerCase()] ?? 'application/octet-stream'
    replacements.push({ start: match.index, end: match.index + match[0].length, data: `data:${mime};base64,${buffer.toString('base64')}` })
  }
  if (replacements.length === 0) return css
  let out = ''
  let cursor = 0
  for (const replacement of replacements) {
    out += css.slice(cursor, replacement.start)
    out += replacement.data
    cursor = replacement.end
  }
  return out + css.slice(cursor)
}

/** Absolute fs root of monaco-editor (beyond the package's exports map). */
const MONACO_ROOT = fileURLToPath(new URL('./node_modules/monaco-editor/', import.meta.url))

/** rolldown plugin: resolve monaco's esm deep imports (outside its exports map). */
const monacoPath: Plugin = {
  name: 'dsh-session-ide-monaco-path',
  resolveId: {
    order: 'pre' as const,
    handler(source: string) {
      if (!source.startsWith('monaco-editor/esm/')) return null
      const relative = source.slice('monaco-editor/'.length)
      return resolve(MONACO_ROOT, relative.endsWith('.js') ? relative : `${relative}.js`)
    },
  },
}

/** rolldown plugin: turn `.css` imports into self-injecting style modules. */
const monacoCssInline: Plugin = {
  name: 'dsh-session-ide-css-inline',
  resolveId: {
    order: 'pre' as const,
    handler(source: string, importer: string | undefined) {
      if (!source.endsWith('.css') || importer === undefined) return null
      return CSS_VIRTUAL_PREFIX + resolve(dirname(importer), source) + CSS_VIRTUAL_SUFFIX
    },
  },
  async load(this: { addWatchFile(file: string): void }, id: string) {
    if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const file = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(file)
    const raw = await readFile(file, 'utf8')
    const css = await inlineAssets(file, raw)
    const tagId = `dsh-session-ide-${hashOf(file)}`
    return [
      `const css = ${JSON.stringify(css)};`,
      `const tagId = ${JSON.stringify(tagId)};`,
      `if (typeof document !== 'undefined' && document.getElementById(tagId) === null) {`,
      `  const tag = document.createElement('style');`,
      `  tag.id = tagId;`,
      `  tag.setAttribute('data-plugin-css', tagId);`,
      `  tag.textContent = css;`,
      `  document.head.appendChild(tag);`,
      `}`,
      `export {};`,
    ].join('\n')
  },
}

export default [
  // Node half: plain ESM build of src/index.ts → lib/index.js, production deps
  // external (resolved at runtime through the profile's node_modules fallback).
  // dts emits lib/index.d.ts for the types field.
  {
    name: 'dsh-session-ide',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => isBuiltin(specifier) || matchesProduction(specifier),
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !matchesProduction(specifier),
    },
  },
  // Browser half: lazy CJS factory bundle, served from lib/client.js.
  {
    name: 'dsh-session-ide/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship via the node-half dts; dts here would wrap the
    // banner/footer into .d.cts and break parsing.
    dts: false,
    sourcemap: true,
    clean: false,
    plugins: [monacoPath, monacoCssInline],
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // Monaco's ESM sources carry dynamic import() sites (lazy language
      // registers, the diff computer); the harness serves no separate chunk
      // files, so every chunk must merge back into the one factory artifact.
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: 'dsh-session-ide', factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
