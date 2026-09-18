// The target list `make help` prints, read out of the Makefile itself
// Plain Node and no dependencies, so it answers on a fresh clone and under cmd.exe

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `make help`, without grep, sed and awk.
 *
 * Those three are the reason the rest of the Makefile used to need a POSIX shell, which
 * on Windows means running it from Git Bash and nowhere else. Every other recipe is an
 * `npm run`, and cmd.exe can do that much, so this one job moved here and the Makefile
 * became something that runs from any prompt.
 *
 * The targets are still read out of the Makefile rather than written down twice: a target
 * documents itself with `## ` after its colon, and one that does not is internal.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCUMENTED = /^([a-z-]+):.*?## (.*)$/;

/** The settings are make's own, after its defaults and anything given on the command line. */
function argument(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? '' : (process.argv[at + 1] ?? '');
}

function targets(makefile) {
  return makefile
    .split(/\r?\n/)
    .map((line) => DOCUMENTED.exec(line))
    .filter((match) => match !== null)
    .map((match) => `  ${match[1].padEnd(16)} ${match[2].trim()}`);
}

const makefile = readFileSync(join(root, 'Makefile'), 'utf8');

const lines = [
  'revlens - build the tool and run it against an example',
  '',
  'Targets:',
  ...targets(makefile),
  '',
  'Settings:',
  `  EXAMPLE  = ${argument('example')}`,
  `  LANGUAGE = ${argument('language')}   (the example is written in en and cs)`,
  `  OUT      = ${argument('out')}`,
  `  PORT     = ${argument('port')}`,
];

process.stdout.write(`${lines.join('\n')}\n`);
