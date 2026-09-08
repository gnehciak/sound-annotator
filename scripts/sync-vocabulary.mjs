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
// **Notion owns the words. This file owns the shape.** The database has three
// columns that matter — Concept, Category, Term — which is exactly a category,
// a field and an option. Everything else the app needs is a judgment call that
// does not belong in a word bank and is therefore configured below: which
// concept a category lands in, what colour it wears (checked for AA contrast in
// both themes), the field order, the lists the bank has no equivalent for, and
// the split of the Italian markings by concept. Add a term in Notion and it
// appears here on the next run; add a whole *category* in Notion and the run
// tells you it is unmapped, because deciding where it goes is a person's job.
//
// Setup, once: create an internal integration at notion.so/my-integrations,
// share the database page with it, and put the secret in .env.local as
// NOTION_TOKEN. The token is read-only as far as this script is concerned — it
// only ever queries.
import { readFileSync, writeFileSync } from 'node:fs'

/** The "Concept vocabulary — HSC & Trial sample answers" database. */
const DATABASE_ID = 'e8f0a61dca464649ab849a9eabd3f856'
const GENERATED = new URL('../src/lib/vocabulary.generated.ts', import.meta.url)
const PROPERTY_TAGS = new URL('../src/lib/propertyTags.ts', import.meta.url)

// ---------------------------------------------------------------------------
// Shape. Category id, label, hue, then the fields in display order: app field
// id, field label, and the Notion Category it draws its options from (null =
// the list is ours, see OWN).
//
// Field ids are stored data — they are the keys of ElementsData.fields and the
// `data-field` of every inline tag — so relabel freely and rename ids only
// after checking the database says nothing stores them.
const CATEGORIES = [
  ['pitch', 'Pitch', '#f87171', [
    ['pitch.contour', 'Melodic motion & contour', 'Melodic motion & contour'],
    ['pitch.range', 'Range & register', 'Range & register'],
    ['pitch.tonality', 'Tonality', 'Tonality'],
    ['pitch.scale', 'Scale / mode type', 'Scale / mode type'],
    ['pitch.harmony', 'Harmony & chord quality', 'Harmony & chord quality'],
    ['pitch.consonance', 'Consonance / dissonance', 'Consonance / dissonance'],
    ['pitch.cadence', 'Cadence type', 'Cadence type'],
  ]],
  ['duration', 'Duration', '#eab308', [
    ['duration.tempo', 'Speed (tempo)', 'Speed (tempo)'],
    ['duration.tempoChange', 'Tempo change', 'Tempo change'],
    ['duration.drive', 'Drive / momentum', 'Drive / momentum'],
    ['duration.steadiness', 'Steadiness / regularity', 'Steadiness / regularity'],
    ['duration.syncopation', 'Irregularity / syncopation', 'Irregularity / syncopation'],
    ['duration.metre', 'Metre & metre changes', 'Metre & metre changes'],
    ['duration.values', 'Note-value character', 'Note-value character'],
    ['duration.feel', 'Rhythmic feel & character', 'Rhythmic feel & character'],
    ['duration.italian', 'Tempo & rhythmic terms (Italian)', 'Tempo & rhythmic terms (Italian)'],
  ]],
  ['dynamics', 'Dynamics', '#22c55e', [
    ['dynamics.volume', 'Dynamic level', null],
    ['dynamics.loudness', 'Loudness level', 'Loudness level'],
    ['dynamics.change', 'Change in dynamics', 'Change in dynamics'],
    ['dynamics.italian', 'Dynamic markings (Italian)', null],
  ]],
  ['expressive', 'Expression', '#84cc16', [
    ['expressive.articulation', 'Articulation', 'Articulation'],
    ['expressive.technique', 'Special playing techniques', 'Special playing techniques'],
    ['expressive.phrasing', 'Phrasing & character', 'Phrasing & character'],
    ['expressive.italian', 'Performance directions (Italian)', null],
  ]],
  ['media', 'Performing media', '#60a5fa', [
    ['media.instrument', 'Instrument / section', null],
    ['media.ensemble', 'Ensemble / forces', null],
    ['media.production', 'Sound produced by', null],
  ]],
  ['timbre', 'Timbre', '#22d3ee', [
    ['timbre.bright', 'Bright / brilliant', 'Bright / brilliant'],
    ['timbre.warm', 'Warm / mellow / smooth', 'Warm / mellow / smooth'],
    ['timbre.dark', 'Dark / dull / heavy', 'Dark / dull / heavy'],
    ['timbre.harsh', 'Harsh / strident / forceful', 'Harsh / strident / forceful'],
    ['timbre.material', 'Material / sound-source', 'Material / sound-source'],
    ['timbre.mood', 'Mood / character', 'Mood / character'],
    ['timbre.density', 'Density', 'Density (tone colour)'],
  ]],
  ['texture', 'Texture', '#a78bfa', [
    ['texture.type', 'Texture type', 'Texture type (named)'],
    ['texture.role', 'Layer role', null],
    ['texture.layers', 'Layer relationship & count', 'Layer relationship & count'],
    ['texture.density', 'Density', 'Density'],
    ['texture.devices', 'Compositional-device textures', 'Compositional-device textures'],
  ]],
  ['structure', 'Structure', '#f97316', [
    ['structure.phrase', 'Phrase & form shape', 'Phrase & form shape'],
    ['structure.repetition', 'Repetition & recurring material', 'Repetition & recurring material'],
    ['structure.development', 'Development of ideas', 'Development of ideas'],
    ['structure.imitation', 'Imitative / canonic devices', 'Imitative / canonic devices'],
    ['structure.contrast', 'Contrast / variety', 'Contrast / variety'],
    ['structure.unity', 'Unity / cohesion', 'Unity / cohesion'],
    ['structure.balance', 'Balance & symmetry', 'Balance & symmetry'],
  ]],
]

// Lists the word bank has no equivalent for, because it is a bank of describing
// words rather than a taxonomy of forces, a dynamic ladder, or a split of the
// Italian markings by the concept they belong to. Edit these here.
const OWN = {
  'media.instrument': ['Brass', 'Guitar', 'Keyboard', 'Percussion', 'Strings', 'Synth / electronic', 'Voice', 'Woodwind'],
  'media.ensemble': ['A cappella', 'Big band', 'Chamber ensemble', 'Choir', 'Concert band', 'Duet', 'Orchestra', 'Quartet', 'Quintet', 'Rock band', 'Solo', 'String orchestra', 'Trio', 'Vocal ensemble'],
  'media.production': ['Blowing', 'Bowing', 'Electronic', 'Plucking', 'Singing', 'Striking'],
  'texture.role': ['Accompaniment', 'Bass line', 'Counter-melody', 'Melody', 'Pad / drone', 'Rhythmic'],
  'dynamics.volume': ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'],
  'dynamics.italian': ['Crescendo', 'Decrescendo', 'Diminuendo', 'Dynamic letter levels (ppp–ff)', 'Fortepiano (fp)', 'Sforzando (sfz)', 'Sfzp'],
  'expressive.italian': ['‘Breathing’ marks', 'Ad libitum', 'Cantabile', 'Con forza', 'Con sordino (mute)', 'Delicatamente', 'Dolce', 'Espressivo', 'Grazioso', 'Leggierissimo', 'Leggiero', 'Semplice', 'Senza misura', 'Senza sordino', 'Senza vibrato', 'Sotto voce'],
}

// Notion categories the app deliberately does not draw from directly, so the
// unmapped report stays quiet about them. The bank keeps every Italian marking
// in one pile; the app splits it by concept into two OWN lists above, because
// "@dolce" and "@cresc" belong in different places.
const SPLIT_BY_HAND = new Set(['Performance directions (Italian)'])

// A term the bank writes as alternatives ("slurred / slurs") becomes one option
// each, so every word is its own tag and its own search hit. These few would
// lose their noun if split that way, so they are spelled out.
const SPLIT_OVERRIDES = {
  'contrary / similar / parallel motion': ['Contrary motion', 'Similar motion', 'Parallel motion'],
  'narrow / limited range': ['Narrow range', 'Limited range'],
  'snap pizzicato / Bartok pizz.': ['Snap pizzicato', 'Bartók pizz.'],
  'snap pizzicato / Bartók pizz.': ['Snap pizzicato', 'Bartók pizz.'],
  'jete bowing': ['Jeté bowing'],
  'jeté bowing': ['Jeté bowing'],
  'dynamic letter levels (ppp-ff)': ['Dynamic letter levels (ppp–ff)'],
  'dynamic letter levels (ppp–ff)': ['Dynamic letter levels (ppp–ff)'],
  'ad libitum / senza misura / breathing marks': ['Ad libitum', 'Senza misura', '‘Breathing’ marks'],
  'ad libitum / senza misura / ‘breathing’ marks': ['Ad libitum', 'Senza misura', '‘Breathing’ marks'],
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const check = args.includes('--check')
const soft = args.includes('--soft')

/** Give up without failing the caller — `--soft` only. */
function bail(message) {
  console.warn(`vocabulary sync skipped: ${message}`)
  process.exit(0)
}
const fromIndex = args.indexOf('--from')
const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : null

/** Every row of the database as `{ term, category, concept }`. */
async function fetchRows() {
  const token = process.env.NOTION_TOKEN
  if (!token) {
    if (soft) bail('NOTION_TOKEN is not set — using the committed vocabulary')
    console.error(
      'NOTION_TOKEN is not set. Create an internal integration at\n' +
        'https://www.notion.so/my-integrations, share the vocabulary database\n' +
        'with it, and add NOTION_TOKEN=secret_… to .env.local.',
    )
    process.exit(1)
  }
  const rows = []
  let cursor
  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
      },
    )
    if (!res.ok) {
      const body = await res.text()
      if (soft) bail(`Notion ${res.status} — using the committed vocabulary`)
      console.error(`Notion ${res.status}: ${body}`)
      process.exit(1)
    }
    const page = await res.json()
    for (const r of page.results) {
      const p = r.properties ?? {}
      rows.push({
        term: (p.Term?.title ?? []).map((t) => t.plain_text).join('').trim(),
        category: p.Category?.select?.name ?? '',
        concept: p.Concept?.select?.name ?? '',
      })
    }
    cursor = page.has_more ? page.next_cursor : undefined
  } while (cursor)
  return rows.filter((r) => r.term)
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** One bank term → the options it becomes. */
function optionsFor(term) {
  const t = term.trim()
  return SPLIT_OVERRIDES[t] ?? t.split(' / ').map((part) => cap(part.trim()))
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function buildFile(rows) {
  const byNotionCategory = new Map()
  for (const row of rows) {
    if (!byNotionCategory.has(row.category)) byNotionCategory.set(row.category, [])
    byNotionCategory.get(row.category).push(row.term)
  }
  const mapped = new Set(
    CATEGORIES.flatMap(([, , , fields]) => fields.map(([, , src]) => src).filter(Boolean)),
  )
  const unmapped = [...byNotionCategory.keys()].filter(
    (c) => c && !mapped.has(c) && !SPLIT_BY_HAND.has(c),
  )

  let body = ''
  let count = 0
  for (const [id, label, color, fields] of CATEGORIES) {
    body += `  {\n    id: ${quote(id)},\n    color: ${quote(color)},\n    label: ${quote(label)},\n    fields: [\n`
    for (const [fieldId, fieldLabel, source] of fields) {
      let options
      if (source) {
        const terms = byNotionCategory.get(source)
        if (!terms) {
          console.error(`Notion has no category "${source}" (for ${fieldId}).`)
          process.exit(1)
        }
        options = []
        for (const term of terms) {
          for (const option of optionsFor(term)) {
            if (!options.includes(option)) options.push(option)
          }
        }
        options.sort((a, b) => a.localeCompare(b))
      } else {
        options = OWN[fieldId]
        if (!options) {
          console.error(`No OWN list for ${fieldId}.`)
          process.exit(1)
        }
      }
      count += options.length
      const inline = `options: [${options.map(quote).join(', ')}],`
      body += `      {\n        id: ${quote(fieldId)},\n        label: ${quote(fieldLabel)},\n`
      body +=
        inline.length <= 86
          ? `        ${inline}\n`
          : `        options: [\n${options.map((o) => `          ${quote(o)},`).join('\n')}\n        ],\n`
      body += `        allowCustom: true,\n      },\n`
    }
    body += `    ],\n  },\n`
  }

  const header = `// GENERATED FILE — do not edit by hand.
//
// The words come from the "Concept vocabulary — HSC & Trial sample answers"
// database in Notion; the categories, colours, field order and the lists the
// bank has no equivalent for come from scripts/sync-vocabulary.mjs. Change a
// word in Notion, or the shape in that script, then run:
//
//   npm run sync:vocab
//
// See lib/musicElements.ts for what these feed, and lib/propertyTags.ts for
// AUTO_TERMS, which is the one list that must be maintained alongside this one.
import type { ElementCategory } from './musicElements'

export const ELEMENTS: ElementCategory[] = [
`
  return { source: header + body + ']\n', count, unmapped }
}

let rows
try {
  rows = fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : await fetchRows()
} catch (e) {
  if (soft) bail(`${e.message} — using the committed vocabulary`)
  throw e
}
if (rows.length === 0) {
  // An empty pull is far more likely to be a permissions problem than a really
  // empty database, and writing it out would silently wipe the vocabulary.
  if (soft) bail('Notion returned no rows — using the committed vocabulary')
  console.error('Notion returned no rows. Is the database shared with the integration?')
  process.exit(1)
}

const { source, count, unmapped } = buildFile(rows)

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
const after = values(source)
const added = [...after].filter((v) => !before.has(v))
const removed = [...before].filter((v) => !after.has(v))

console.log(`${rows.length} terms in Notion → ${count} options across ${CATEGORIES.length} categories`)
if (added.length) console.log(`  + ${added.join(', ')}`)
if (removed.length) console.log(`  − ${removed.join(', ')}`)
if (!added.length && !removed.length) console.log('  no change')
if (unmapped.length) {
  console.log(
    `\nNot in the app — add a field for each in CATEGORIES to include it:\n  ${unmapped.join('\n  ')}`,
  )
}

// AUTO_TERMS (the words that tag themselves as you type) names values by hand,
// so a word renamed or dropped in Notion can leave a dead entry behind. Say so
// rather than letting it fail silently.
const auto = readFileSync(PROPERTY_TAGS, 'utf8')
  .slice(readFileSync(PROPERTY_TAGS, 'utf8').indexOf('const AUTO_TERMS = ['))
const autoList = auto.slice(0, auto.indexOf('\n]'))
const dead = [...autoList.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
  .map((m) => m[1])
  .filter((term) => !after.has(term))
if (dead.length) {
  console.log(
    `\nAUTO_TERMS in src/lib/propertyTags.ts names ${dead.length} word(s) the\n` +
      `vocabulary no longer has — remove or rename them there:\n  ${dead.join(', ')}`,
  )
}

if (check) {
  if (source !== previous) {
    console.error('\nvocabulary.generated.ts is out of date — run npm run sync:vocab')
    process.exit(1)
  }
  process.exit(0)
}

if (source === previous) process.exit(0)
writeFileSync(GENERATED, source)
console.log(`\nWrote ${GENERATED.pathname.split('/').pop()}.`)
