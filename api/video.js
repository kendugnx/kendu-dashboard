import { readFileSync } from 'fs'
import { join } from 'path'

export default function handler(req, res) {
  const file = readFileSync(join(__dirname, 'modern-family.mp4'))
  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Cache-Control', 'public, max-age=31536000')
  res.send(file)
}
