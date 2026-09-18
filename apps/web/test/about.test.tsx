/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { createEmbeddedSource } from '../src/data/source.js';
import { VERSION } from '../src/version.js';
import { cs } from '../src/strings.js';

import sample from '../../../fixtures/sample-bundle.json';
// Imported rather than read from disk: under jsdom `import.meta.url` is an http URL, the
// way `viewer.test.tsx` already notes for the fixture.
import manifest from '../../../package.json';

/**
 * What the About page says about itself.
 *
 * The viewer is handed to people who did not build it, and a reader reporting a problem
 * has to be able to say which build they were looking at. What wrote the bundle is
 * already there as `generator`; what is *showing* it was not.
 */

afterEach(cleanup);

async function openAbout(): Promise<void> {
  const { container } = render(<App source={createEmbeddedSource(sample)} />);
  await waitFor(() => {
    expect(container.querySelector('[data-block]')).not.toBeNull();
  });
  await userEvent.click(screen.getByRole('button', { name: cs.about.open }));
  await screen.findByText(cs.about.provenance);
}

describe('the About page', () => {
  it('names the version of the tool the reader is looking at', async () => {
    await openAbout();

    expect(screen.getByText(cs.about.tool)).toBeDefined();
    expect(screen.getByText(`RevLens ${VERSION}`)).toBeDefined();
  });

  /**
   * The bundler substitutes the workspace version; the fallback exists so an
   * unconfigured build says `dev` instead of throwing, and a release that shipped the
   * fallback would be a release nobody can identify.
   */
  it('takes that version from the workspace manifest, not from a literal', () => {
    expect(VERSION).toBe(manifest.version);
    expect(VERSION).not.toBe('dev');
  });
});
