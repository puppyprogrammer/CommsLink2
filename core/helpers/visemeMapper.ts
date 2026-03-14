/**
 * Maps ElevenLabs character-level alignment data to viseme timeline.
 * Visemes are mouth shapes used for lip sync animation.
 */

type AlignmentData = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type VisemeEntry = {
  viseme: string;
  start: number;
  end: number;
};

// 6 basic mouth shapes for the hologram lip particles
const CHAR_TO_VISEME: Record<string, string> = {
  // Open mouth — vowels that open wide
  a: "open",
  e: "open",
  i: "open",
  // Narrow/round mouth
  o: "narrow",
  u: "narrow",
  // Lips pressed together
  b: "closed",
  m: "closed",
  p: "closed",
  // Teeth/lip showing
  f: "teeth",
  v: "teeth",
  s: "teeth",
  z: "teeth",
  // Slightly open / tongue
  d: "wide",
  t: "wide",
  l: "wide",
  n: "wide",
  r: "wide",
  g: "wide",
  k: "wide",
  h: "wide",
  j: "wide",
  w: "narrow",
  y: "wide",
  c: "teeth",
  q: "narrow",
  x: "teeth",
};

/** Convert ElevenLabs character alignment to a viseme timeline */
const characterAlignmentToVisemes = (
  alignment: AlignmentData,
): VisemeEntry[] => {
  if (
    !alignment?.characters?.length ||
    !alignment?.character_start_times_seconds?.length ||
    !alignment?.character_end_times_seconds?.length
  ) {
    return [];
  }

  const raw: VisemeEntry[] = [];

  for (let i = 0; i < alignment.characters.length; i++) {
    const char = alignment.characters[i].toLowerCase();
    const start = alignment.character_start_times_seconds[i];
    const end = alignment.character_end_times_seconds[i];

    if (start === undefined || end === undefined) continue;

    const viseme = CHAR_TO_VISEME[char] || "rest";
    raw.push({ viseme, start, end });
  }

  // Collapse consecutive identical visemes
  const collapsed: VisemeEntry[] = [];
  for (const entry of raw) {
    const last = collapsed[collapsed.length - 1];
    if (
      last &&
      last.viseme === entry.viseme &&
      Math.abs(entry.start - last.end) < 0.05
    ) {
      last.end = entry.end;
    } else {
      collapsed.push({ ...entry });
    }
  }

  // Filter out entries shorter than 20ms (noise)
  return collapsed.filter((e) => e.end - e.start >= 0.02);
};

export type { AlignmentData, VisemeEntry };
export { characterAlignmentToVisemes };
