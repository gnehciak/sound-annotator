// Firestore rules tests for sharing + the edit lock (firestore.rules).
// Run under the emulator:  npm run test:rules
//   (firebase emulators:exec --only firestore "node scripts/test-firestore-rules.mjs")
import { readFileSync } from 'node:fs'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  Timestamp,
} from 'firebase/firestore'

const OWNER = 'owner-uid'
const VISITOR = 'visitor-uid'

// Lock heartbeats: rules treat a lock as live for 40s.
const fresh = () => Timestamp.now()
const stale = () => Timestamp.fromMillis(Date.now() - 60_000)
const lockOf = (sessionId, uid, at) => ({ sessionId, uid, name: 'x', at })

const baseDoc = (over = {}) => ({
  ownerId: OWNER,
  title: 'Track',
  annotations: [],
  updatedAt: 1,
  shared: false,
  editableByLink: false,
  folderId: null,
  ...over,
})

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name}\n    ${err.message ?? err}`)
  }
}

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
})

// Seed docs with rules disabled.
async function seed(id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'projects', id), data)
  })
}

const anon = env.unauthenticatedContext().firestore()
const owner = env.authenticatedContext(OWNER).firestore()
const visitor = env.authenticatedContext(VISITOR).firestore()

console.log('reads')
await seed('private', baseDoc())
await seed('viewable', baseDoc({ shared: true }))
await seed('editable', baseDoc({ shared: true, editableByLink: true }))
await seed('legacy', (() => {
  const d = baseDoc({ shared: true })
  delete d.editableByLink // docs from before link editing existed
  return d
})())

await check('stranger cannot read a private project', () =>
  assertFails(getDoc(doc(anon, 'projects', 'private'))))
await check('stranger can read a shared project', () =>
  assertSucceeds(getDoc(doc(anon, 'projects', 'viewable'))))
await check('stranger can read an editable project', () =>
  assertSucceeds(getDoc(doc(anon, 'projects', 'editable'))))
await check('owner can read a legacy doc (no editableByLink key)', () =>
  assertSucceeds(getDoc(doc(owner, 'projects', 'legacy'))))
await check('stranger can read a legacy shared doc', () =>
  assertSucceeds(getDoc(doc(anon, 'projects', 'legacy'))))

console.log('link editing — permission gates')
await check('signed-in visitor cannot edit a view-only share', () =>
  assertFails(updateDoc(doc(visitor, 'projects', 'viewable'), {
    title: 'hijack',
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('unauthenticated cannot edit an editable share', () =>
  assertFails(updateDoc(doc(anon, 'projects', 'editable'), {
    title: 'hijack',
    lock: lockOf('a1', 'anon', fresh()),
  })))
await check('visitor can edit content with a lock claim (free lock)', () =>
  assertSucceeds(updateDoc(doc(visitor, 'projects', 'editable'), {
    title: 'edited',
    annotations: [{ id: 'n1' }],
    updatedAt: 2,
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('visitor cannot flip editableByLink', () =>
  assertFails(updateDoc(doc(visitor, 'projects', 'editable'), {
    editableByLink: false,
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('visitor cannot reassign ownerId', () =>
  assertFails(updateDoc(doc(visitor, 'projects', 'editable'), {
    ownerId: VISITOR,
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('visitor cannot change the source', () =>
  assertFails(updateDoc(doc(visitor, 'projects', 'editable'), {
    source: { type: 'youtube', videoId: 'x' },
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('visitor cannot move it between folders', () =>
  assertFails(updateDoc(doc(visitor, 'projects', 'editable'), {
    folderId: 'f1',
    lock: lockOf('v1', VISITOR, fresh()),
  })))
await check('visitor cannot delete it', () =>
  assertFails(import('firebase/firestore').then(({ deleteDoc }) =>
    deleteDoc(doc(visitor, 'projects', 'editable')))))

console.log('the edit lock')
await seed('locked', baseDoc({
  shared: true,
  editableByLink: true,
  lock: lockOf('held-session', VISITOR, fresh()),
}))
await check('content write from another session is refused while a lock is live', () =>
  assertFails(updateDoc(doc(owner, 'projects', 'locked'), {
    title: 'clobber',
    lock: lockOf('owner-session', OWNER, fresh()),
  })))
await check('content write without any lock claim is refused while a lock is live', () =>
  assertFails(updateDoc(doc(owner, 'projects', 'locked'), {
    title: 'clobber',
  })))
await check('the lock holder can write content (same session)', () =>
  assertSucceeds(updateDoc(doc(visitor, 'projects', 'locked'), {
    title: 'mine',
    updatedAt: 3,
    lock: lockOf('held-session', VISITOR, fresh()),
  })))
await check('lock-only write (take over) is allowed despite a live lock', () =>
  assertSucceeds(updateDoc(doc(owner, 'projects', 'locked'), {
    lock: lockOf('owner-session', OWNER, fresh()),
  })))
await check('lock-only release (null) is allowed', () =>
  assertSucceeds(updateDoc(doc(owner, 'projects', 'locked'), {
    lock: null,
  })))

await seed('stale-lock', baseDoc({
  shared: true,
  editableByLink: true,
  lock: lockOf('dead-session', VISITOR, stale()),
}))
await check('a stale lock can be claimed over by a content write', () =>
  assertSucceeds(updateDoc(doc(owner, 'projects', 'stale-lock'), {
    title: 'reclaimed',
    lock: lockOf('owner-session', OWNER, fresh()),
  })))

console.log('owner powers around the lock')
await seed('busy', baseDoc({
  shared: true,
  editableByLink: true,
  lock: lockOf('editor-session', VISITOR, fresh()),
}))
await check('owner can still toggle sharing while someone edits', () =>
  assertSucceeds(updateDoc(doc(owner, 'projects', 'busy'), {
    shared: false,
    editableByLink: false,
    updatedAt: 4,
  })))
await check('owner can move folders while someone edits', () =>
  assertSucceeds(updateDoc(doc(owner, 'projects', 'busy'), {
    folderId: 'f9',
    updatedAt: 5,
  })))
await check('owner content write on own free project works with their claim', async () => {
  await seed('own-free', baseDoc())
  await assertSucceeds(updateDoc(doc(owner, 'projects', 'own-free'), {
    title: 'renamed',
    updatedAt: 6,
    lock: lockOf('owner-session', OWNER, fresh()),
  }))
})
await check('owner content write on a legacy doc without lock involvement works', async () => {
  // The full pre-lock save shape: every field, no lock — must keep working.
  await assertSucceeds(setDoc(doc(owner, 'projects', 'legacy'), baseDoc({
    shared: true,
    title: 'legacy rename',
    updatedAt: 7,
  })))
})
await check('owner can remove the lock field entirely', async () => {
  await seed('lock-cleanup', baseDoc({ lock: lockOf('s', OWNER, stale()) }))
  await assertSucceeds(updateDoc(doc(owner, 'projects', 'lock-cleanup'), {
    lock: deleteField(),
  }))
})

console.log('creates')
await check('create with own ownerId (lock riding along) is allowed', () =>
  assertSucceeds(setDoc(doc(owner, 'projects', 'new-one'), baseDoc({
    lock: lockOf('owner-session', OWNER, fresh()),
  }))))
await check('create with someone else\'s ownerId is refused', () =>
  assertFails(setDoc(doc(visitor, 'projects', 'forged'), baseDoc())))

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
