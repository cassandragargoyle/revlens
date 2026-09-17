/**
 * A colour per revision, so that a reader can see at a glance that two marks in different
 * chapters came from the same instruction.
 *
 * Hues are spread around the wheel and kept away from the red the deletions use, since a
 * struck-through passage should read as removed whichever revision removed it.
 */

const HUES = [205, 152, 262, 32, 182, 292, 96, 222, 12, 172, 322, 52];

export interface RevisionColor {
  readonly stroke: string;
  readonly tint: string;
  readonly swatch: string;
}

export function revisionColor(revisionIds: readonly string[], id: string): RevisionColor {
  const position = revisionIds.indexOf(id);
  const hue = HUES[(position < 0 ? hash(id) : position) % HUES.length] ?? 205;
  return {
    stroke: `hsl(${hue} 62% 38%)`,
    tint: `hsl(${hue} 70% 95%)`,
    swatch: `hsl(${hue} 62% 45%)`,
  };
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result * 31 + value.charCodeAt(i)) % 1_000_003;
  }
  return result;
}
