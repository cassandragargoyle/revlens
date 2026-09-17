import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { formatIssue, serializeBundle, validateBundle } from '@revlens/core';
import {
  buildBundle,
  findSourceAdapter,
  formatReport,
  listSourceAdapters,
} from '@revlens/adapters';
import type { RebuildSource } from '@revlens/server';
import {
  BundleState,
  createMcpServer,
  createServer,
  readBundle,
  serveMcpOverStdio,
} from '@revlens/server';
import { findWebRoot } from './paths.js';
import { writeStaticExport } from './static-export.js';

/**
 * `revlens build | validate | serve | sources`.
 *
 * One rule runs through all of it: with `--mcp` the process speaks a protocol on stdout,
 * so everything the CLI prints goes to stderr instead. The quiet path is the normal path,
 * rather than a mode that has to be remembered.
 */

const VERSION = '0.1.0';

/** Output that must never collide with the MCP protocol stream. */
let quiet = false;

function say(message: string): void {
  if (quiet) process.stderr.write(`${message}\n`);
  else process.stdout.write(`${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('revlens')
    .description(
      'Document revision viewer - the final text with every change highlighted in place, and the revision and the reviewer comment behind it',
    )
    .version(VERSION);

  program
    .command('sources')
    .description('list the source adapters this build knows')
    .action(() => {
      for (const adapter of listSourceAdapters()) {
        say(`${adapter.name}\n  ${adapter.description}`);
      }
    });

  program
    .command('build')
    .description('walk a repository and write a bundle')
    .requiredOption('-s, --source <name>', 'source adapter, see `revlens sources`')
    .requiredOption('-r, --repo <path>', 'repository holding the chapters')
    .requiredOption('-f, --from <rev>', 'baseline revision the history is measured against')
    .option('-t, --to <rev>', 'head revision', 'HEAD')
    .option('--records <path>', 'where the change log and the comment rounds live')
    .option('-o, --out <file>', 'bundle to write', 'bundle.json')
    .option('--threshold <number>', 'Dice threshold for block matching', '0.5')
    .option('--static [dir]', 'also write a self-contained directory that needs no server')
    .option('--report <file>', 'write the build report as JSON as well')
    .option('--allow-invalid', 'write the bundle even when it fails validation')
    .action(async (options) => {
      const adapter = findSourceAdapter(options.source);
      if (adapter === undefined) {
        warn(
          `unknown source ${options.source}; known sources: ${listSourceAdapters().map((entry) => entry.name).join(', ')}`,
        );
        process.exitCode = 2;
        return;
      }

      const { bundle, report } = await buildBundle(adapter, {
        repo: resolve(options.repo),
        from: options.from,
        to: options.to,
        ...(options.records === undefined ? {} : { records: resolve(options.records) }),
        threshold: Number(options.threshold),
      });

      const validation = validateBundle(bundle);
      if (!validation.valid && options.allowInvalid !== true) {
        // Errors first: a truncated list that showed only warnings would hide the very
        // thing that stopped the build.
        const errors = validation.issues.filter((issue) => issue.severity === 'error');
        const warnings = validation.issues.filter((issue) => issue.severity === 'warning');
        warn(
          `the built bundle does not satisfy its own invariants: ${errors.length} errors, ${warnings.length} warnings`,
        );
        for (const issue of errors.slice(0, 20)) warn(`  ${formatIssue(issue)}`);
        if (errors.length > 20) warn(`  ... and ${errors.length - 20} more errors`);
        warn('nothing was written; re-run with --allow-invalid to write it anyway');
        process.exitCode = 1;
        return;
      }

      const out = resolve(options.out);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, serializeBundle(bundle), 'utf8');
      say(`wrote ${out}`);

      if (options.report !== undefined) {
        const reportPath = resolve(options.report);
        await mkdir(dirname(reportPath), { recursive: true });
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        say(`wrote ${reportPath}`);
      }

      if (options.static !== undefined) {
        const webRoot = findWebRoot();
        if (webRoot === undefined) {
          warn('the viewer is not built; run `npm run build` before --static');
          process.exitCode = 1;
          return;
        }
        const target = resolve(
          typeof options.static === 'string' ? options.static : `${out.replace(/\.json$/, '')}-static`,
        );
        const result = await writeStaticExport(webRoot, target, bundle);
        say(`wrote ${result.directory} (self-contained, open index.html)`);
      }

      say('');
      say(formatReport(report));
    });

  program
    .command('validate')
    .description('check a bundle against the schema and the invariants')
    .argument('<bundle>', 'bundle to check')
    .option('--strict', 'treat warnings as failures')
    .action(async (path: string, options: { strict?: boolean }) => {
      const contents = await readFile(resolve(path), 'utf8').catch(() => undefined);
      if (contents === undefined) {
        warn(`cannot read ${path}`);
        process.exitCode = 2;
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch (error) {
        warn(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
      }

      const result = validateBundle(parsed, { strict: options.strict === true });
      for (const issue of result.issues) {
        warn(`${path}: ${formatIssue(issue)}`);
      }

      if (result.valid) {
        const errors = result.issues.filter((issue) => issue.severity === 'error').length;
        say(
          `${path} is valid${result.issues.length === 0 ? '' : ` (${result.issues.length - errors} warnings)`}`,
        );
        return;
      }

      warn(`${path} is not valid (${result.issues.length} issues)`);
      process.exitCode = 1;
    });

  program
    .command('serve')
    .description('serve the viewer and the read-only API on the loopback interface')
    .argument('[bundle]', 'bundle to serve', 'bundle.json')
    .option('-p, --port <number>', 'port', '4173')
    .option('-H, --host <address>', 'interface to bind', '127.0.0.1')
    .option('--mcp', 'also speak MCP on stdio, so an assistant can drive the tool')
    .option('--source <name>', 'source adapter, to enable rebuilding')
    .option('--repo <path>', 'repository holding the chapters, to enable rebuilding')
    .option('--from <rev>', 'baseline revision, to enable rebuilding')
    .option('--to <rev>', 'head revision', 'HEAD')
    .option('--records <path>', 'where the change log and the comment rounds live')
    .option('--threshold <number>', 'Dice threshold for block matching', '0.5')
    .action(async (bundlePath: string, options) => {
      quiet = options.mcp === true;

      const path = resolve(bundlePath);
      const rebuild = toRebuildSource(options);
      const state = await BundleState.fromFile(path, rebuild);
      const webRoot = findWebRoot();

      const app = await createServer({
        state,
        ...(webRoot === undefined ? {} : { webRoot }),
        quiet,
      });

      const port = Number(options.port);
      const host = String(options.host);
      await app.listen({ port, host });

      say(`revlens is serving ${path}`);
      say(`  http://${host}:${port}/`);
      if (webRoot === undefined) {
        warn('  the viewer is not built, so only the API is served; run `npm run build`');
      }
      if (rebuild === undefined) {
        say('  POST /api/rebuild will re-read the bundle file');
      } else {
        say(`  POST /api/rebuild will re-run the ${rebuild.adapter.name} adapter`);
      }

      if (options.mcp === true) {
        const mcp = createMcpServer({ state, version: VERSION });
        await serveMcpOverStdio(mcp);
        say('  MCP is listening on stdio');
      }
    });

  return program;
}

function toRebuildSource(options: {
  source?: string;
  repo?: string;
  from?: string;
  to?: string;
  records?: string;
  threshold?: string;
}): RebuildSource | undefined {
  if (options.source === undefined || options.repo === undefined || options.from === undefined) {
    return undefined;
  }
  const adapter = findSourceAdapter(options.source);
  if (adapter === undefined) return undefined;

  return {
    adapter,
    options: {
      repo: resolve(options.repo),
      from: options.from,
      ...(options.to === undefined ? {} : { to: options.to }),
      ...(options.records === undefined ? {} : { records: resolve(options.records) }),
      ...(options.threshold === undefined ? {} : { threshold: Number(options.threshold) }),
    },
  };
}

export async function run(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync([...argv]);
}

export { readBundle };
