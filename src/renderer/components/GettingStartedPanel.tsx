import React from 'react'

/**
 * Right-rail "Getting Started" card stack shown before any scan exists.
 * Three groups stacked top-to-bottom:
 *
 *   1. 3 Simple Steps  — numbered walkthrough
 *   2. Why scan?       — checklist of value props
 *   3. Privacy footer  — single-line "Scans stay on this Mac" reassurance
 *
 * DetailsPanel takes over once a tree is loaded, so this view is purely
 * pre-scan onboarding.
 */
export function GettingStartedPanel(): JSX.Element {
  return (
    <div className="getting-started">
      <div className="gs-section-title">Getting Started</div>

      <div className="gs-card">
        <div className="gs-card-head">
          <span className="gs-card-icon star" aria-hidden="true">★</span>
          <span className="gs-card-title">3 Simple Steps</span>
        </div>
        <Step
          n={1}
          icon={<FolderIcon />}
          title="Choose a folder"
          body="Select a folder or scan your entire disk."
        />
        <Step
          n={2}
          icon={<ListIcon />}
          title="Review results"
          body="Explore results and see what's taking up space."
        />
        <Step
          n={3}
          icon={<BroomIcon />}
          title="Clean up safely"
          body="Remove what you don't need. Your data stays in your control."
        />
      </div>

      <div className="gs-card">
        <div className="gs-card-head">
          <span className="gs-card-icon shield" aria-hidden="true">✓</span>
          <span className="gs-card-title">Why scan?</span>
        </div>
        <Bullet
          title="Find space hogs"
          body="Identify hidden large files."
        />
        <Bullet
          title="Remove duplicates"
          body="Get rid of unnecessary copies."
        />
        <Bullet
          title="Keep important files safe"
          body="You decide what to delete."
        />
      </div>

      <div className="gs-footer">
        <span className="gs-footer-icon" aria-hidden="true">🔒</span>
        <div className="gs-footer-text">
          <div className="gs-footer-title">Scans stay on this Mac</div>
          <div className="gs-footer-body">
            Your data never leaves your device.
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({
  n,
  icon,
  title,
  body
}: {
  n: number
  icon: React.ReactNode
  title: string
  body: string
}): JSX.Element {
  return (
    <div className="gs-step">
      <div className="gs-step-num">{n}</div>
      <div className="gs-step-icon">{icon}</div>
      <div className="gs-step-text">
        <div className="gs-step-title">{title}</div>
        <div className="gs-step-body">{body}</div>
      </div>
    </div>
  )
}

function Bullet({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="gs-bullet">
      <span className="gs-bullet-tick" aria-hidden="true">✓</span>
      <div className="gs-bullet-text">
        <div className="gs-bullet-title">{title}</div>
        <div className="gs-bullet-body">{body}</div>
      </div>
    </div>
  )
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function ListIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7 9h10M7 13h7M7 17h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BroomIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M14 4l6 6-3 3-6-6 3-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M11 7l-7 7 4 4 7-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4 14l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
