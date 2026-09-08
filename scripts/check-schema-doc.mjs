#!/usr/bin/env node
// Guards the published track-file schema against drift.
//
// `public/track-schema.md` is handed to teachers (and to AI assistants) as the
// spec for the JSON that Import reads. A spec nobody enforces goes stale the
// first time someone adds a field, so this runs as the first step of
// `npm run build`: a schema change that skips the doc breaks the deploy.
//
// Three things are checked, all of them derived — nothing here is a list you
// have to remember to update:
//
//   1. Every property on Project / ProjectSource / Annotation / NoteBlock /
//      NoteOverlay / ProjectSettings in src/types.ts is documented in the doc,
//      either in its interface's field table or (for Project's row state) in
//      the explicit "deliberately not in the file" table.
//   2. Nothing is documented that no longer exists — catches renames.
//   3. Every documented, *exported* field is actually named in
//      src/lib/projectJson.ts, so the maintenance contract at the top of that
//      file ("teach the sanitizer about the new field") can't be half-done.
//      ProjectSettings is exempt: primitive keys pass through generically.
//
// The doc's `<!-- fields: X -->` … `<!-- /fields -->` markers delimit the
// tables this reads; field names are the first cell of each table row.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = 'public/track-schema.md'
const TYPES = 'src/types.ts'
const JSON_LIB = 'src/lib/projectJson.ts'

/** Interfaces whose shape the doc must cover, in the order they're reported. */
const COVERED = [
  'Project',
  'ProjectSource',
  'Annotation',
  'NoteBlock',
  'NoteOverlay',
  'ProjectSettings',
]
/** Interfaces whose fields need no line in the sanitizer (see note 3 above). */
const SANITIZER_EXEMPT = new Set(['ProjectSettings'])

const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** Property names declared on each interface of interest in src/types.ts. */
function interfaceFields(source) {
  const file = ts.createSourceFile(TYPES, source, ts.ScriptTarget.Latest, true)
  const found = new Map()
  for (const node of file.statements) {
    if (!ts.isInterfaceDeclaration(node)) continue
    const name = node.name.text
    if (!COVERED.includes(name)) continue
    const fields = node.members
      .filter((m) => ts.isPropertySignature(m) && ts.isIdentifier(m.name))
      .map((m) => m.name.text)
    found.set(name, fields)
  }
  return found
}

/**
 * Field names documented under each `<!-- fields: X -->` marker — the first
 * cell of every table row, which is where the doc puts the field name.
 */
function documentedFields(doc) {
  const sections = new Map()
  const re = /<!--\s*fields:\s*([\w.]+)\s*-->([\s\S]*?)<!--\s*\/fields\s*-->/g
  for (const [, name, body] of doc.matchAll(re)) {
    const fields = [...body.matchAll(/^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/gm)].map((m) => m[1])
    sections.set(name, fields)
  }
  return sections
}

const types = read(TYPES)
const doc = read(DOC)
const jsonLib = read(JSON_LIB)

const declared = interfaceFields(types)
const documented = documentedFields(doc)
const errors = []

for (const name of COVERED) {
  const fields = declared.get(name)
  if (!fields) {
    errors.push(`${TYPES} no longer declares \`interface ${name}\` — update ${import.meta.filename ?? 'this script'} and ${DOC}.`)
    continue
  }
  // Project splits across two tables: the exported envelope, and the row state
  // the file deliberately drops. A field must appear in exactly one of them.
  const inDoc = documented.get(name) ?? []
  const excluded = documented.get(`${name}.excluded`) ?? []
  if (!documented.has(name)) {
    errors.push(`${DOC} has no \`<!-- fields: ${name} -->\` section.`)
    continue
  }
  const covered = new Set([...inDoc, ...excluded])

  for (const field of fields) {
    if (!covered.has(field))
      errors.push(
        `${name}.${field} is declared in ${TYPES} but documented nowhere in ${DOC}. ` +
          `Add a row to the \`fields: ${name}\` table` +
          (name === 'Project' ? ` (or to \`fields: Project.excluded\` if it must never travel in a file).` : `.`),
      )
  }
  for (const field of covered) {
    if (!fields.includes(field))
      errors.push(
        `${DOC} documents ${name}.${field}, which no longer exists in ${TYPES}. Remove or rename that row.`,
      )
  }
  if (SANITIZER_EXEMPT.has(name)) continue
  for (const field of inDoc) {
    if (!new RegExp(`\\b${field}\\b`).test(jsonLib))
      errors.push(
        `${name}.${field} is documented as exported but never appears in ${JSON_LIB}. ` +
          `Add it to the export envelope and the import sanitizer, or it silently drops on round trip.`,
      )
  }
}

// The doc quotes the envelope's format string and version number; both must
// still be the ones the app writes and accepts.
const format = jsonLib.match(/PROJECT_JSON_FORMAT\s*=\s*'([^']+)'/)?.[1]
const version = jsonLib.match(/PROJECT_JSON_VERSION\s*=\s*(\d+)/)?.[1]
if (format && !doc.includes(`"format": "${format}"`))
  errors.push(`${DOC} never shows \`"format": "${format}"\` — the envelope literal changed.`)
if (version && !doc.includes(`"version": ${version}`))
  errors.push(`${DOC} never shows \`"version": ${version}\` — PROJECT_JSON_VERSION changed.`)

if (errors.length > 0) {
  console.error(`\n${DOC} is out of date with ${TYPES}:\n`)
  for (const e of errors) console.error(`  • ${e}`)
  console.error(
    `\nThat file is published at /track-schema.md and is what people hand to an ` +
      `AI assistant to author track files, so it has to describe the current shape.\n`,
  )
  process.exit(1)
}

const total = [...declared.values()].reduce((n, f) => n + f.length, 0)
console.log(`${DOC} is in step with ${TYPES} (${total} fields across ${COVERED.length} interfaces).`)
