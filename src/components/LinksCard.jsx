import React from 'react'
import CollapseButton from './CollapseButton.jsx'
import styles from './LinksCard.module.css'

const LINKS = [
  { label: 'Website',       url: 'https://kendu.io',                          desc: 'Official Kendu website' },
  { label: 'Twitter / X',   url: 'https://x.com/KenduInu',                    desc: 'Official X account' },
  { label: 'Telegram',      url: 'https://t.me/KenduInu',                     desc: 'Community Telegram' },
  { label: 'Dexscreener',   url: 'https://dexscreener.com/ethereum/0xd9f2a7471d1998c69de5cae6df5d3f070f01df9f', desc: 'ETH pair chart' },
  { label: 'Etherscan',     url: 'https://etherscan.io/token/0xaa95f26e30001251fb905d264Aa7b00eE9dF6C18', desc: 'ETH contract' },
  { label: 'Solscan',       url: 'https://solscan.io',                        desc: 'SOL contract' },
  { label: 'Basescan',      url: 'https://basescan.org',                      desc: 'BASE contract' },
  { label: 'Uniswap',       url: 'https://app.uniswap.org',                   desc: 'Trade on Uniswap' },
  { label: 'Conviction',    url: 'https://kenduconviction.com',                desc: 'Kendu Conviction' },
  { label: 'Spice',         url: 'https://kenduspice.com',                     desc: 'Kendu Spice' },
  { label: 'Energy',        url: 'https://kenduenergy.com',                    desc: 'Kendu Energy' },
  { label: 'Kendu Surprise',url: 'https://www.youtube.com/watch?v=a7Lq6ZlSqys', desc: '👀 👀 👀 👀' },
]

export default function LinksCard({ collapsed, onToggle }) {
  return (
    <div className={`k-card ${styles.wrap}`}>
      <div className={styles.head}>
        <div>
          <div className="k-eyebrow">Resources</div>
          <div className={styles.title}>Links</div>
        </div>
        <div className="k-head-actions">
          <CollapseButton collapsed={collapsed} onToggle={onToggle} />
        </div>
      </div>

      <div className={`k-body${collapsed ? ' k-collapsed' : ''}`}><div className="k-body-inner">
        <div className={styles.grid}>
          {LINKS.map(({ label, url, desc }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <span className={styles.linkLabel}>{label}</span>
              <span className={styles.linkDesc}>{desc}</span>
              <span className={styles.linkArrow}>↗</span>
            </a>
          ))}
        </div>
      </div></div>
    </div>
  )
}
