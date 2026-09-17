import type { Bundle, Chapter } from '@revlens/core';
import { bundleSchema } from '@revlens/core';

/**
 * Where the viewer gets its data.
 *
 * Two shapes, one interface. The **embedded** source is what `revlens build --static`
 * produces: the whole bundle on a global, so the page works from the file system with no
 * server - a `file://` page may not fetch a local JSON file. The **API** source loads the
 * metadata first and each chapter on demand, so a 150-page document does not have to
 * cross the wire before the first paint.
 */

export interface BundleSource {
  readonly kind: 'embedded' | 'api';
  /** Everything except the chapter text. */
  load(): Promise<Bundle>;
  /** One chapter with its blocks and runs. */
  chapter(id: string): Promise<Chapter | undefined>;
  /** Re-runs the adapter where the server can; resolves to false where it cannot. */
  rebuild(): Promise<boolean>;
}

/** Shape of `GET /api/bundle` - the bundle without its chapter text. */
interface BundleSummaryResponse {
  readonly schemaVersion: unknown;
  readonly document: unknown;
  readonly chapters: readonly {
    id: string;
    title: string;
    number?: string;
    source?: string;
  }[];
  readonly revisions: unknown;
  readonly comments?: unknown;
  readonly edits: unknown;
}

const GLOBAL = '__REVLENS_BUNDLE__';

export function detectSource(): BundleSource {
  const embedded = (globalThis as Record<string, unknown>)[GLOBAL];
  if (embedded !== undefined && embedded !== null) {
    return createEmbeddedSource(embedded);
  }
  return createApiSource();
}

export function createEmbeddedSource(payload: unknown): BundleSource {
  const bundle = bundleSchema.parse(payload);
  return {
    kind: 'embedded',
    async load(): Promise<Bundle> {
      return bundle;
    },
    async chapter(id: string): Promise<Chapter | undefined> {
      return bundle.chapters.find((chapter) => chapter.id === id);
    },
    async rebuild(): Promise<boolean> {
      // A static export has no adapter behind it, and saying so is better than pretending.
      return false;
    },
  };
}

export function createApiSource(baseUrl = ''): BundleSource {
  const cache = new Map<string, Chapter>();

  return {
    kind: 'api',

    async load(): Promise<Bundle> {
      const payload = (await getJson(`${baseUrl}/api/bundle`)) as BundleSummaryResponse;
      // The summary carries no chapter text; chapters arrive on demand, so the bundle is
      // assembled here with empty block lists standing in for them. The summary's own
      // fields - the state version, the per-chapter counts, the totals - are dropped,
      // because the contract has no place for them and `BundleIndex` derives them anyway.
      return bundleSchema.parse({
        schemaVersion: payload.schemaVersion,
        document: payload.document,
        chapters: payload.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          ...(chapter.number === undefined ? {} : { number: chapter.number }),
          ...(chapter.source === undefined ? {} : { source: chapter.source }),
          blocks: [],
        })),
        revisions: payload.revisions,
        ...(payload.comments === undefined ? {} : { comments: payload.comments }),
        edits: payload.edits,
      });
    },

    async chapter(id: string): Promise<Chapter | undefined> {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const payload = (await getJson(`${baseUrl}/api/chapters/${encodeURIComponent(id)}`)) as {
        chapter?: Chapter;
      };
      if (payload.chapter === undefined) return undefined;
      cache.set(id, payload.chapter);
      return payload.chapter;
    },

    async rebuild(): Promise<boolean> {
      const response = await fetch(`${baseUrl}/api/rebuild`, { method: 'POST' });
      if (!response.ok) return false;
      cache.clear();
      return true;
    },
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return (await response.json()) as unknown;
}
