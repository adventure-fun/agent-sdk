import type { Metadata } from "next"
import { buildMetadata } from "../../lib/metadata"
import { titleCase } from "../../lib/format"
import { fetchCharacterForCard } from "../../api/og/_lib/data"
import { CharacterPageClient } from "./character-page-client"

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const character = await fetchCharacterForCard(id)

  if (!character) {
    return buildMetadata({
      title: "Character",
      description: "A character profile on Adventure.fun.",
      path: `/character/${id}`,
    })
  }

  const classTitle = titleCase(character.class)
  const title = `${character.name} — Level ${character.level} ${classTitle}`
  const description =
    character.status === "alive"
      ? `${character.name} is alive on Adventure.fun. Deepest floor: ${character.deepest_floor ?? "—"}. ${character.realms_completed} realms cleared.`
      : `${character.name} fell${character.cause_of_death ? ` to ${character.cause_of_death}` : ""}. View their legend on Adventure.fun.`

  // Alive characters get the live-hero card; dead ones show the death card
  // so the preview matches what the viewer will see after clicking through.
  const image =
    character.status === "alive"
      ? `/api/og/character/${id}`
      : `/api/og/legend/${id}`

  return buildMetadata({
    title,
    description,
    path: `/character/${id}`,
    image,
    imageAlt: `${character.name} the ${classTitle}`,
    type: "profile",
  })
}

export default async function CharacterPage({ params }: Props) {
  const { id } = await params
  return <CharacterPageClient id={id} />
}
