import type { LegendPage } from "@adventure-fun/schemas"
import {
  CardFrame,
  ClassChip,
  ClassTone,
  Divider,
  Footer,
  OB,
  StatCell,
  StatusPill,
} from "./card-frame"
import { formatOwnerForLegend } from "../_lib/data"
import { titleCase } from "../_lib/format"

interface DeathCardProps {
  plateDataUrl: string
  legend: LegendPage
}

export function DeathCard({ plateDataUrl, legend }: DeathCardProps) {
  const { character, history } = legend
  const classTone: ClassTone = character.class
  const shortId = character.id.slice(0, 8)
  const ownerLabel = formatOwnerForLegend(legend.owner)
  const classTitle = titleCase(character.class)

  return (
    <CardFrame plateDataUrl={plateDataUrl}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <ClassChip characterClass={classTone} />
        <StatusPill label="FALLEN" tone="fallen" />
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Cinzel",
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 80,
          color: OB.error,
          marginTop: 18,
          lineHeight: 1,
          textShadow: `0 0 40px ${OB.error}55`,
          letterSpacing: 2,
        }}
      >
        FALLEN
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Cinzel",
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 36,
          color: OB.primary,
          marginTop: 10,
          lineHeight: 1.1,
        }}
      >
        {character.name}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontSize: 20,
          fontWeight: 500,
          color: OB.outline,
          marginTop: 6,
        }}
      >
        Level {character.level} {classTitle}
      </div>

      <Divider />

      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontSize: 18,
          fontWeight: 500,
          color: OB.onSurface,
          marginBottom: 4,
        }}
      >
        Slain by {history.cause_of_death}
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 500,
          color: OB.outline,
        }}
      >
        on Floor {history.death_floor} — {history.death_room}
      </div>

      <div style={{ display: "flex", width: "100%", marginTop: 24 }}>
        <StatCell label="DEEPEST FLOOR" value={history.deepest_floor} valueColor={OB.primary} />
        <StatCell label="ENEMIES SLAIN" value={history.enemies_killed} valueColor={OB.tertiary} />
      </div>

      <div style={{ display: "flex", width: "100%", marginTop: 18 }}>
        <StatCell label="TURNS SURVIVED" value={history.turns_survived} valueColor={OB.onSurface} />
        <StatCell label="REALMS CLEARED" value={history.realms_completed} valueColor={OB.secondary} />
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 500,
          color: OB.outline,
          marginTop: "auto",
        }}
      >
        by {ownerLabel}
      </div>
      <Footer url={`app.adventure.fun/legends/${shortId}`} />
    </CardFrame>
  )
}
