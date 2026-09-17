import { engagementAdapter } from './engagement.js';
import type { SourceAdapter } from './types.js';

/**
 * The sources the CLI knows by name. A new engagement, or an OOXML adapter reading Word
 * tracked changes, is a new entry here and nothing else - the builder and the viewer do
 * not change.
 */
const adapters: readonly SourceAdapter[] = [engagementAdapter];

export function listSourceAdapters(): readonly SourceAdapter[] {
  return adapters;
}

export function findSourceAdapter(name: string): SourceAdapter | undefined {
  return adapters.find((adapter) => adapter.name === name);
}
