// Google Fonts loader for next/og ImageResponse.
//
// Satori (the library behind ImageResponse) only understands TTF/OTF. Google
// Fonts serves woff2 to modern user-agents by default, so we spoof an ancient
// Safari UA which forces Google to fall back to TTF. Fonts are cached in
// module scope so we only pay the network hit once per cold start.

const LEGACY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1"

interface LoadedFont {
  name: string
  data: ArrayBuffer
  weight: 400 | 500 | 600 | 700
  style: "normal" | "italic"
}

let fontCache: LoadedFont[] | null = null

async function fetchGoogleFont(
  family: string,
  weight: number,
  italic: boolean,
): Promise<ArrayBuffer> {
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  )}:${axis}&display=swap`

  const cssRes = await fetch(cssUrl, { headers: { "User-Agent": LEGACY_UA } })
  if (!cssRes.ok) {
    throw new Error(`Google Fonts CSS fetch failed for ${family} ${weight}`)
  }
  const css = await cssRes.text()

  const match = css.match(/src:\s*url\((https:\/\/[^)]+)\)/)
  const fontUrl = match?.[1]
  if (!fontUrl) {
    throw new Error(`Could not parse font URL from Google Fonts CSS for ${family}`)
  }

  const fontRes = await fetch(fontUrl)
  if (!fontRes.ok) {
    throw new Error(`Font file fetch failed for ${family}`)
  }
  return await fontRes.arrayBuffer()
}

export async function loadOgFonts(): Promise<LoadedFont[]> {
  if (fontCache) return fontCache

  try {
    // Cinzel does not have an italic variant in its Google Fonts release —
    // we load the regular 700 weight twice and flag one as italic so Satori
    // picks it up for italic text runs (Satori skews the glyph slightly).
    const [cinzelItalic, cinzelBold, interMedium, interBold] = await Promise.all([
      fetchGoogleFont("Cinzel", 700, false),
      fetchGoogleFont("Cinzel", 700, false),
      fetchGoogleFont("Inter", 500, false),
      fetchGoogleFont("Inter", 700, false),
    ])

    fontCache = [
      { name: "Cinzel", data: cinzelItalic, weight: 700, style: "italic" },
      { name: "Cinzel", data: cinzelBold, weight: 700, style: "normal" },
      { name: "Inter", data: interMedium, weight: 500, style: "normal" },
      { name: "Inter", data: interBold, weight: 700, style: "normal" },
    ]
    return fontCache
  } catch (err) {
    console.warn("[og] font load failed, rendering with default fonts:", err)
    return []
  }
}
