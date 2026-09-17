import { readFile } from 'node:fs/promises';
import type { Bundle } from '@revlens/core';
import { BundleIndex, formatIssue, validateBundle } from '@revlens/core';
import type { BuildOptions, BuildReport, SourceAdapter } from '@revlens/adapters';
import { buildBundle } from '@revlens/adapters';

/**
 * The one copy of the bundle the process serves.
 *
 * The browser and the MCP tools read the same state, so a rebuild reaches both at once
 * and there is no second copy that can go stale. Nothing here is persisted: the bundle
 * is a generated file and the repository is the source of truth.
 */

export interface RebuildSource {
  readonly adapter: SourceAdapter;
  readonly options: BuildOptions;
}

export class BundleState {
  private current: Bundle;
  private currentIndex: BundleIndex;
  private currentVersion = 1;
  private lastReport?: BuildReport;
  private readonly rebuildSource?: RebuildSource;
  private readonly path?: string;

  constructor(bundle: Bundle, options: { path?: string; rebuild?: RebuildSource } = {}) {
    this.current = bundle;
    this.currentIndex = new BundleIndex(bundle);
    if (options.path !== undefined) this.path = options.path;
    if (options.rebuild !== undefined) this.rebuildSource = options.rebuild;
  }

  static async fromFile(
    path: string,
    rebuild?: RebuildSource,
  ): Promise<BundleState> {
    const bundle = await readBundle(path);
    return new BundleState(bundle, { path, ...(rebuild === undefined ? {} : { rebuild }) });
  }

  get bundle(): Bundle {
    return this.current;
  }

  get index(): BundleIndex {
    return this.currentIndex;
  }

  /** Increments on every swap, so a client can tell it is looking at stale data. */
  get version(): number {
    return this.currentVersion;
  }

  get report(): BuildReport | undefined {
    return this.lastReport;
  }

  get canRebuild(): boolean {
    return this.rebuildSource !== undefined || this.path !== undefined;
  }

  /**
   * Re-run the adapter and swap the result in, or re-read the file when the server was
   * started from a bundle rather than from a source. A bundle that does not validate is
   * refused: serving a broken one would be worse than serving the previous one.
   */
  async rebuild(): Promise<{ report?: BuildReport; issues: string[] }> {
    if (this.rebuildSource !== undefined) {
      const { bundle, report } = await buildBundle(
        this.rebuildSource.adapter,
        this.rebuildSource.options,
      );
      const issues = this.swap(bundle);
      this.lastReport = report;
      return { report, issues };
    }

    if (this.path === undefined) {
      throw new Error('this server has nothing to rebuild from');
    }

    const bundle = await readBundle(this.path);
    return { issues: this.swap(bundle) };
  }

  private swap(bundle: Bundle): string[] {
    const result = validateBundle(bundle);
    if (!result.valid) {
      return result.issues.map(formatIssue);
    }
    this.current = bundle;
    this.currentIndex = new BundleIndex(bundle);
    this.currentVersion += 1;
    return result.issues.map(formatIssue);
  }
}

export async function readBundle(path: string): Promise<Bundle> {
  const contents = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(contents);
  const result = validateBundle(parsed);
  if (result.bundle === undefined || !result.valid) {
    const detail = result.issues.slice(0, 5).map(formatIssue).join('\n');
    throw new Error(`${path} is not a valid revlens bundle:\n${detail}`);
  }
  return result.bundle;
}
