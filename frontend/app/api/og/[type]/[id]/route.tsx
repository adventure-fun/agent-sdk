import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { CharacterCard } from "../../_components/character-card"
import { DeathCard } from "../../_components/death-card"
import { fetchCharacterForCard, fetchLegendForCard } from "../../_lib/data"
import { getPlateDataUrl } from "../../_lib/plates"
import { loadOgFonts } from "../../_lib/fonts"

export const runtime = "nodejs"

// Dynamic OG card renderer. Routes:
//   GET /api/og/character/:id  → live character snapshot
//   GET /api/og/legend/:id     → death / legend memorial
// On any failure, streams the static default OG image so <meta og:image>
// never 404s.

const OG_WIDTH = 1200
const OG_HEIGHT = 600

type CardType = "character" | "legend"

function isValidType(value: string): value is CardType {
  return value === "character" || value === "legend"
}

async function serveDefaultImage(): Promise<Response> {
  try {
    const defaultPath = path.join(process.cwd(), "public", "og", "default.png")
    const buffer = await readFile(defaultPath)
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=300, s-maxage=1800",
      },
    })
  } catch {
    return new Response("Not Found", { status: 404 })
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ type: string; id: string }> },
): Promise<Response> {
  const { type, id } = await context.params

  if (!isValidType(type) || !id) {
    return serveDefaultImage()
  }

  const fonts = await loadOgFonts()
  // Satori's `fonts` option is required (no undefined allowed under
  // exactOptionalPropertyTypes). Spread conditionally so we simply omit the
  // key when font loading failed — ImageResponse then falls back to the
  // bundled default font instead of exploding.
  const fontsOption = fonts.length > 0 ? { fonts } : {}

  const legendHeaders = {
    "cache-control":
      "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  } as const
  const characterHeaders = {
    "cache-control":
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
  } as const

  try {
    if (type === "character") {
      const character = await fetchCharacterForCard(id)
      if (!character) return serveDefaultImage()

      // If the character is already dead, fall through to the legend card
      // so the share visuals match the page state.
      if (character.status === "dead") {
        const legend = await fetchLegendForCard(id)
        if (!legend) return serveDefaultImage()
        const plateDataUrl = await getPlateDataUrl(legend.character.class, "fallen")
        return new ImageResponse(<DeathCard plateDataUrl={plateDataUrl} legend={legend} />, {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          ...fontsOption,
          headers: legendHeaders,
        })
      }

      const plateDataUrl = await getPlateDataUrl(character.class, "alive")
      return new ImageResponse(
        <CharacterCard plateDataUrl={plateDataUrl} character={character} />,
        {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          ...fontsOption,
          headers: characterHeaders,
        },
      )
    }

    // type === 'legend'
    const legend = await fetchLegendForCard(id)
    if (!legend) return serveDefaultImage()
    const plateDataUrl = await getPlateDataUrl(legend.character.class, "fallen")
    return new ImageResponse(<DeathCard plateDataUrl={plateDataUrl} legend={legend} />, {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      ...fontsOption,
      headers: legendHeaders,
    })
  } catch (err) {
    console.warn("[og] render failed:", err)
    return serveDefaultImage()
  }
}
