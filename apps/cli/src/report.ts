import type { BuildReport } from '@revlens/adapters';

/**
 * The build report as a person reads it.
 *
 * The number that matters is `unexplained` - how much of the document the join could not
 * account for. It is printed whether it is zero or not, because a report that only
 * mentions problems lets an incomplete join look like a complete one.
 */
export function formatReport(report: BuildReport): string {
  const lines = [
    `source        ${report.source}`,
    `repository    ${report.repo}`,
    `baseline      ${report.baseline.slice(0, 10)}`,
    `head          ${report.head.slice(0, 10)}`,
    `threshold     ${report.threshold}`,
    '',
    `commits       ${report.commits}`,
    `revisions     ${report.revisions}${report.commitsWithoutRecord > 0 ? `  (${report.commitsWithoutRecord} with no record behind them)` : ''}`,
    `edits         ${report.edits}`,
    `unexplained   ${report.unexplainedEdits}${report.unexplainedEdits === 0 ? '' : '  <- edits whose revision has no record'}`,
    `comments      ${report.commentsJoined} of ${report.comments} joined to a revision`,
    `churn         ${report.churnTokens} words and ${report.churnBlocks} blocks written and withdrawn`,
    `near threshold ${report.nearThresholdMatches} block matches close enough that another threshold would flip them`,
    `duration      ${(report.durationMs / 1000).toFixed(1)} s`,
    '',
    'chapters',
    ...report.chapters.map(
      (chapter) =>
        `  ${chapter.id.padEnd(22)} ${String(chapter.edits).padStart(4)} edits  ${String(chapter.blocks).padStart(4)} blocks  ${chapter.title}`,
    ),
  ];

  if (report.warnings.length > 0) {
    lines.push('', `warnings (${report.warnings.length})`);
    for (const warning of report.warnings.slice(0, 20)) lines.push(`  ${warning}`);
    if (report.warnings.length > 20) {
      lines.push(`  ... and ${report.warnings.length - 20} more`);
    }
  }

  return lines.join('\n');
}
