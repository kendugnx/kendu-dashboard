// api/snapshot-image.js — headless-Chromium screenshot of the real
// SnapshotCard, for the Telegram bot's /snapshot command. Navigates to the
// hidden /embed/snapshot route (same component the website's modal uses),
// waits for it to report data-ready, then screenshots just the card.
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const EMBED_URL = 'https://kendu-dashboard.com/embed/snapshot'

export default async function handler(req, res) {
  let browser
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 600, height: 800, deviceScaleFactor: 2 },
    })

    const page = await browser.newPage()
    await page.goto(EMBED_URL, { waitUntil: 'networkidle0', timeout: 20000 })
    await page.waitForSelector('[data-ready="true"]', { timeout: 15000 })

    const card = await page.$('[data-ready="true"]')
    const buffer = await card.screenshot({ type: 'png' })

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(buffer)
  } catch (e) {
    res.status(500).json({ error: e.message })
  } finally {
    if (browser) await browser.close()
  }
}
