// Firebase singletons. Config comes from VITE_FIREBASE_* env vars (see
// .env.example). Until those are filled in, `firebaseReady` is false and the
// app shows a setup screen instead of crashing.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firebaseReady = Boolean(config.apiKey && config.projectId)

let app: FirebaseApp | undefined
let authInstance: Auth | undefined
let dbInstance: Firestore | undefined
let storageInstance: FirebaseStorage | undefined

if (firebaseReady) {
  app = initializeApp(config as Required<typeof config>)
  authInstance = getAuth(app)
  // Offline cache keeps the app working without a connection (and across tabs),
  // preserving the app's original offline-first feel.
  dbInstance = initializeFirestore(app, {
    // Notes have optional fields (end/tag/color) that are often undefined;
    // let Firestore omit them rather than throw.
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  })
  storageInstance = getStorage(app)
}

// These are only ever touched once firebaseReady is true (the Gate enforces it),
// so the non-null assertions are safe in practice.
export const auth = authInstance as Auth
export const db = dbInstance as Firestore
export const storage = storageInstance as FirebaseStorage
export const googleProvider = new GoogleAuthProvider()
