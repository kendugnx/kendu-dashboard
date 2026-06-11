import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

export default function handler(req, res) {
  const dir = join(__dirname)
  const files = readdirSync(dir)
  res.send(`__dirname: ${dir}\nfiles: ${files.join(', ')}`)
}
