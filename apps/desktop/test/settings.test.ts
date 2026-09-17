import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_RECENT,
  forgetDocument,
  parseSettings,
  readSettings,
  rememberDocument,
  writeSettings,
} from '../src/settings.js';

/**
 * The settings file is read defensively on purpose: a reader who cannot start the
 * application cannot be told what is wrong with it.
 */

describe('parseSettings', () => {
  it('reads what was written', () => {
    expect(parseSettings('{"reloadOnChange":false,"recent":["/a.revlens"]}')).toEqual({
      reloadOnChange: false,
      recent: ['/a.revlens'],
    });
  });

  it('falls back to the defaults rather than failing to start', () => {
    expect(parseSettings('{ half a file')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]')).toEqual({ reloadOnChange: true, recent: [] });
  });

  it('keeps the setting the editor extension has, with the same default', () => {
    expect(parseSettings('{}').reloadOnChange).toBe(true);
    expect(parseSettings('{"reloadOnChange":"yes"}').reloadOnChange).toBe(true);
  });

  it('drops entries that are not paths', () => {
    expect(parseSettings('{"recent":["/a.revlens",7,null]}').recent).toEqual(['/a.revlens']);
  });
});

describe('the list of recent documents', () => {
  it('moves a document to the front instead of listing it twice', () => {
    let settings = rememberDocument(DEFAULT_SETTINGS, '/a.revlens');
    settings = rememberDocument(settings, '/b.revlens');
    settings = rememberDocument(settings, '/a.revlens');

    expect(settings.recent).toEqual(['/a.revlens', '/b.revlens']);
  });

  it('stays a menu rather than a history', () => {
    let settings = DEFAULT_SETTINGS;
    for (let index = 0; index < MAX_RECENT + 5; index += 1) {
      settings = rememberDocument(settings, `/round-${index}.revlens`);
    }

    expect(settings.recent).toHaveLength(MAX_RECENT);
    expect(settings.recent[0]).toBe(`/round-${MAX_RECENT + 4}.revlens`);
  });

  it('forgets a document that is no longer there', () => {
    const settings = rememberDocument(DEFAULT_SETTINGS, '/a.revlens');
    expect(forgetDocument(settings, '/a.revlens').recent).toEqual([]);
  });
});

describe('the settings file', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'revlens-settings-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('survives a round trip through the disk', async () => {
    const file = join(directory, 'nested', 'settings.json');
    const settings = rememberDocument({ reloadOnChange: false, recent: [] }, '/a.revlens');

    expect(await writeSettings(file, settings)).toBe(true);
    expect(await readSettings(file)).toEqual(settings);
  });

  it('gives the defaults when there is no file yet', async () => {
    expect(await readSettings(join(directory, 'settings.json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('gives the defaults when a person edited the file into something else', async () => {
    const file = join(directory, 'settings.json');
    await writeFile(file, 'reloadOnChange: true\n', 'utf8');

    expect(await readSettings(file)).toEqual(DEFAULT_SETTINGS);
  });
});
