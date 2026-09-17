import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * What the application remembers between runs
 *
 * One small JSON file in the user's data directory, holding the one setting the editor
 * extension also has and the documents that were opened. It is parsed defensively: a
 * file a human edited, or a half-written one, must not stop the application from
 * opening - a reader who cannot start the application cannot be told what is wrong with
 * it. Anything unreadable falls back to the defaults.
 */

export interface DesktopSettings {
  /** The desktop half of `revlens.reloadOnChange`; same name, same default. */
  readonly reloadOnChange: boolean;
  /** Most recently opened first, absolute paths. */
  readonly recent: readonly string[];
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  reloadOnChange: true,
  recent: [],
};

/** Long enough to find last week's round, short enough to stay a menu. */
export const MAX_RECENT = 10;

export function parseSettings(text: string): DesktopSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;

  const record = value as Record<string, unknown>;
  const recent = Array.isArray(record.recent)
    ? record.recent.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    reloadOnChange:
      typeof record.reloadOnChange === 'boolean'
        ? record.reloadOnChange
        : DEFAULT_SETTINGS.reloadOnChange,
    recent: recent.slice(0, MAX_RECENT),
  };
}

export function serializeSettings(settings: DesktopSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export async function readSettings(file: string): Promise<DesktopSettings> {
  try {
    return parseSettings(await readFile(file, 'utf8'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Writing settings is never worth an error dialog; a lost preference is not a lost document. */
export async function writeSettings(file: string, settings: DesktopSettings): Promise<boolean> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, serializeSettings(settings), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** The document moves to the front; a second open does not make a second entry. */
export function rememberDocument(settings: DesktopSettings, fsPath: string): DesktopSettings {
  const rest = settings.recent.filter((entry) => entry !== fsPath);
  return { ...settings, recent: [fsPath, ...rest].slice(0, MAX_RECENT) };
}

export function forgetDocument(settings: DesktopSettings, fsPath: string): DesktopSettings {
  return { ...settings, recent: settings.recent.filter((entry) => entry !== fsPath) };
}
