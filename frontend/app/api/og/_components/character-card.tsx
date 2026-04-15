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
import type { OgCharacterData } from "../_lib/data"
import { titleCase } from "../_lib/format"

interface CharacterCardProps {
  plateDataUrl: string
  character: OgCharacterData
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US")
}

export function CharacterCard({ plateDataUrl, character }: CharacterCardProps) {
  const hpPct =
    character.hp_max > 0 ? Math.max(0, Math.min(100, (character.hp_current / character.hp_max) * 100)) : 0
  const hpBarColor = hpPct < 25 ? OB.error : OB.secondary
  const shortId = character.id.slice(0, 8)
  const classTone: ClassTone = character.class

  return (
    <CardFrame plateDataUrl={plateDataUrl}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <ClassChip characterClass={classTone} />
        <StatusPill label="ALIVE" tone="alive" />
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Cinzel",
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 64,
          color: OB.primary,
          marginTop: 24,
          lineHeight: 1,
          textShadow: `0 0 40px ${OB.primary}66`,
        }}
      >
        {character.name}
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontSize: 22,
          fontWeight: 500,
          color: OB.outline,
          marginTop: 10,
        }}
      >
        Level {character.level} {titleCase(character.class)}
      </div>

      <Divider />

      <div style={{ display: "flex", width: "100%" }}>
        <StatCell label="DEEPEST FLOOR" value={character.deepest_floor ?? "—"} valueColor={OB.primary} />
        <StatCell label="REALMS CLEARED" value={character.realms_completed} valueColor={OB.secondary} />
      </div>

      <div style={{ display: "flex", width: "100%", marginTop: 24 }}>
        <StatCell label="XP" value={formatNumber(character.xp)} valueColor={OB.tertiary} />
        <StatCell label="GOLD" value={formatNumber(character.gold)} valueColor={OB.primary} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "Inter",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
            color: OB.outline,
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", color: OB.secondary }}>HEALTH</div>
          <div style={{ display: "flex" }}>
            {character.hp_current} / {character.hp_max}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            height: 8,
            width: "100%",
            backgroundColor: `${OB.outlineVariant}55`,
            borderRadius: 999,
            marginTop: 6,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              width: `${hpPct}%`,
              height: "100%",
              backgroundColor: hpBarColor,
            }}
          />
        </div>
      </div>

      <Footer url={`app.adventure.fun/character/${shortId}`} />
    </CardFrame>
  )
}
