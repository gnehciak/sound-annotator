import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const pages = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['a-record-wall', 'b-cue-sheet', 'c-music-room', 'd-liner-notes']

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
for (const name of pages) {
  const page = await ctx.newPage()
  await page.goto('file://' + path.join(dir, name + '.html'), { waitUntil: 'networkidle' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true })
  await page.close()
  console.log('shot', name)
}
await browser.close()
