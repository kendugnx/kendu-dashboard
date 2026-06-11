import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export default function handler(req, res) {
  const path = join(process.cwd(), 'public', 'modern-family.mp4')
  if (!existsSync(path)) {
    return res.status(404).send(`NOT FOUND: ${path}`)
  }
  try {
    const file = readFileSync(path)
    res.setHeader('Content-Type', 'video/mp4')
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    res.send(file)
  } catch (e) {
    res.status(500).send(`ERROR: ${e.message}`)
  }
}
