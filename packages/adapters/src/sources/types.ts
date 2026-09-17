import type { Comment, Person, RevisionKind } from '@revlens/core';
import type { CommitRecord } from '../git/git.js';

/**
 * A source adapter turns one repository into the two things the builder needs: the list
 * of chapters to walk, and the records that explain the commits.
 *
 * It does not produce runs, edits or attribution - that is the builder's job and is the
 * same for every source. Adding a source (Word tracked changes, another engagement)
 * means implementing this interface, not touching the blame.
 */

export interface ChapterFile {
  readonly id: string;
  readonly number?: string;
  readonly title: string;
  /** Path of the chapter file, relative to the repository root. */
  readonly path: string;
}

export interface DocumentSeed {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly language?: string;
  readonly version: string;
  readonly baseline?: {
    readonly version: string;
    readonly label?: string;
    readonly at?: string;
    readonly commit?: string;
  };
}

/** One act that changed the text, before it is given an id and its edits. */
export interface RevisionSeed {
  readonly kind: RevisionKind;
  readonly at: string;
  readonly author: Person;
  readonly title: string;
  readonly verbatim?: string;
  readonly why?: string;
  readonly commit?: string;
  readonly origin?: string;
  readonly comments: readonly string[];
  /**
   * Chapters this seed accounts for. Empty means "every chapter this commit touched",
   * which is the ordinary case of one instruction per commit.
   */
  readonly chapters: readonly string[];
}

export interface SourceOptions {
  /** Repository holding the chapters. */
  readonly repo: string;
  /** Baseline revision - the build the reviewers received. */
  readonly from: string;
  /** Head revision; defaults to HEAD. */
  readonly to?: string;
  /** Where the change log and the comment rounds live; the adapter has a default. */
  readonly records?: string;
}

export interface LoadedSource {
  readonly document: DocumentSeed;
  readonly chapters: readonly ChapterFile[];
  readonly comments: readonly Comment[];
  /**
   * What explains this commit. An empty result means the commit has no record behind it;
   * the builder then makes an `unknown` revision and counts it in the report.
   */
  explain(commit: CommitRecord, touchedChapters: readonly ChapterFile[]): RevisionSeed[];
  /** Warnings worth carrying into the build report - records that did not join. */
  warnings(): string[];
}

export interface SourceAdapter {
  readonly name: string;
  readonly description: string;
  load(options: SourceOptions): Promise<LoadedSource>;
}
