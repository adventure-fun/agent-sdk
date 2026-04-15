import type { Metadata } from "next"
import { LegendPageClient } from "./legend-page-client"
import { buildMetadata } from "../../lib/metadata"
import { titleCase } from "../../lib/format"
import { fetchLegendForCard } from "../../api/og/_lib/data"

interface Props {
  params: Promise<{ characterId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { characterId } = await params
  const legend = await fetchLegendForCard(characterId)

  if (!legend) {
    return buildMetadata({
      title: "Legend",
      description: "A fallen character's story on Adventure.fun.",
      path: `/legends/${characterId}`,
      image: "/og/default.png",
      type: "article",
    })
  }

  const { character, history } = legend
  const classTitle = titleCase(character.class)
  const description = `${character.name} (Lv ${character.level} ${classTitle}) fell on Floor ${history.death_floor} to ${history.cause_of_death}. Read their legend on Adventure.fun.`

  return buildMetadata({
    title: `Legend of ${character.name}`,
    description,
    path: `/legends/${characterId}`,
    image: `/api/og/legend/${characterId}`,
    imageAlt: `Legend of ${character.name} — fallen ${classTitle}`,
    type: "article",
  })
}

export default async function LegendPage({ params }: Props) {
  const { characterId } = await params
  return <LegendPageClient characterId={characterId} />
}
