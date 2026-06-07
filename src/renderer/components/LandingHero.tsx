import React from 'react'
import { useConfirm } from './Notices'
import landingHeroArt from '../assets/landing-hero.png'

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
        <img src={landingHeroArt} alt="" draggable={false} />
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

/** Hero illustration source PNG lives in `assets/landing-hero.png`. */

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
