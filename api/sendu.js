import { completeWalletLink, createWalletChallenge } from '../lib/tipping.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { action, token, address, signature } = req.body || {}
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
    return res.status(400).json({ error: 'Invalid or expired wallet-link request' })
  }

  try {
    if (action === 'challenge') {
      const result = await createWalletChallenge(token, address)
      return res.status(200).json(result)
    }
    if (action === 'verify') {
      const result = await completeWalletLink(token, address, signature)
      return res.status(200).json(result)
    }
    return res.status(400).json({ error: 'Unknown Sendu action' })
  } catch (error) {
    console.error(`[sendu:api:${action || 'unknown'}] ${error.message}`)
    return res.status(400).json({ error: error.message || 'Sendu wallet linking failed' })
  }
}
