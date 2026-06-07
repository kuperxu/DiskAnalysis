import React from 'react'
import { useConfirm } from './Notices'

/**
 * Pre-scan hero in the centre pane. Shows the marketing-style intro the user
 * sees before any scan exists: a 3D-flavoured illustration, the "Start with a
 * folder scan" headline, the two scan buttons, and the "Discover" cards row.
 *
 * The cards are decorative for now — they describe what the app can find but
 * don't yet drive a scan with that filter pre-applied. Wiring them to a
 * future scan-with-preset flow is a follow-up; the hero block survives
 * without it because the primary CTA is still the folder picker.
 */
export function LandingHero(): JSX.Element {
  const confirm = useConfirm((s) => s.ask)
  return (
    <div className="landing">
      <div className="landing-art">
        <HeroArt />
      </div>
      <h1 className="landing-title">Start with a folder scan</h1>
      <p className="landing-sub">
        Analyze large files, duplicates, and clutter to reclaim space safely.
      </p>
      <div className="landing-actions">
        <button
          className="primary landing-cta"
          onClick={async () => {
            const p = await window.api.pickRoot()
            if (p) await window.api.start(p)
          }}
        >
          <span className="folder-glyph" aria-hidden="true">📁</span>
          Choose a Folder to Scan
        </button>
        <button
          className="ghost landing-cta-secondary"
          onClick={async () => {
            const ok = await confirm({
              title: 'Scan the entire disk?',
              body:
                'Starts at "/". This may take a long time and requires ' +
                'Full Disk Access (System Settings → Privacy & Security → ' +
                'Full Disk Access) to see ~/Library and other protected ' +
                'folders. System paths and other mounted volumes are ' +
                'excluded automatically.',
              confirmLabel: 'Scan disk',
              cancelLabel: 'Cancel'
            })
            if (ok) await window.api.start('/')
          }}
        >
          <DiskIcon />
          Scan Entire Disk
        </button>
      </div>
      <div className="landing-divider">
        <span>Discover</span>
      </div>
      <div className="landing-cards">
        <DiscoverCard
          tone="document"
          icon={<DocIcon />}
          title="Large Files"
          body="Find big files taking up valuable space."
        />
        <DiscoverCard
          tone="duplicate"
          icon={<DupIcon />}
          title="Duplicates"
          body="Locate and remove duplicate files."
        />
        <DiscoverCard
          tone="cache"
          icon={<TrashIcon />}
          title="Cache & Logs"
          body="Clear temporary files and system clutter."
        />
      </div>
    </div>
  )
}

function DiscoverCard({
  tone,
  icon,
  title,
  body
}: {
  tone: string
  icon: React.ReactNode
  title: string
  body: string
}): JSX.Element {
  return (
    <div className={`discover-card tone-${tone}`}>
      <div className={`discover-card-icon tone-${tone}`}>{icon}</div>
      <div className="discover-card-text">
        <div className="discover-card-title">{title}</div>
        <div className="discover-card-body">{body}</div>
      </div>
    </div>
  )
}

/** Big folder + magnifier illustration with floating doc/image/chart sheets.
 *  CSS-painted with inline SVG so we don't ship a binary asset. */
function HeroArt(): JSX.Element {
  return (
    <svg
      viewBox="0 0 360 240"
      width="280"
      height="200"
      role="img"
      aria-label="Folder scan illustration"
    >
      <defs>
        <linearGradient id="hero-folder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="hero-disk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0b1220" />
        </linearGradient>
        <radialGradient id="hero-glow" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0)" />
        </radialGradient>
      </defs>

      {/* Soft glow */}
      <rect x="0" y="0" width="360" height="240" fill="url(#hero-glow)" />

      {/* Sparkles */}
      <g fill="#93c5fd">
        <circle cx="60" cy="40" r="2" />
        <circle cx="300" cy="38" r="2.4" />
        <circle cx="330" cy="100" r="1.8" />
        <circle cx="30" cy="120" r="1.6" />
        <circle cx="320" cy="170" r="1.6" />
        <circle cx="50" cy="190" r="1.6" />
      </g>

      {/* Floating doc sheets behind the folder */}
      <g transform="translate(120, 30)">
        {/* Pie chart sheet */}
        <rect x="-2" y="2" width="44" height="56" rx="4" fill="#1e293b" stroke="#334155" />
        <rect x="0" y="0" width="44" height="56" rx="4" fill="#1e3a8a" stroke="#3b82f6" />
        <circle cx="22" cy="22" r="10" fill="#0b1220" />
        <path d="M22 12 A10 10 0 0 1 32 22 L22 22 Z" fill="#60a5fa" />
        <path d="M32 22 A10 10 0 0 1 24 32 L22 22 Z" fill="#3b82f6" />
        <rect x="6" y="38" width="32" height="3" rx="1.5" fill="#475569" />
        <rect x="6" y="44" width="22" height="3" rx="1.5" fill="#334155" />
      </g>

      {/* Image sheet */}
      <g transform="translate(170, 14)">
        <rect x="-2" y="2" width="46" height="60" rx="4" fill="#1e293b" stroke="#334155" />
        <rect x="0" y="0" width="46" height="60" rx="4" fill="#1e3a8a" stroke="#3b82f6" />
        <rect x="4" y="4" width="38" height="36" rx="2" fill="#0b1220" />
        <circle cx="14" cy="16" r="3" fill="#fbbf24" />
        <path d="M4 40 L18 26 L28 36 L42 22 L42 40 Z" fill="#60a5fa" opacity="0.7" />
        <rect x="4" y="46" width="32" height="3" rx="1.5" fill="#475569" />
        <rect x="4" y="52" width="22" height="3" rx="1.5" fill="#334155" />
      </g>

      {/* Doc lines sheet */}
      <g transform="translate(220, 30)">
        <rect x="-2" y="2" width="44" height="56" rx="4" fill="#1e293b" stroke="#334155" />
        <rect x="0" y="0" width="44" height="56" rx="4" fill="#1e3a8a" stroke="#3b82f6" />
        <rect x="6" y="8" width="32" height="3" rx="1.5" fill="#60a5fa" />
        <rect x="6" y="16" width="28" height="3" rx="1.5" fill="#475569" />
        <rect x="6" y="24" width="32" height="3" rx="1.5" fill="#475569" />
        <rect x="6" y="32" width="20" height="3" rx="1.5" fill="#334155" />
        <rect x="6" y="40" width="28" height="3" rx="1.5" fill="#334155" />
      </g>

      {/* Disk slab */}
      <ellipse cx="180" cy="210" rx="100" ry="14" fill="url(#hero-disk)" />
      <rect x="100" y="170" width="160" height="28" rx="6" fill="url(#hero-disk)" stroke="#1e293b" />
      <circle cx="116" cy="184" r="2" fill="#475569" />
      <circle cx="124" cy="184" r="2" fill="#475569" />
      <circle cx="132" cy="184" r="2" fill="#475569" />

      {/* Front folder */}
      <path
        d="M120 110 Q120 100 130 100 L170 100 L182 110 L230 110 Q240 110 240 120 L240 178 Q240 188 230 188 L130 188 Q120 188 120 178 Z"
        fill="url(#hero-folder)"
        stroke="#1e40af"
      />

      {/* Magnifier */}
      <circle cx="180" cy="146" r="20" fill="none" stroke="#fff" strokeWidth="3.5" />
      <circle cx="180" cy="146" r="20" fill="rgba(147,197,253,0.15)" />
      <line
        x1="195"
        y1="161"
        x2="208"
        y2="174"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DocIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12h8M8 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** External drive / disk slab — used in the "Scan Entire Disk" CTA. */
function DiskIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="7"
        width="18"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="7" cy="12" r="1.2" fill="currentColor" />
      <path d="M11 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function DupIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <rect
        x="4"
        y="6"
        width="12"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="8"
        y="3"
        width="12"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="rgba(0,0,0,0.0)"
      />
    </svg>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
