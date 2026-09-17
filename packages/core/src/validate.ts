import { BundleIndex } from './bundle-index.js';
import { SCHEMA_VERSION, bundleSchema } from './schema.js';
import type { Bundle } from './schema.js';
import { charCount } from './text.js';

/**
 * Validation is two passes with different jobs.
 *
 * The **schema** pass says the bundle has the right shape. The **invariant** pass says
 * the bundle is internally consistent - the checks listed in `fixtures/README.md`, which
 * no JSON Schema can express: that ids resolve, that the two directions of every
 * relation agree, that the declared character counts match the runs they describe.
 *
 * A bundle that passes the schema and fails an invariant is the dangerous one: it
 * renders, and it renders something wrong.
 */

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  /** Stable identifier of the rule, so a message can be looked up and a rule suppressed. */
  readonly rule: string;
  readonly severity: IssueSeverity;
  /** Where the problem is, as a JSON path into the bundle: `chapters[1].blocks[3].runs[2]`. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  /** Present only when the schema pass succeeded. */
  readonly bundle?: Bundle;
}

export interface ValidateOptions {
  /** Treat warnings as failures. Off by default - a warning is a smell, not a defect. */
  readonly strict?: boolean;
}

export function validateBundle(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue): ValidationIssue => ({
        rule: `schema/${issue.code}`,
        severity: 'error',
        path: formatPath(issue.path),
        message: issue.message,
      }),
    );
    return { valid: false, issues };
  }

  const bundle = parsed.data;
  const issues = [...checkSchemaVersion(bundle), ...checkInvariants(bundle)];
  const failed = issues.some(
    (issue) => issue.severity === 'error' || (options.strict === true && issue.severity === 'warning'),
  );
  return { valid: !failed, issues, bundle };
}

function checkSchemaVersion(bundle: Bundle): ValidationIssue[] {
  const major = bundle.schemaVersion.split('.')[0];
  const expected = SCHEMA_VERSION.split('.')[0];
  if (major === expected) return [];
  return [
    {
      rule: 'schema-version',
      severity: 'error',
      path: 'schemaVersion',
      message: `bundle is written against contract ${bundle.schemaVersion}, this build understands ${SCHEMA_VERSION}`,
    },
  ];
}

/** The invariants from `fixtures/README.md`, each one a named rule. */
export function checkInvariants(bundle: Bundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const index = new BundleIndex(bundle);
  const report = (issue: ValidationIssue): void => {
    issues.push(issue);
  };

  checkUniqueIds(bundle, report);
  checkRunAttribution(bundle, report);
  checkReferences(bundle, index, report);
  checkRevisionEditAgreement(bundle, index, report);
  checkCommentRevisionAgreement(bundle, index, report);
  checkDocumentOrder(bundle, index, report);
  checkEditShape(bundle, index, report);
  checkCharCounts(bundle, index, report);

  return issues;
}

type Report = (issue: ValidationIssue) => void;

function checkUniqueIds(bundle: Bundle, report: Report): void {
  const collections: [string, { id: string }[]][] = [
    ['chapters', bundle.chapters],
    ['revisions', bundle.revisions],
    ['comments', bundle.comments ?? []],
    ['edits', bundle.edits],
  ];
  for (const [name, items] of collections) {
    const seen = new Set<string>();
    items.forEach((item, position) => {
      if (seen.has(item.id)) {
        report({
          rule: 'unique-ids',
          severity: 'error',
          path: `${name}[${position}].id`,
          message: `duplicate id ${item.id} in ${name}`,
        });
      }
      seen.add(item.id);
    });
  }

  const blockIds = new Set<string>();
  bundle.chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      if (blockIds.has(block.id)) {
        report({
          rule: 'unique-ids',
          severity: 'error',
          path: `chapters[${chapterIndex}].blocks[${blockIndex}].id`,
          message: `duplicate block id ${block.id}`,
        });
      }
      blockIds.add(block.id);
    });
  });
}

function checkRunAttribution(bundle: Bundle, report: Report): void {
  bundle.chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      if (block.runs.length === 0) {
        report({
          rule: 'runs-present',
          severity: 'error',
          path: `chapters[${chapterIndex}].blocks[${blockIndex}].runs`,
          message: `block ${block.id} has no runs`,
        });
      }
      block.runs.forEach((run, runIndex) => {
        const path = `chapters[${chapterIndex}].blocks[${blockIndex}].runs[${runIndex}]`;
        if (run.text.length === 0) {
          report({
            rule: 'run-text-nonempty',
            severity: 'error',
            path,
            message: `empty run in block ${block.id}`,
          });
        }
        if (run.kind !== 'kept' && run.edit === undefined) {
          report({
            rule: 'run-attribution',
            severity: 'error',
            path,
            message: `${run.kind} run in block ${block.id} names revision ${run.revision} but no edit`,
          });
        }
      });

      // Two adjacent runs with the same attribution should have been merged by the
      // builder; leaving them apart makes the highlight look like two changes.
      for (let i = 1; i < block.runs.length; i += 1) {
        const previous = block.runs[i - 1];
        const current = block.runs[i];
        if (previous === undefined || current === undefined) continue;
        if (previous.kind !== current.kind) continue;
        const sameEdit = previous.edit === current.edit;
        const sameRevision =
          (previous.kind === 'kept' ? undefined : previous.revision) ===
          (current.kind === 'kept' ? undefined : current.revision);
        if (sameEdit && sameRevision) {
          report({
            rule: 'runs-merged',
            severity: 'warning',
            path: `chapters[${chapterIndex}].blocks[${blockIndex}].runs[${i}]`,
            message: `adjacent ${current.kind} runs with the same attribution in block ${block.id} were not merged`,
          });
        }
      }
    });
  });
}

function checkReferences(bundle: Bundle, index: BundleIndex, report: Report): void {
  const requireRevision = (id: string, path: string, rule: string): void => {
    if (index.getRevision(id) === undefined) {
      report({ rule, severity: 'error', path, message: `unknown revision ${id}` });
    }
  };

  bundle.chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      const blockPath = `chapters[${chapterIndex}].blocks[${blockIndex}]`;
      if (block.introducedBy !== undefined) {
        requireRevision(block.introducedBy, `${blockPath}.introducedBy`, 'reference-exists');
      }
      if (block.removedBy !== undefined) {
        requireRevision(block.removedBy, `${blockPath}.removedBy`, 'reference-exists');
      }
      block.runs.forEach((run, runIndex) => {
        const runPath = `${blockPath}.runs[${runIndex}]`;
        if (run.kind !== 'kept') {
          requireRevision(run.revision, `${runPath}.revision`, 'reference-exists');
        }
        if (run.edit !== undefined && index.getEdit(run.edit) === undefined) {
          report({
            rule: 'reference-exists',
            severity: 'error',
            path: `${runPath}.edit`,
            message: `unknown edit ${run.edit}`,
          });
        }
      });
    });
  });

  bundle.edits.forEach((edit, position) => {
    const path = `edits[${position}]`;
    requireRevision(edit.revision, `${path}.revision`, 'reference-exists');
    if (index.getChapter(edit.chapter) === undefined) {
      report({
        rule: 'reference-exists',
        severity: 'error',
        path: `${path}.chapter`,
        message: `unknown chapter ${edit.chapter}`,
      });
    }
    const location = index.getBlock(edit.block);
    if (location === undefined) {
      report({
        rule: 'reference-exists',
        severity: 'error',
        path: `${path}.block`,
        message: `unknown block ${edit.block}`,
      });
    } else if (location.chapter.id !== edit.chapter) {
      report({
        rule: 'edit-chapter-matches-block',
        severity: 'error',
        path: `${path}.chapter`,
        message: `edit ${edit.id} claims chapter ${edit.chapter} but block ${edit.block} sits in ${location.chapter.id}`,
      });
    }
    if (edit.movedFrom !== undefined && index.getBlock(edit.movedFrom) === undefined) {
      report({
        rule: 'reference-exists',
        severity: 'error',
        path: `${path}.movedFrom`,
        message: `unknown block ${edit.movedFrom}`,
      });
    }
  });

  bundle.revisions.forEach((revision, position) => {
    (revision.comments ?? []).forEach((commentId, i) => {
      if (index.getComment(commentId) === undefined) {
        report({
          rule: 'reference-exists',
          severity: 'error',
          path: `revisions[${position}].comments[${i}]`,
          message: `unknown comment ${commentId}`,
        });
      }
    });
    (revision.edits ?? []).forEach((editId, i) => {
      if (index.getEdit(editId) === undefined) {
        report({
          rule: 'reference-exists',
          severity: 'error',
          path: `revisions[${position}].edits[${i}]`,
          message: `unknown edit ${editId}`,
        });
      }
    });
  });

  (bundle.comments ?? []).forEach((comment, position) => {
    (comment.revisions ?? []).forEach((revisionId, i) => {
      requireRevision(revisionId, `comments[${position}].revisions[${i}]`, 'reference-exists');
    });
    (comment.scope ?? []).forEach((chapterId, i) => {
      if (index.getChapter(chapterId) === undefined) {
        report({
          rule: 'comment-scope-known',
          severity: 'warning',
          path: `comments[${position}].scope[${i}]`,
          message: `comment ${comment.id} is scoped to ${chapterId}, which is not a chapter of this bundle`,
        });
      }
    });
  });
}

function checkRevisionEditAgreement(bundle: Bundle, index: BundleIndex, report: Report): void {
  bundle.revisions.forEach((revision, position) => {
    const declared = revision.edits;
    if (declared === undefined) return;
    const actual = index.editsOfRevision(revision.id).map((edit) => edit.id);
    const declaredSet = new Set(declared);
    const actualSet = new Set(actual);

    for (const editId of declared) {
      if (!actualSet.has(editId) && index.getEdit(editId) !== undefined) {
        report({
          rule: 'revision-edits-agree',
          severity: 'error',
          path: `revisions[${position}].edits`,
          message: `revision ${revision.id} lists edit ${editId}, but that edit names revision ${index.getEdit(editId)?.revision}`,
        });
      }
    }
    for (const editId of actual) {
      if (!declaredSet.has(editId)) {
        report({
          rule: 'revision-edits-agree',
          severity: 'error',
          path: `revisions[${position}].edits`,
          message: `edit ${editId} names revision ${revision.id}, which does not list it`,
        });
      }
    }

    // The list is what the "next change of this revision" button walks, so its order is
    // part of the contract, not a detail.
    const inDocumentOrder = [...declared].sort((a, b) => index.rankOf(a) - index.rankOf(b));
    if (declared.join('\u0000') !== inDocumentOrder.join('\u0000')) {
      report({
        rule: 'revision-edits-ordered',
        severity: 'error',
        path: `revisions[${position}].edits`,
        message: `revision ${revision.id} lists its edits out of document order (expected ${inDocumentOrder.join(', ')})`,
      });
    }
  });
}

function checkCommentRevisionAgreement(bundle: Bundle, index: BundleIndex, report: Report): void {
  (bundle.comments ?? []).forEach((comment, position) => {
    for (const revisionId of comment.revisions ?? []) {
      const revision = index.getRevision(revisionId);
      if (revision === undefined) continue;
      if (!(revision.comments ?? []).includes(comment.id)) {
        report({
          rule: 'comment-revision-agree',
          severity: 'error',
          path: `comments[${position}].revisions`,
          message: `comment ${comment.id} names revision ${revisionId}, which does not name it back`,
        });
      }
    }
  });

  bundle.revisions.forEach((revision, position) => {
    for (const commentId of revision.comments ?? []) {
      const comment = index.getComment(commentId);
      if (comment === undefined) continue;
      if (comment.revisions !== undefined && !comment.revisions.includes(revision.id)) {
        report({
          rule: 'comment-revision-agree',
          severity: 'error',
          path: `revisions[${position}].comments`,
          message: `revision ${revision.id} answers comment ${commentId}, which does not name it back`,
        });
      }
    }
  });
}

function checkDocumentOrder(bundle: Bundle, index: BundleIndex, report: Report): void {
  const declared = bundle.edits.filter((edit) => edit.order !== undefined);
  if (declared.length === 0) return;

  const byDeclaredOrder = [...declared].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const byDocumentOrder = index.editsInDocumentOrder.filter((edit) => edit.order !== undefined);

  byDeclaredOrder.forEach((edit, position) => {
    const expected = byDocumentOrder[position];
    if (expected !== undefined && expected.id !== edit.id) {
      report({
        rule: 'edit-order',
        severity: 'error',
        path: `edits[${bundle.edits.indexOf(edit)}].order`,
        message: `edit ${edit.id} has order ${edit.order}, but document order puts ${expected.id} in that position`,
      });
    }
  });

  const seen = new Set<number>();
  bundle.edits.forEach((edit, position) => {
    if (edit.order === undefined) return;
    if (seen.has(edit.order)) {
      report({
        rule: 'edit-order',
        severity: 'error',
        path: `edits[${position}].order`,
        message: `order ${edit.order} is used by more than one edit`,
      });
    }
    seen.add(edit.order);
  });
}

function checkEditShape(bundle: Bundle, index: BundleIndex, report: Report): void {
  bundle.edits.forEach((edit, position) => {
    const path = `edits[${position}]`;
    const runs = index.runsOf(edit.id);
    const inserted = runs.filter(({ run }) => run.kind === 'inserted');
    const deleted = runs.filter(({ run }) => run.kind === 'deleted');

    if (runs.length === 0 && edit.kind !== 'delete-block') {
      report({
        rule: 'edit-has-runs',
        severity: 'error',
        path,
        message: `edit ${edit.id} (${edit.kind}) has no runs anywhere in the document`,
      });
      return;
    }

    for (const { location } of runs) {
      if (location.block.id !== edit.block) {
        report({
          rule: 'edit-runs-in-block',
          severity: 'error',
          path,
          message: `edit ${edit.id} claims block ${edit.block} but has a run in ${location.block.id}`,
        });
      }
    }

    switch (edit.kind) {
      case 'insert':
      case 'insert-block':
        if (deleted.length > 0) {
          report({
            rule: 'edit-kind-matches-runs',
            severity: 'error',
            path: `${path}.kind`,
            message: `edit ${edit.id} is an ${edit.kind} but carries deleted runs`,
          });
        }
        if (inserted.length === 0) {
          report({
            rule: 'edit-kind-matches-runs',
            severity: 'error',
            path: `${path}.kind`,
            message: `edit ${edit.id} is an ${edit.kind} but carries no inserted run`,
          });
        }
        break;
      case 'delete':
      case 'delete-block':
        if (inserted.length > 0) {
          report({
            rule: 'edit-kind-matches-runs',
            severity: 'error',
            path: `${path}.kind`,
            message: `edit ${edit.id} is a ${edit.kind} but carries inserted runs`,
          });
        }
        break;
      case 'replace':
        if (inserted.length === 0 || deleted.length === 0) {
          report({
            rule: 'edit-kind-matches-runs',
            severity: 'error',
            path: `${path}.kind`,
            message: `edit ${edit.id} is a replace but carries ${inserted.length} inserted and ${deleted.length} deleted runs`,
          });
        }
        break;
      case 'move':
        if (edit.movedFrom === undefined) {
          report({
            rule: 'edit-kind-matches-runs',
            severity: 'error',
            path: `${path}.movedFrom`,
            message: `edit ${edit.id} is a move but does not say where the text came from`,
          });
        }
        break;
    }

    // A block added or removed as a whole must say which revision did it, otherwise the
    // viewer has nothing to mark in the margin.
    const location = index.getBlock(edit.block);
    if (location !== undefined) {
      if (edit.kind === 'insert-block' && location.block.introducedBy !== edit.revision) {
        report({
          rule: 'whole-block-attribution',
          severity: 'error',
          path: `${path}.kind`,
          message: `edit ${edit.id} adds block ${edit.block} as a whole, but the block names introducedBy ${location.block.introducedBy ?? '(none)'}`,
        });
      }
      if (edit.kind === 'delete-block' && location.block.removedBy !== edit.revision) {
        report({
          rule: 'whole-block-attribution',
          severity: 'error',
          path: `${path}.kind`,
          message: `edit ${edit.id} removes block ${edit.block} as a whole, but the block names removedBy ${location.block.removedBy ?? '(none)'}`,
        });
      }
    }
  });
}

function checkCharCounts(bundle: Bundle, index: BundleIndex, report: Report): void {
  bundle.edits.forEach((edit, position) => {
    const runs = index.runsOf(edit.id);
    const inserted = sum(runs, 'inserted');
    const deleted = sum(runs, 'deleted');

    if (edit.insertedChars !== undefined && edit.insertedChars !== inserted) {
      report({
        rule: 'char-counts',
        severity: 'error',
        path: `edits[${position}].insertedChars`,
        message: `edit ${edit.id} declares ${edit.insertedChars} inserted characters, its runs hold ${inserted}`,
      });
    }
    if (edit.removedChars !== undefined && edit.removedChars !== deleted) {
      report({
        rule: 'char-counts',
        severity: 'error',
        path: `edits[${position}].removedChars`,
        message: `edit ${edit.id} declares ${edit.removedChars} removed characters, its runs hold ${deleted}`,
      });
    }
  });
}

function sum(runs: ReturnType<BundleIndex['runsOf']>, kind: 'inserted' | 'deleted'): number {
  return runs
    .filter(({ run }) => run.kind === kind)
    .reduce((total, { run }) => total + charCount(run.text), 0);
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === 'number') return `${accumulator}[${segment}]`;
    const name = String(segment);
    return accumulator.length === 0 ? name : `${accumulator}.${name}`;
  }, '');
}

/** One issue rendered as a line a person can act on. */
export function formatIssue(issue: ValidationIssue): string {
  return `${issue.severity === 'error' ? 'error' : 'warn '}  ${issue.path || '(root)'}: ${issue.message} [${issue.rule}]`;
}
