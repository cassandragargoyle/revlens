// The version of RevLens the reader is looking at, baked in at build time
// One value for all three hosts, because all three embed this same built viewer

/**
 * Substituted by the bundler from the workspace version; see `vite.config.ts`.
 *
 * `typeof` rather than a bare read: the identifier is replaced textually where a define
 * is configured and is simply absent where one is not, and a viewer that threw on an
 * unconfigured build would be worse than one that says `dev`.
 */
declare const __REVLENS_VERSION__: string;

export const VERSION: string =
  typeof __REVLENS_VERSION__ === 'string' ? __REVLENS_VERSION__ : 'dev';
