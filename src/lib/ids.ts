/**
 * Short ids for anything that ends up in a URL.
 *
 * A project id is the whole credential for a `?view=` share link, so it has to
 * be unguessable — but `crypto.randomUUID()` spends 36 characters to carry 122
 * bits, and four of those characters are dashes. That made share links ~69
 * characters and guest links ~118, long enough that ad blockers treat them as
 * tracking payloads and students can't read one aloud.
 *
 * 9 random bytes encode to exactly 12 base64url characters with no padding —
 * 72 bits, one character longer than a YouTube video id. Nothing can verify a
 * guess offline: an attacker has to ask the server about each one. At a
 * sustained thousand requests a second against ~80 live projects, finding any
 * single valid id takes on the order of 10^11 years, so the 50 bits given up
 * against a uuid buy a 24-character-shorter link and cost nothing real.
 *
 * Ids are opaque strings in a `text` column, so old uuid rows keep working
 * untouched and every link already handed out keeps resolving. Never parse an
 * id or assume its shape.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
