import { run } from './main.js';

/**
 * The entry that actually runs the CLI.
 *
 * `main.ts` only builds and exports the program, so it can be imported by tests and by
 * the MCP server without a command being parsed as a side effect. Starting it is this
 * file's one job, and it is the only place that calls `run` - `bin/revlens.js` is the
 * published wrapper around the compiled form of it, and `npm run revlens` runs it from
 * source through tsx.
 */

await run();
