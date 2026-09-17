/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { createEmbeddedSource } from '../src/data/source.js';

/**
 * End-to-end smoke test of the viewer, over the sample bundle.
 *
 * It exercises the path a reader takes: open the document, click a marked passage, read
 * the three answers in the inspector, and step to the next place the same instruction
 * landed. A deep link is opened cold, which is the case an e-mailed link has to survive.
 */

// Imported rather than read from disk: under jsdom `import.meta.url` is an http URL, and
// the bundler resolves the path the same way the application would.
import sample from '../../../fixtures/sample-bundle.json';

/**
 * Render and wait until the document body is on screen. The header appears before the
 * chapter does - the chapter is loaded through the source - so querying for a marked
 * passage straight after `render` races the first paint.
 */
async function renderApp(hash = ''): Promise<HTMLElement> {
  if (hash.length > 0) window.history.replaceState(null, '', hash);
  const { container } = render(<App source={createEmbeddedSource(sample)} />);
  await waitFor(() => {
    expect(container.querySelector('[data-block]')).not.toBeNull();
  });
  return container;
}

beforeAll(() => {
  // jsdom implements neither of these, and neither is what the test is about.
  Element.prototype.scrollIntoView = (): void => undefined;
  Object.defineProperty(window, 'print', { value: (): void => undefined, writable: true });
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('the viewer', () => {
  it('renders the document with its title and the first chapter', async () => {
    await renderApp();
    expect(screen.getByText(/Analýza kompetenčního centra/)).toBeDefined();
    // The chapter appears both in the navigation and as the heading of the document.
    expect(screen.getAllByText(/Manažerské shrnutí/).length).toBeGreaterThan(0);
  });

  it('marks the changes in place, insertions and deletions alike', async () => {
    const container = await renderApp();

    const inserted = container.querySelectorAll('.run--inserted');
    const deleted = container.querySelectorAll('.run--deleted');
    expect(inserted.length).toBeGreaterThan(0);
    expect(deleted.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-edit="E-003"]')).not.toBeNull();
  });

  it('marks a whole new block in the margin rather than run by run', async () => {
    const container = await renderApp();
    // ch-02/b-06 was introduced by R-002, and it lives in the second chapter.
    await userEvent.click(screen.getByRole('button', { name: /Produkty a jejich hranice/ }));
    await waitFor(() => {
      expect(container.querySelector('.block--introduced')).not.toBeNull();
    });
  });

  it('counts the changes in each chapter, so an untouched chapter would be visible', async () => {
    await renderApp();
    const chapter = screen.getByRole('button', { name: /Manažerské shrnutí/ });
    expect(within(chapter).getByText('3 změny')).toBeDefined();
  });
});

describe('clicking a marked passage', () => {
  it('opens the inspector with the revision and the comment behind the change', async () => {
    const container = await renderApp();

    const passage = container.querySelector('[data-edit="E-003"]');
    expect(passage).not.toBeNull();
    await userEvent.click(passage as Element);

    // What changed.
    expect(await screen.findByText('vedoucí oblasti Technology', { selector: '.change__inserted' })).toBeDefined();
    expect(screen.getByText('CTO', { selector: '.change__removed' })).toBeDefined();

    // When and by whom - the instruction as it was given.
    expect(screen.getByText('oprav to všude, není to CTO')).toBeDefined();

    // Why - the reviewer comment, verbatim, with its decision.
    expect(screen.getByText('Nejsem CTO, jsem vedoucí oblasti Technology.')).toBeDefined();
    expect(screen.getByText('prijato', { selector: '.badge' })).toBeDefined();
  });

  it('lists the other places the same instruction landed', async () => {
    const container = await renderApp();

    await userEvent.click(container.querySelector('[data-edit="E-003"]') as Element);
    const siblings = await screen.findByRole('list', { name: '' }).catch(() => null);
    expect(siblings ?? container.querySelector('.siblings')).not.toBeNull();

    const items = container.querySelectorAll('.siblings__item');
    expect(items.length).toBe(2);
    expect([...items].map((item) => item.textContent ?? '').join(' ')).toContain('E-007');
  });
});

describe('stepping between the changes of one revision', () => {
  it('moves to the next sibling on n and back on p', async () => {
    const container = await renderApp();

    await userEvent.click(container.querySelector('[data-edit="E-003"]') as Element);
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-003'));

    await userEvent.keyboard('n');
    // E-007 is the same revision, in the other chapter.
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-007'));

    await userEvent.keyboard('p');
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-003'));
  });

  it('walks every change in document order on j and k', async () => {
    const container = await renderApp();

    await userEvent.click(container.querySelector('[data-edit="E-001"]') as Element);
    await userEvent.keyboard('j');
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-002'));

    await userEvent.keyboard('k');
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-001'));
  });

  it('clears the selection on Escape', async () => {
    const container = await renderApp();

    await userEvent.click(container.querySelector('[data-edit="E-001"]') as Element);
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-001'));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByText(/Vyberte vyznačené místo/)).toBeDefined();
  });
});

describe('deep links', () => {
  it('opens a change on a cold load', async () => {
    await renderApp('#/edit/E-004');
    // E-004 lives in the second chapter, which the link has to bring up by itself.
    expect(await screen.findByText('doplň PLAN, podklad ho vede od července')).toBeDefined();
    expect(screen.getByText('TINA, PARO a PLAN', { selector: '.change__inserted' })).toBeDefined();
  });

  it('opens a comment on a cold load, with every change it produced', async () => {
    const container = await renderApp();
    window.location.hash = '#/comment/K2-004';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await waitFor(() => {
      expect(container.querySelectorAll('.siblings__item').length).toBe(2);
    });
    expect(screen.getByText('Nejsem CTO, jsem vedoucí oblasti Technology.')).toBeDefined();
  });

  it('says so when the link names something the bundle does not contain', async () => {
    await renderApp('#/edit/E-999');
    expect(await screen.findByText(/E-999/)).toBeDefined();
  });
});

describe('the mode switch', () => {
  it('hides the deletions in clean mode and restores them in review', async () => {
    const container = await renderApp();

    expect(container.querySelectorAll('.run--deleted').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Čistopis' }));
    await waitFor(() => {
      expect(container.querySelectorAll('.run--deleted').length).toBe(0);
    });
    expect(container.querySelectorAll('.run--inserted').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Původní verze' }));
    await waitFor(() => {
      expect(container.querySelectorAll('.run--inserted').length).toBe(0);
    });
    expect(container.querySelectorAll('.run--deleted').length).toBeGreaterThan(0);
  });
});

describe('filters', () => {
  it('shows a live count of the changes the filter admits', async () => {
    await renderApp();
    expect(screen.getByTestId('filter-count').textContent).toBe('Zobrazeno 7 z 7 změn');

    await userEvent.type(screen.getByLabelText(/Hledat v pokynech/), 'PLAN');
    await waitFor(() => {
      expect(screen.getByTestId('filter-count').textContent).toBe('Zobrazeno 2 z 7 změn');
    });
  });

  it('dims the changes the filter excludes rather than hiding them', async () => {
    const container = await renderApp();

    await userEvent.type(screen.getByLabelText(/Hledat v pokynech/), 'není to CTO');
    await waitFor(() => {
      expect(container.querySelectorAll('.run--dimmed').length).toBeGreaterThan(0);
    });
    // The text is all still there; only the marking changed.
    expect(screen.getByText(/Martin Svoboda/)).toBeDefined();
  });

  it('narrows the timeline to the selected round', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Revize' }));
    await waitFor(() => expect(document.querySelectorAll('.revision').length).toBe(4));

    await userEvent.selectOptions(screen.getByLabelText(/Kolo připomínek/), 'K1');
    await waitFor(() => {
      expect(document.querySelectorAll('.revision').length).toBe(1);
    });
  });
});

describe('the revision timeline', () => {
  it('lands on the first change of a revision when one is chosen', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Revize' }));
    await waitFor(() => expect(document.querySelectorAll('.revision').length).toBe(4));

    const revision = document.querySelectorAll('.revision')[1];
    expect(revision).toBeDefined();
    await userEvent.click(revision as Element);

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/revision\/R-/));
    expect(screen.getByText(/Další změny téže revize|Tato revize změnila/)).toBeDefined();
  });
});

describe('browsing the review', () => {
  it('switches the left column to the comments', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));

    await waitFor(() => {
      expect(container.querySelectorAll('.comment').length).toBe(3);
    });
    expect(screen.getByTestId('comment-count').textContent).toBe(
      'Zobrazeno 3 z 3 připomínek k tomuto srovnání (v bundlu jich je 3)',
    );
  });

  it('shows all three gates on every comment', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));

    const row = await waitFor(() => {
      const found = container.querySelector('[data-comment="K2-005"]');
      expect(found).not.toBeNull();
      return found as Element;
    });

    const badges = [...row.querySelectorAll('.badge')].map((b) => b.textContent);
    expect(badges).toEqual(['potvrzeno-s-upresnenim', 'prijato-castecne', 'rozpracovano']);
  });

  it('opens a comment in the inspector, with its recorded resolution', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));

    const row = await waitFor(() => {
      const found = container.querySelector('[data-comment="K2-004"]');
      expect(found).not.toBeNull();
      return found as Element;
    });
    await userEvent.click(row);

    await waitFor(() => expect(window.location.hash).toBe('#/comment/K2-004'));
    expect(screen.getByText('Zapsané vypořádání')).toBeDefined();
    expect(screen.getAllByText(/funkce opravena/).length).toBe(2);
    // It landed in two chapters, so the jump list has both.
    expect(container.querySelectorAll('.siblings__item').length).toBe(2);
  });

  it('filters by the third gate, which is the "still open" question', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBe(3));

    await userEvent.selectOptions(screen.getByLabelText('Vypořádání'), 'rozpracovano');

    await waitFor(() => {
      expect(container.querySelectorAll('.comment').length).toBe(1);
    });
    expect(container.querySelector('[data-comment="K2-005"]')).not.toBeNull();
    expect(screen.getByTestId('comment-count').textContent).toBe(
      'Zobrazeno 1 z 3 připomínek k tomuto srovnání (v bundlu jich je 3)',
    );
  });

  it('filters by decision and combines it with the round', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));

    await userEvent.selectOptions(screen.getByLabelText('Rozhodnutí'), 'prijato');
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBe(2));

    await userEvent.selectOptions(screen.getByLabelText(/Kolo připomínek/), 'K2');
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBe(1));
    expect(container.querySelector('[data-comment="K2-004"]')).not.toBeNull();
  });

  it('says plainly when a comment changed nothing in the document', async () => {
    // The sample has no such comment, so one is made: accepted, never worked in.
    const orphaned = structuredClone(sample) as {
      revisions: { id: string; comments?: string[]; edits?: string[] }[];
      comments: { id: string; revisions?: string[]; resolution?: { state?: string } }[];
      edits: { id: string; revision: string }[];
      chapters: { blocks: { runs: { edit?: string }[] }[] }[];
    };
    for (const revision of orphaned.revisions) {
      if (revision.id === 'R-002') delete revision.comments;
    }
    for (const comment of orphaned.comments) {
      if (comment.id === 'K1-002') {
        comment.revisions = [];
        comment.resolution = { state: 'nezahajeno' };
      }
    }

    const { container } = render(<App source={createEmbeddedSource(orphaned)} />);
    await waitFor(() => expect(container.querySelector('[data-block]')).not.toBeNull());
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));

    const row = await waitFor(() => {
      const found = container.querySelector('[data-comment="K1-002"]');
      expect(found).not.toBeNull();
      return found as Element;
    });
    await userEvent.click(row);

    expect(
      await screen.findByText('Tato připomínka nezměnila v dokumentu žádné místo.'),
    ).toBeDefined();
  });

  it('narrows the comment list to the ones genuinely still open', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBe(3));

    await userEvent.click(screen.getByLabelText(/nezapracované v tomto rozsahu/));
    await waitFor(() => {
      expect(container.querySelectorAll('.comment').length).toBe(0);
    });
    expect(screen.getByText('Žádná připomínka neodpovídá filtru.')).toBeDefined();
  });

  it('excludes what was settled before the compared version, rather than calling it open', async () => {
    // One comment settled before the baseline and producing nothing, one still open.
    const scoped = structuredClone(sample) as {
      document: { baseline?: { version: string; at?: string } };
      revisions: { comments?: string[] }[];
      comments: { id: string; revisions?: string[]; resolution?: { state?: string; at?: string } }[];
    };
    scoped.document.baseline = { version: '1.5', at: '2026-09-11T00:00:00+02:00' };
    for (const revision of scoped.revisions) delete revision.comments;
    for (const comment of scoped.comments) {
      comment.revisions = [];
      if (comment.id === 'K1-002') {
        comment.resolution = { state: 'hotovo', at: '2026-09-10T11:05:00+02:00' };
      }
      if (comment.id === 'K2-004') {
        comment.resolution = { state: 'hotovo', at: '2026-09-09T16:40:00+02:00' };
      }
      if (comment.id === 'K2-005') {
        comment.resolution = { state: 'rozpracovano', at: '2026-09-12T08:20:00+02:00' };
      }
    }

    const { container } = render(<App source={createEmbeddedSource(scoped)} />);
    await waitFor(() => expect(container.querySelector('[data-block]')).not.toBeNull());
    await userEvent.click(screen.getByRole('tab', { name: 'Připomínky' }));
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBeGreaterThan(0));

    // Only the one this comparison can speak to is listed; the other two are hidden.
    expect(container.querySelectorAll('.comment').length).toBe(1);
    expect(container.querySelector('[data-comment="K2-005"]')).not.toBeNull();

    // Widening brings them back, marked as out of scope rather than as nothing-happened.
    await userEvent.click(screen.getByLabelText(/uzavřené dřív/));
    await waitFor(() => expect(container.querySelectorAll('.comment').length).toBe(3));
    expect(container.querySelectorAll('.comment__flag--scope').length).toBe(2);
  });
});

describe('the revision timeline', () => {
  it('shows how the comments each revision answers were disposed of', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('tab', { name: 'Revize' }));

    await waitFor(() => {
      expect(container.querySelectorAll('.revision').length).toBe(4);
    });
    const gates = container.querySelector('.revision__gates');
    expect(gates).not.toBeNull();
    expect(gates?.textContent).toMatch(/prijato|hotovo/);
  });
});

describe('the about page', () => {
  it('opens from the rail and says what the tool is', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));

    expect(await screen.findByText(/čtení revidovaného dokumentu/)).toBeDefined();
    expect(window.location.hash).toBe('#/about');
  });

  it('carries the cover image with a caption that names what it shows', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));

    const image = await waitFor(() => {
      const found = container.querySelector('.about__cover');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(image.getAttribute('alt')).toMatch(/jednoho uzlu na časové ose/);
    expect(screen.getByText(/Jeden uzel na časové ose, tři linky/)).toBeDefined();
  });

  it('says where the numbers came from', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));

    await screen.findByText('Co je právě načtené');
    expect(screen.getByText('Analýza kompetenčního centra')).toBeDefined();
    // The baseline, the generator and the unexplained count are the provenance.
    expect(screen.getByText('Porovnáno proti')).toBeDefined();
    expect(screen.getByText(/revlens build \(fixture, hand-written\)/)).toBeDefined();
    expect(screen.getByText('Bez doloženého původu')).toBeDefined();
  });

  it('lists the gate values this document actually uses', async () => {
    const container = await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));

    await screen.findByText('Tři brány, kterými připomínka prochází');
    const values = [...container.querySelectorAll('.about__values .badge')].map(
      (badge) => badge.textContent,
    );
    expect(values).toContain('potvrzeno-s-upresnenim');
    expect(values).toContain('prijato-castecne');
    expect(values).toContain('rozpracovano');
  });

  it('holds the only copy of the keyboard help', async () => {
    await renderApp();
    // It used to be in the navigation column as well; one page says it now.
    expect(screen.queryByText(/další změna téže revize/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));
    await screen.findByText('Klávesy');
    expect(screen.getAllByText(/další změna téže revize/)).toHaveLength(1);
  });

  it('opens on a cold load from the link, and goes back to the document', async () => {
    render(<App source={createEmbeddedSource(sample)} />);
    window.location.hash = '#/about';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(await screen.findByText(/čtení revidovaného dokumentu/)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Zpět k dokumentu' }));
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(screen.getAllByText(/Manažerské shrnutí/).length).toBeGreaterThan(0);
  });
});

describe('resizing the panes', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // A test that cannot clear storage is still a valid test of the defaults.
    }
  });

  it('offers a separator for each side column', async () => {
    await renderApp();
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(2);
    expect(separators[0]?.getAttribute('aria-label')).toBe('Šířka levého panelu');
    expect(separators[1]?.getAttribute('aria-label')).toBe('Šířka pravého panelu');
  });

  it('starts at the default widths', async () => {
    const container = await renderApp();
    const app = container.querySelector('.app') as HTMLElement;
    expect(app.style.getPropertyValue('--pane-left')).toBe('290px');
    expect(app.style.getPropertyValue('--pane-right')).toBe('360px');
  });

  it('widens the left column with the arrow keys, because a drag is not for everyone', async () => {
    const container = await renderApp();
    const app = container.querySelector('.app') as HTMLElement;
    const separator = screen.getByRole('separator', { name: 'Šířka levého panelu' });

    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(app.style.getPropertyValue('--pane-left')).toBe('306px'));

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await waitFor(() => expect(app.style.getPropertyValue('--pane-left')).toBe('274px'));
  });

  it('moves the right column the other way, since it grows leftwards', async () => {
    const container = await renderApp();
    const app = container.querySelector('.app') as HTMLElement;
    const separator = screen.getByRole('separator', { name: 'Šířka pravého panelu' });

    separator.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(app.style.getPropertyValue('--pane-right')).toBe('376px'));
  });

  it('refuses to shrink a column into uselessness', async () => {
    const container = await renderApp();
    const app = container.querySelector('.app') as HTMLElement;
    const separator = screen.getByRole('separator', { name: 'Šířka levého panelu' });

    separator.focus();
    // 290 to 200 is under six steps; twenty presses must not go past the floor.
    await userEvent.keyboard('{ArrowLeft>20/}');
    await waitFor(() => expect(app.style.getPropertyValue('--pane-left')).toBe('200px'));
    expect(separator.getAttribute('aria-valuemin')).toBe('200');
  });

  it('remembers the width for the next visit, and Home puts it back', async () => {
    const first = await renderApp();
    const separator = screen.getByRole('separator', { name: 'Šířka levého panelu' });
    separator.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await waitFor(() =>
      expect((first.querySelector('.app') as HTMLElement).style.getPropertyValue('--pane-left')).toBe(
        '322px',
      ),
    );

    cleanup();
    const second = await renderApp();
    expect((second.querySelector('.app') as HTMLElement).style.getPropertyValue('--pane-left')).toBe(
      '322px',
    );

    screen.getByRole('separator', { name: 'Šířka levého panelu' }).focus();
    await userEvent.keyboard('{Home}');
    await waitFor(() =>
      expect(
        (second.querySelector('.app') as HTMLElement).style.getPropertyValue('--pane-left'),
      ).toBe('290px'),
    );
  });

  it('keeps the separators out of the about page, which has no columns', async () => {
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'O nástroji' }));
    await screen.findByText(/čtení revidovaného dokumentu/);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });
});

describe('bringing the selected change on screen', () => {
  it('takes the target block out of the virtualization so it can be measured', async () => {
    const container = await renderApp();
    await userEvent.click(container.querySelector('[data-edit="E-003"]') as Element);

    await waitFor(() => {
      const target = container.querySelector('.block--target');
      expect(target).not.toBeNull();
      expect(target?.getAttribute('data-block')).toBe('ch-01/b-05');
    });

    // Only the block holding the selection is exempted; the rest stays virtualized.
    expect(container.querySelectorAll('.block--target')).toHaveLength(1);
  });

  it('moves the exemption with the selection', async () => {
    const container = await renderApp();
    await userEvent.click(container.querySelector('[data-edit="E-001"]') as Element);
    await waitFor(() =>
      expect(container.querySelector('.block--target')?.getAttribute('data-block')).toBe(
        'ch-01/b-02',
      ),
    );

    await userEvent.keyboard('j');
    await waitFor(() =>
      expect(container.querySelector('.block--target')?.getAttribute('data-block')).toBe(
        'ch-01/b-04',
      ),
    );
  });

  it('exempts nothing when there is no selection', async () => {
    const container = await renderApp();
    expect(container.querySelectorAll('.block--target')).toHaveLength(0);
  });
});

describe('a revision spread across chapters', () => {
  it('names each chapter it touched, with its share', async () => {
    const container = await renderApp();
    // R-003 corrected the same job title in both chapters.
    await userEvent.click(container.querySelector('[data-edit="E-003"]') as Element);

    await screen.findByText('Zasažené kapitoly');
    const shares = [...container.querySelectorAll('.shares__item')].map((item) =>
      (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(shares).toEqual(['Manažerské shrnutí1 změna', 'Produkty a jejich hranice1 změna']);
  });

  it('jumps to the first change in a chosen chapter', async () => {
    const container = await renderApp();
    await userEvent.click(container.querySelector('[data-edit="E-003"]') as Element);
    await screen.findByText('Zasažené kapitoly');

    const second = container.querySelectorAll('.shares__item')[1];
    expect(second).toBeDefined();
    await userEvent.click(second as Element);

    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-007'));
  });

  it('says nothing about chapters when the revision stayed in one', async () => {
    const container = await renderApp();
    // E-001 belongs to R-001, whose single change is in one chapter.
    await userEvent.click(container.querySelector('[data-edit="E-001"]') as Element);
    await waitFor(() => expect(window.location.hash).toBe('#/edit/E-001'));
    expect(screen.queryByText('Zasažené kapitoly')).toBeNull();
  });
});


describe('the left rail', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // A test that cannot clear storage is still a valid test of the defaults.
    }
  });

  /** The rail element, which is the only place these four controls exist. */
  function rail(container: HTMLElement): HTMLElement {
    const found = container.querySelector('.rail');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  }

  it('holds the three ways of reading and the about page, and the header holds none of them', async () => {
    const container = await renderApp();
    const bar = within(rail(container));

    for (const name of ['Čistopis', 'Se změnami', 'Původní verze', 'O nástroji']) {
      expect(bar.getByRole('button', { name }), name).toBeDefined();
    }

    // Two controls for one state is two places to keep in agreement; the rail is the one.
    const header = within(container.querySelector('.app__header') as HTMLElement);
    for (const name of ['Čistopis', 'Se změnami', 'Původní verze', 'O nástroji']) {
      expect(header.queryByRole('button', { name }), name).toBeNull();
    }
  });

  it('switches the document as the header buttons used to, and marks the one that is on', async () => {
    const container = await renderApp();
    const bar = within(rail(container));

    expect(bar.getByRole('button', { name: 'Se změnami' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(bar.getByRole('button', { name: 'Čistopis' }));
    await waitFor(() => {
      expect(container.querySelectorAll('.run--deleted').length).toBe(0);
    });
    expect(bar.getByRole('button', { name: 'Čistopis' }).getAttribute('aria-pressed')).toBe('true');
    expect(bar.getByRole('button', { name: 'Se změnami' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the about page and stays marked while it is open', async () => {
    const container = await renderApp();
    const bar = within(rail(container));
    const about = bar.getByRole('button', { name: 'O nástroji' });

    await userEvent.click(about);
    await screen.findByText(/čtení revidovaného dokumentu/);
    expect(window.location.hash).toBe('#/about');
    // The rail is a column of the body, so it is still there with the page open.
    expect(within(rail(container)).getByRole('button', { name: 'O nástroji' }).getAttribute('aria-pressed')).toBe('true');

    // Picking a way to read the document is also a way out of the about page.
    await userEvent.click(within(rail(container)).getByRole('button', { name: 'Čistopis' }));
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('starts narrow, widens on the switch, and names every entry in both states', async () => {
    const container = await renderApp();
    expect(rail(container).className).toContain('rail--narrow');
    // The label is hidden from the eye, not from the accessibility tree.
    expect(within(rail(container)).getByRole('button', { name: 'Čistopis' })).toBeDefined();

    const toggle = screen.getByRole('button', { name: 'Rozbalit popisky' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(toggle);
    await waitFor(() => expect(rail(container).className).toContain('rail--wide'));
    const collapse = screen.getByRole('button', { name: 'Sbalit popisky' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(within(rail(container)).getByRole('button', { name: 'Čistopis' })).toBeDefined();
  });

  it('remembers the state for the next visit', async () => {
    const first = await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Rozbalit popisky' }));
    await waitFor(() => expect(rail(first).className).toContain('rail--wide'));

    cleanup();
    const second = await renderApp();
    expect(rail(second).className).toContain('rail--wide');
  });

  it('renders narrow when storage is blocked, rather than not rendering at all', async () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked in this window');
    });
    try {
      const container = await renderApp();
      expect(rail(container).className).toContain('rail--narrow');
    } finally {
      blocked.mockRestore();
    }
  });

  it('carries the rebuild action only where there is an adapter to run again', async () => {
    const container = await renderApp();
    // A static export has nothing behind it, so the entry is not there to be pressed.
    expect(within(rail(container)).queryByRole('button', { name: 'Přegenerovat' })).toBeNull();
    cleanup();

    let rebuilt = 0;
    const served = {
      ...createEmbeddedSource(sample),
      kind: 'api' as const,
      rebuild: async (): Promise<boolean> => {
        rebuilt += 1;
        return false;
      },
    };
    const { container: second } = render(<App source={served} />);
    await waitFor(() => expect(second.querySelector('[data-block]')).not.toBeNull());

    const header = within(second.querySelector('.app__header') as HTMLElement);
    expect(header.queryByRole('button', { name: 'Přegenerovat' })).toBeNull();
    await userEvent.click(within(rail(second)).getByRole('button', { name: 'Přegenerovat' }));
    expect(rebuilt).toBe(1);
  });

  it('walks its entries with the arrow keys', async () => {
    const container = await renderApp();
    const bar = within(rail(container));
    bar.getByRole('button', { name: 'Čistopis' }).focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(bar.getByRole('button', { name: 'Se změnami' }));

    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(bar.getByRole('button', { name: 'O nástroji' }));

    // The list wraps, so the last entry leads back to the first.
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(bar.getByRole('button', { name: 'Čistopis' }));
  });
});
