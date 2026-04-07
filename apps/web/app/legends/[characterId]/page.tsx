import type { Metadata } from "next"

interface Props {
  params: Promise<{ characterId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { characterId } = await params
  // TODO: fetch legend data from API
  return {
    title: `Legend — Adventure.fun`,
    description: `A fallen character's story on Adventure.fun`,
    openGraph: {
      images: [`/api/cards/death/${characterId}.png`],
    },
    twitter: {
      card: "summary_large_image",
    },
  }
}

export default async function LegendPage({ params }: Props) {
  const { characterId } = await params
  // TODO: fetch from /legends/:characterId

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="border border-gray-700 rounded p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">☠️</span>
            <div>
              <h1 className="text-2xl font-bold text-amber-400">FALLEN LEGEND</h1>
              <p className="text-gray-500 text-sm font-mono">{characterId}</p>
            </div>
          </div>
          <p className="text-gray-500">Legend data loading... (API not yet connected)</p>
        </div>
      </div>
    </main>
  )
}
