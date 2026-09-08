// Pull the concept vocabulary from Notion and regenerate
// src/lib/vocabulary.generated.ts.
//
//   npm run sync:vocab            # fetch from Notion and write
//   npm run sync:vocab -- --check # fail if the file is out of date, write nothing
//   node scripts/sync-vocabulary.mjs --from rows.json   # offline, from a saved pull
//   node scripts/sync-vocabulary.mjs --soft             # never fail the caller
//
// `--soft` is how the build runs it (see the `prebuild` script): the deploy
// picks up whatever Notion says right now, but an unset token, a Notion outage
// or a revoked integration must not take the site down with it — it falls back
// to the committed file and carries on. That is also what makes the "push"
// button in the Notion page work: the button asks Vercel to rebuild, and the
// rebuild is what actually reads Notion.
//
// **The vocabulary is two related databases, and between them they own almost
// everything.** "Vocabulary Fields" is the shape — one row per sub-list, with
// the concept it belongs to, its stable field id, and its position. "Vocabulary
// Terms" is the words — one row is exactly one word, spelled as the app shows
// it, related to its field, ticked (or not) as a word that tags itself, and
// carrying any alternative spellings prose should also be recognised by.
//
// That leaves this file with three things a word bank has no business holding:
// which concepts exist and in what order, the eight hues (AA-verified in both
// themes, and Notion's palette is ten named colours that cannot express
// #f87171), and the one field whose options are a ladder rather than a list.
// Everything else — every word, every field, every id, every ordering — is a
// row someone can edit without touching code.
//
// Setup, once: create an internal integration at notion.so/my-integrations,
// share BOTH databases with it, and put the secret in .env.local as
// NOTION_TOKEN. The token is read-only as far as this script is concerned — it
// only ever queries.
import { readFileSync, writeFileSync } from 'node:fs'

/** "Vocabulary Fields" — the shape: 46 rows, one per sub-list. */
const FIELDS_DB = '09e753c4980f4550a201c00c855e504c'
/** "Vocabulary Terms" — the words: one row is one word. */
const TERMS_DB = '08652e466eb64fa090059c3095063bf9'

const GENERATED = new URL('../src/lib/vocabulary.generated.ts', import.meta.url)

// ---------------------------------------------------------------------------
// The shape that isn't Notion's to hold.

/** Concept id (stored data), its label, and its hue. Order is display order. */
const CONCEPTS = [
  ['pitch', 'Pitch', '#f87171'],
  ['duration', 'Duration', '#eab308'],
  ['dynamics', 'Dynamics', '#22c55e'],
  ['expressive', 'Expression', '#84cc16'],
  ['media', 'Performing media', '#60a5fa'],
  ['timbre', 'Timbre', '#22d3ee'],
  ['texture', 'Texture', '#a78bfa'],
  ['structure', 'Structure', '#f97316'],
]

/**
 * Fields whose options are a *ladder*, not a list — alphabetical order would
 * be musical nonsense (f, ff, fff, mf, mp, p, pp, ppp). Everything else sorts
 * by name, which is also how the app lists it.
 */
const LADDERS = {
  'dynamics.volume': ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'],
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const check = args.includes('--check')
const soft = args.includes('--soft')
const fromIndex = args.indexOf('--from')
const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : null

/** Give up without failing the caller — `--soft` only. */
function bail(message) {
  console.warn(`vocabulary sync skipped: ${message}`)
  process.exit(0)
}

const plain = (rich) => (rich ?? []).map((t) => t.plain_text).join('').trim()

/** Every page of one database, following Notion's cursor. */
async function queryAll(token, databaseId) {
  const out = []
  let cursor
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    })
    if (!res.ok) {
      const body = await res.text()
      if (soft) bail(`Notion ${res.status} — using the committed vocabulary`)
      console.error(`Notion ${res.status}: ${body}`)
      process.exit(1)
    }
    const page = await res.json()
    out.push(...page.results)
    cursor = page.has_more ? page.next_cursor : undefined
  } while (cursor)
  return out
}

/** Both databases, normalised to the shape buildFile wants. */
async function fetchRows() {
  const token = process.env.NOTION_TOKEN
  if (!token) {
    if (soft) bail('NOTION_TOKEN is not set — using the committed vocabulary')
    console.error(
      'NOTION_TOKEN is not set. Create an internal integration at\n' +
        'https://www.notion.so/my-integrations, share the two vocabulary\n' +
        'databases with it, and add NOTION_TOKEN=secret_… to .env.local.',
    )
    process.exit(1)
  }

  const rawFields = (await queryAll(token, FIELDS_DB))
    .map((r) => {
      const p = r.properties ?? {}
      return {
        pageId: r.id,
        fieldId: plain(p['Field ID']?.rich_text),
        label: plain(p.Field?.title),
        concept: p.Concept?.select?.name ?? '',
        order: p.Order?.number ?? Number.POSITIVE_INFINITY,
      }
    })
    .filter((f) => f.fieldId && f.label)

  const rawTerms = (await queryAll(token, TERMS_DB))
    .map((r) => {
      const p = r.properties ?? {}
      return {
        term: plain(p.Term?.title),
        pageId: (p.Field?.relation ?? [])[0]?.id ?? '',
        auto: p['Auto-tag']?.checkbox === true,
        aliases: plain(p.Aliases?.rich_text),
      }
    })
    .filter((t) => t.term && t.pageId)

  // Resolve each term's relation to the field id it names, so everything
  // downstream works in stored-data terms rather than Notion page ids.
  const byPage = new Map(rawFields.map((f) => [f.pageId, f.fieldId]))
  return {
    fields: rawFields.map(({ pageId, ...f }) => f),
    terms: rawTerms
      .map((t) => ({ ...t, fieldId: byPage.get(t.pageId) ?? '' }))
      .filter((t) => t.fieldId)
      .map(({ pageId, ...t }) => t),
  }
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function buildFile({ fields, terms }) {
  const byField = new Map()
  for (const t of terms) {
    if (!byField.has(t.fieldId)) byField.set(t.fieldId, [])
    byField.get(t.fieldId).push(t)
  }

  const known = new Set(CONCEPTS.map(([, label]) => label))
  const unmapped = [
    ...new Set(fields.filter((f) => !known.has(f.concept)).map((f) => f.concept || '(none)')),
  ]

  let body = ''
  let count = 0
  const autoTerms = new Set()
  const aliases = new Map()

  for (const [id, label, color] of CONCEPTS) {
    const mine = fields
      .filter((f) => f.concept === label)
      .sort((a, b) => a.order - b.order)
    body += `  {\n    id: ${quote(id)},\n    color: ${quote(color)},\n    label: ${quote(label)},\n    fields: [\n`
    for (const f of mine) {
      const rows = byField.get(f.fieldId) ?? []
      const ladder = LADDERS[f.fieldId]
      const options = [...new Set(rows.map((r) => r.term))].sort(
        ladder
          ? (a, b) => ladder.indexOf(a) - ladder.indexOf(b)
          : (a, b) => a.localeCompare(b),
      )
      for (const r of rows) {
        if (r.auto) autoTerms.add(r.term)
        for (const a of (r.aliases || '').split(',').map((x) => x.trim()).filter(Boolean)) {
          // First writer wins; a real term always keeps its own word.
          const k = a.toLowerCase()
          if (!aliases.has(k)) aliases.set(k, r.term)
        }
      }
      count += options.length
      const inline = `options: [${options.map(quote).join(', ')}],`
      body += `      {\n        id: ${quote(f.fieldId)},\n        label: ${quote(f.label)},\n`
      body +=
        inline.length <= 86
          ? `        ${inline}\n`
          : `        options: [\n${options.map((o) => `          ${quote(o)},`).join('\n')}\n        ],\n`
      body += `        allowCustom: true,\n      },\n`
    }
    body += `    ],\n  },\n`
  }

  const auto = [...autoTerms].sort((a, b) => a.localeCompare(b))
  const aliasKeys = [...aliases.keys()]
    .filter((k) => !autoTerms.has(k))
    .sort((a, b) => a.localeCompare(b))

  const header = `// GENERATED FILE — do not edit by hand.
//
// The vocabulary comes from two Notion databases under "Elements of Music —
// Vocabulary": **Vocabulary Fields** (the shape — one row per sub-list, with
// its concept, its stable field id and its position) and **Vocabulary Terms**
// (the words — one row is one word, related to its field, ticked if it tags
// itself, with any alternative spellings). The concepts, their order and the
// eight hues come from scripts/sync-vocabulary.mjs. Change a word in Notion,
// or the shape in that script, then run:
//
//   npm run sync:vocab
//
// See lib/musicElements.ts for what ELEMENTS feeds, and lib/propertyTags.ts
// for what AUTO_TERMS and ALIASES do.
import type { ElementCategory } from './musicElements'

export const ELEMENTS: ElementCategory[] = [
`

  const tail =
    '\n/**\n' +
    ' * Words that tag themselves as you type — the Auto-tag tick in Notion.\n' +
    ' * Only words nobody writes in their everyday sense belong here; "even",\n' +
    ' * "light" and "major" are deliberately absent.\n' +
    ' */\nexport const AUTO_TERMS: string[] = [\n' +
    auto.map((t) => `  ${quote(t)},`).join('\n') +
    '\n]\n\n/**\n' +
    ' * Alternative spellings prose is recognised by, mapped to the word they\n' +
    ' * stand for — the Aliases column. Irregular forms only: the regular\n' +
    ' * English ones are generated in propertyTags.ts and need no row here.\n' +
    ' */\nexport const ALIASES: Record<string, string> = {' +
    (aliasKeys.length
      ? '\n' + aliasKeys.map((k) => `  ${quote(k)}: ${quote(aliases.get(k))},`).join('\n') + '\n'
      : '') +
    '}\n'

  return {
    source: header + body + ']\n' + tail,
    elements: body,
    count,
    auto: auto.length,
    aliases: aliasKeys.length,
    fields: fields.length,
    unmapped,
  }
}

let rows
try {
  rows = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : await fetchRows()
} catch (e) {
  if (soft) bail(`${e.message} — using the committed vocabulary`)
  throw e
}
if (!rows.terms?.length || !rows.fields?.length) {
  // An empty pull is far more likely to be a permissions problem than a really
  // empty database, and writing it out would silently wipe the vocabulary.
  if (soft) bail('Notion returned no rows — using the committed vocabulary')
  console.error(
    'Notion returned no rows. Are BOTH vocabulary databases shared with the integration?',
  )
  process.exit(1)
}

const built = buildFile(rows)

let previous = ''
try {
  previous = readFileSync(GENERATED, 'utf8')
} catch {
  /* first run */
}

// Report the words that changed, since that is the whole point of a sync.
const values = (text) =>
  new Set([...text.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]))
const before = values(previous)
const after = values(built.source)
const added = [...after].filter((v) => !before.has(v))
const removed = [...before].filter((v) => !after.has(v))

console.log(
  `${rows.terms.length} terms across ${built.fields} fields in Notion → ` +
    `${built.count} options in ${CONCEPTS.length} concepts, ` +
    `${built.auto} auto-tagging, ${built.aliases} aliases`,
)
if (added.length) console.log(`  + ${added.join(', ')}`)
if (removed.length) console.log(`  − ${removed.join(', ')}`)
if (!added.length && !removed.length) console.log('  no change')
if (built.unmapped.length) {
  console.log(
    `\nFields whose Concept the app doesn't know — fix the Concept in Notion,\n` +
      `or add it to CONCEPTS here:\n  ${built.unmapped.join('\n  ')}`,
  )
}

if (check) {
  if (built.source !== previous) {
    console.error('\nvocabulary.generated.ts is out of date — run npm run sync:vocab')
    process.exit(1)
  }
  process.exit(0)
}

if (built.source === previous) process.exit(0)
writeFileSync(GENERATED, built.source)
console.log(`\nWrote ${GENERATED.pathname.split('/').pop()}.`)
