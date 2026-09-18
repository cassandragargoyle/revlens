// The examples a build knows about, read from the directory rather than from a list
// One `example.json` per example is the whole registry

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExampleChoice, ExampleManifest } from './types.js';

/**
 * Every example under `root`, resolved for one language.
 *
 * The directory is the registry: an example added to `examples/` appears in the picker
 * without anybody remembering to update a list, which is the same rule the source
 * adapters follow. An example with no `example.json` is skipped rather than guessed at -
 * a picker with a blank row in it is worse than one entry fewer.
 *
 * `language` is a preference, not a filter: an example that is not written in it is
 * offered in the first language it has, because a reader who wants to see how the tool
 * works is better served by a document in the wrong language than by an empty list.
 */
export async function listExamples(
  root: string,
  language = 'en',
): Promise<ExampleChoice[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const choices: ExampleChoice[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(join(root, entry.name));
    if (manifest === undefined) continue;

    const spoken = manifest.languages.includes(language)
      ? language
      : (manifest.languages[0] ?? 'en');

    choices.push({
      id: manifest.id,
      language: spoken,
      title: manifest.title[spoken] ?? manifest.id,
      description: manifest.description[spoken] ?? '',
      languages: manifest.languages,
    });
  }

  return choices.sort((a, b) => a.id.localeCompare(b.id));
}

/** One example's manifest, or undefined when the directory is not an example at all. */
export async function readManifest(
  directory: string,
): Promise<ExampleManifest | undefined> {
  const text = await readFile(join(directory, 'example.json'), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;

  try {
    const parsed = JSON.parse(text) as ExampleManifest;
    // Enough of a check that a malformed manifest is skipped rather than crashing a
    // picker; the contract itself is held by `npm run example:check`.
    if (typeof parsed.id !== 'string' || !Array.isArray(parsed.languages)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
