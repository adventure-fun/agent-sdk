import type { ReactNode } from "react"

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-aw-bg aw-label">
      <div className={`${wide ? "max-w-lg" : "max-w-md"} w-full text-center space-y-6`}>
        {children}
      </div>
    </main>
  )
}
