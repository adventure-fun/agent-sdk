import Link from "next/link"
import { SITE_NAME, TWITTER_HANDLE } from "../lib/metadata"

const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/risk", label: "Risk" },
  { href: "/legal/refunds", label: "Refunds" },
] as const

export function SiteFooter() {
  const year = new Date().getFullYear()
  const twitterUrl = `https://x.com/${TWITTER_HANDLE.replace(/^@/, "")}`

  return (
    <footer className="mt-16 border-t border-ob-outline-variant/20 bg-ob-bg/60 px-8 py-6 ob-body text-[11px] text-ob-on-surface-variant">
      <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
        <div className="ob-label uppercase tracking-[0.2em]">
          © {year} {SITE_NAME}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {LEGAL_LINKS.map((link, i) => (
            <span key={link.href} className="flex items-center gap-x-4">
              {i > 0 ? <span aria-hidden="true" className="text-ob-outline-variant/40">·</span> : null}
              <Link
                href={link.href}
                className="ob-label uppercase tracking-[0.2em] transition-colors hover:text-ob-primary"
              >
                {link.label}
              </Link>
            </span>
          ))}
          <span aria-hidden="true" className="text-ob-outline-variant/40">·</span>
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ob-label inline-flex items-center gap-1.5 uppercase tracking-[0.2em] transition-colors hover:text-ob-primary"
            aria-label={`Follow ${SITE_NAME} on X`}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="currentColor"
              className="h-3 w-3"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span>{TWITTER_HANDLE}</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
