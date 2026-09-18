// What an example is, as the catalogue and the seeding read it
// The manifest is committed beside the example; everything else is produced from it

/** `example.json`: what a picker needs to offer an example, in every language it has */
export interface ExampleManifest {
  readonly id: string;
  /** Language codes the example is written in, in the order a picker should show them */
  readonly languages: readonly string[];
  /** One line per language, keyed by code */
  readonly title: Readonly<Record<string, string>>;
  /** A sentence per language, keyed by code */
  readonly description: Readonly<Record<string, string>>;
  /** What a build of this example needs; declared rather than assumed by the caller */
  readonly build: {
    readonly source: string;
    readonly from: string;
  };
}

/** One example, resolved for one language - what a quick pick renders */
export interface ExampleChoice {
  readonly id: string;
  readonly language: string;
  readonly title: string;
  readonly description: string;
  /** Every language this example has, so a caller can offer a second pick */
  readonly languages: readonly string[];
}

/** One commit of an example's history, as `history/history.json` records it */
export interface ExampleStep {
  readonly directory: string;
  readonly message: string;
  /** Author date, ISO 8601 with an offset - the records join to its calendar day */
  readonly at: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly tag?: string;
}

export interface ExampleHistory {
  readonly repository?: string;
  readonly branch?: string;
  readonly steps: readonly ExampleStep[];
}

export interface SeedRequest {
  /** The example directory, or the language variant inside it */
  readonly example: string;
  readonly language?: string;
  /** Where the repository is written */
  readonly out: string;
  /** Remove a directory this seeding did not write */
  readonly force?: boolean;
}

export interface SeedResult {
  readonly repository: string;
  /** The directory holding `docs/` and `history/` - what `--records` wants */
  readonly records: string;
  readonly commits: number;
  /** The tag the baseline carries, which is what `--from` names */
  readonly baseline: string | undefined;
  readonly steps: readonly { readonly at: string; readonly message: string }[];
}

export interface TryExampleRequest {
  /** The directory holding the examples - `examples/` in a checkout, `media/examples` in a host */
  readonly root: string;
  readonly id: string;
  readonly language: string;
  /** Where everything is written: the records, the repository and the bundle */
  readonly target: string;
}

export type TryExampleOutcome =
  | {
      readonly ok: true;
      /** The bundle that was written, ready to open */
      readonly out: string;
      readonly records: string;
      readonly repository: string;
      readonly summary: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly ok: false;
      readonly problem: string;
      readonly detail: readonly string[];
    };
