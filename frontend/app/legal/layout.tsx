import type { ReactNode } from "react"

// Shared shell for every page under /legal/*. Provides a narrow, readable
// column, dark-mode prose, and consistent heading/paragraph styling via
// descendant selectors so individual page files stay free of class noise.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 ob-body text-ob-on-surface">
      <div className="legal-prose space-y-6 text-sm leading-relaxed text-ob-on-surface-variant">
        {children}
      </div>
      <style>{`
        .legal-prose h1 {
          font-family: var(--font-cinzel), serif;
          font-weight: 700;
          font-size: 2rem;
          line-height: 1.15;
          color: var(--color-ob-primary);
          letter-spacing: 0.02em;
          margin-bottom: 0.25rem;
        }
        .legal-prose .legal-updated {
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--color-ob-outline);
          margin-bottom: 2rem;
        }
        .legal-prose h2 {
          font-family: var(--font-cinzel), serif;
          font-weight: 600;
          font-size: 1.25rem;
          color: var(--color-ob-primary);
          letter-spacing: 0.01em;
          margin-top: 2.5rem;
          margin-bottom: 0.75rem;
        }
        .legal-prose h3 {
          font-weight: 600;
          font-size: 0.95rem;
          color: var(--color-ob-on-surface);
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .legal-prose p {
          margin-bottom: 0.9rem;
        }
        .legal-prose ul {
          list-style: disc;
          padding-left: 1.25rem;
          margin-bottom: 0.9rem;
        }
        .legal-prose ol {
          list-style: decimal;
          padding-left: 1.25rem;
          margin-bottom: 0.9rem;
        }
        .legal-prose li {
          margin-bottom: 0.35rem;
        }
        .legal-prose a {
          color: var(--color-ob-primary);
          text-decoration: underline;
          text-decoration-color: color-mix(in srgb, var(--color-ob-primary) 40%, transparent);
          text-underline-offset: 2px;
          transition: text-decoration-color 150ms ease;
        }
        .legal-prose a:hover {
          text-decoration-color: var(--color-ob-primary);
        }
        .legal-prose strong {
          color: var(--color-ob-on-surface);
          font-weight: 600;
        }
        .legal-prose code {
          background: color-mix(in srgb, var(--color-ob-surface-container-low) 80%, transparent);
          border: 1px solid color-mix(in srgb, var(--color-ob-outline-variant) 30%, transparent);
          padding: 0.05rem 0.35rem;
          border-radius: 0.25rem;
          font-size: 0.85em;
        }
      `}</style>
    </main>
  )
}
