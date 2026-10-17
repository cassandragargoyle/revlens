// What a build was asked for, remembered per repository and per written bundle
// Kept free of `vscode` so the rules are tested without an editor process

import { basename, join, resolve } from 'node:path';

/** What the dialogs collected, ready for `runBuild` */
export interface BuildAnswers {
    readonly source: string;
    readonly repo: string;
    readonly from: string;
    /** Empty or absent means the working revision */
    readonly to?: string;
    /** Absent when the reader skipped the question */
    readonly records?: string;
    readonly out: string;
}

/**
 * Where the answers are kept; structurally a `vscode.Memento`.
 *
 * Visual Studio Code hands the extension `workspaceState`. The State A host has none, so
 * there the store is `memoryStore()` and a rebuild works until the window closes.
 */
export interface AnswerStore {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): PromiseLike<void>;
}

/** A store that lives as long as the extension does - the fallback for a host without one */
export function memoryStore(): AnswerStore {
    const values = new Map<string, unknown>();
    return {
        get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
        update: (key: string, value: unknown): PromiseLike<void> => {
            values.set(key, value);
            return Promise.resolve();
        },
    };
}

const REPO_KEY = 'revlens.build.repo:';
const BUNDLE_KEY = 'revlens.build.bundle:';

/** The answers last given for a repository, which become the next form's defaults */
export function answersForRepo(store: AnswerStore, repo: string): BuildAnswers | undefined {
    return store.get<BuildAnswers>(REPO_KEY + resolve(repo));
}

/**
 * The answers that wrote a bundle, which is what a rebuild runs again.
 *
 * Kept by the extension rather than in the bundle: the contract records the baseline and
 * the generator, not the source adapter, the repository or the records path, and a
 * bundle is sent to other people - the reader's directory layout has no business in it.
 */
export function answersForBundle(store: AnswerStore, out: string): BuildAnswers | undefined {
    return store.get<BuildAnswers>(BUNDLE_KEY + resolve(out));
}

/** Remember a build that succeeded, under both of the keys it is looked up by */
export async function rememberAnswers(store: AnswerStore, answers: BuildAnswers): Promise<void> {
    await store.update(REPO_KEY + resolve(answers.repo), answers);
    await store.update(BUNDLE_KEY + resolve(answers.out), answers);
}

/**
 * Where a bundle goes when the reader has not said.
 *
 * `out/` beside the history it was built from, named after the repository. The compound
 * suffix is the one both hosts claim: Pilot matches a file type as a suffix, longest
 * first (portunix-vscode #120). `out/` keeps the bundle apart from the chapters, the way
 * `revlens build` does in this repository.
 */
export function defaultOutput(repo: string): string {
    return join(resolve(repo), 'out', `${basename(resolve(repo))}.revlens.json`);
}
