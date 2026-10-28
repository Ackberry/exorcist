/**
 * Package names, manifests, source, and model text are data.
 * Strip the bytes that retarget a terminal, break a line, or hide a marker.
 * Character codes are checked in a loop. Biome rejects those bytes inside a regexp.
 */

/** True for C0 controls and DEL. Tab, LF, and CR are included. */
export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function stripUnsafe(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x1b) {
      i = skipAnsi(value, i);
      continue;
    }
    if (isHidden(code)) continue;
    const char = value[i];
    if (char !== undefined) out += char;
  }
  return out;
}

/** Fence escape runs after stripping, so a null byte cannot hide `<<<`. */
export function neutralizeMarkers(text: string): string {
  return stripUnsafe(text).replaceAll("<<<", "‹‹‹");
}

/** One line for a prompt bullet, a heading, or a terminal cell. */
export function oneLineUntrusted(value: string, max = 2_000): string {
  const flat = neutralizeMarkers(value).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function isHidden(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  if (code <= 0x1f || code === 0x7f) return true;
  if (code >= 0x200b && code <= 0x200f) return true;
  if (code === 0x2028 || code === 0x2029) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2060 && code <= 0x2064) return true;
  if (code >= 0x2066 && code <= 0x2069) return true;
  if (code === 0xfeff) return true;
  return false;
}

/**
 * Index of the last byte of a short ANSI sequence, or `start` when the
 * sequence is not a small CSI / OSC. The caller skips that index.
 * A long or unfinished sequence drops only the ESC, so package text is not eaten.
 */
function skipAnsi(value: string, start: number): number {
  const next = value.charCodeAt(start + 1);
  if (next === 0x5b) return skipCsi(value, start);
  if (next === 0x5d) return skipOsc(value, start);
  if (next >= 0x40 && next <= 0x5f) return start + 1;
  return start;
}

function skipCsi(value: string, start: number): number {
  const limit = Math.min(value.length - 1, start + 16);
  for (let j = start + 2; j <= limit; j++) {
    const code = value.charCodeAt(j);
    if (code >= 0x40 && code <= 0x7e) return j;
  }
  return start;
}

function skipOsc(value: string, start: number): number {
  const limit = Math.min(value.length - 1, start + 512);
  for (let j = start + 2; j <= limit; j++) {
    if (value.charCodeAt(j) === 0x07) return j;
    if (value.charCodeAt(j) === 0x1b && value.charCodeAt(j + 1) === 0x5c) return j + 1;
  }
  return start;
}
