// api/snapshot-image.js — headless-Chromium screenshot of the real
// SnapshotCard, for the Telegram bot's /snapshot command. Navigates to the
// hidden /embed/snapshot route (same component the website's modal uses),
// waits for it to report data-ready, then screenshots just the card.
//
// @sparticuz/chromium only unpacks its shared-library bundle (libnss3.so &
// co.) and sets LD_LIBRARY_PATH when it detects genuine AWS Lambda env vars
// (AWS_EXECUTION_ENV / AWS_LAMBDA_JS_RUNTIME). Vercel's functions don't set
// those, so without this the binary fails with "libnss3.so: cannot open
// shared object file". Spoofing the var before the module loads forces it
// down the same code path Lambda would take.
//
// The imports are dynamic (inside the handler, not top-level await) since
// Vercel's bundler choked on a top-level `await import()`.
const EMBED_URL = 'https://kendu-dashboard.com/embed/snapshot'

export default async function handler(req, res) {
  let browser
  try {
    if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
      process.env.AWS_LAMBDA_JS_RUNTIME = 'AWS_Lambda_nodejs20.x'
    }
    const chromium = (await import('@sparticuz/chromium')).default
    const puppeteer = (await import('puppeteer-core')).default

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
