import type { Metadata } from "next"
import { LegendPageClient } from "./legend-page-client"

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
  return <LegendPageClient characterId={characterId} />
}
