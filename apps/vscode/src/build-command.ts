import * as vscode from 'vscode';
import { listSources, runBuild } from '@revlens/adapters';
import { BundleEditorProvider } from './bundle-editor.js';
import type { AnswerStore, BuildAnswers } from './build-memory.js';
import { answersForBundle, answersForRepo, defaultOutput, rememberAnswers } from './build-memory.js';

/**
 * `revlens.buildBundle` and `revlens.rebuildBundle` - produce a bundle without leaving
 * the host.
 *
 * The viewer could always render a bundle; making one meant a checkout and a command
 * line (portunix-vscode #121). This asks for what a build needs, runs it, prints the
 * report it produced, and opens the result.
 *
 * `runBuild` is imported from `packages/adapters`, the same call the desktop window
 * makes and the same code path `revlens build` takes. Nothing is shelled out to and no
 * server is started: an editor host cannot assume a checkout, an npm and a `tsx` on the
 * machine, and a second implementation of the build is the one thing worth avoiding
 * more than a large bundle.
 */

export type { BuildAnswers } from './build-memory.js';

/** Where the build's output goes; structurally a `vscode.OutputChannel` */
export interface BuildLog {
    readonly name: string;
    appendLine(value: string): void;
    show(): void;
}

/** What a build command needs from the extension around it */
export interface BuildContext {
    readonly channel: BuildLog;
    readonly store: AnswerStore;
    readonly provider: BundleEditorProvider;
    /** Whether `window.withProgress` exists; the State A host has no notifications area */
    readonly progress: boolean;
}

interface SourceItem extends vscode.QuickPickItem {
    readonly name: string;
}

/**
 * The source adapters this build knows, as quick-pick items.
 *
 * Read from the registry rather than hard-coded, so an adapter added to
 * `packages/adapters` appears here without anybody remembering to update a list.
 */
export function sourceChoices(): SourceItem[] {
    return listSources().map((source) => ({
        label: source.name,
        detail: source.description,
        name: source.name,
    }));
}

/** The repository: the folder the command came from, else asked, starting at the workspace */
async function pickRepo(folder: vscode.Uri | undefined): Promise<string | undefined> {
    // The folder arrives from the explorer context menu, whose label says **Build
    // Revision Bundle** on a directory. What a reader right-clicks there is the
    // repository they want analysed, so that is the question it answers.
    if (folder !== undefined) return folder.fsPath;

    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Use as repository',
        title: 'Repository holding the chapters',
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    return picked?.[0]?.fsPath;
}

/**
 * Ask for everything a build requires; undefined means the reader backed out.
 *
 * Native pickers only, so the form works with no folder open and in a host with no
 * webview form of its own. Every question defaults to the last answer for the same
 * repository, which turns the second build into a row of Enter presses.
 */
async function collectAnswers(
    store: AnswerStore,
    folder: vscode.Uri | undefined,
): Promise<BuildAnswers | undefined> {
    const repo = await pickRepo(folder);
    if (repo === undefined) return undefined;
    const last = answersForRepo(store, repo);

    const choices = sourceChoices();
    // One adapter is not a choice worth making; more than one is
    const source =
        choices.length === 1
            ? choices[0]?.name
            : (
                  await vscode.window.showQuickPick(choices, {
                      title: 'Source adapter',
                      placeHolder: last === undefined
                          ? 'Which adapter reads these records'
                          : `Last time: ${last.source}`,
                  })
              )?.name;
    if (source === undefined) return undefined;

    const from = await vscode.window.showInputBox({
        title: 'Baseline revision',
        prompt: 'The build the reviewers received - a tag, a branch or a commit',
        value: last?.from ?? 'baseline',
    });
    if (from === undefined || from.trim() === '') return undefined;

    const to = await vscode.window.showInputBox({
        title: 'Head revision',
        prompt: 'Leave empty to measure the working revision',
        value: last?.to ?? '',
    });
    if (to === undefined) return undefined;

    const records = await pickRecords(repo, last?.records);
    if (records === null) return undefined;

    const out = await vscode.window.showSaveDialog({
        title: 'Write the bundle to',
        saveLabel: 'Build',
        defaultUri: vscode.Uri.file(last?.out ?? defaultOutput(repo)),
        filters: { 'Revision bundle': ['revlens.json', 'revlens'] },
    });
    if (out === undefined) return undefined;

    return {
        source,
        repo,
        from: from.trim(),
        ...(to.trim() === '' ? {} : { to: to.trim() }),
        ...(records === undefined ? {} : { records }),
        out: out.fsPath,
    };
}

/**
 * The records may be skipped: a build without them still shows every change, only
 * without the instruction and the comment behind it. `null` is backing out, `undefined`
 * is skipping.
 */
async function pickRecords(repo: string, last: string | undefined): Promise<string | undefined | null> {
    const choose = 'Choose the records folder…';
    const skip = 'Build without records';
    const reuse = last === undefined ? undefined : `Use ${last}`;

    const answer = await vscode.window.showQuickPick(
        reuse === undefined ? [choose, skip] : [reuse, choose, skip],
        {
            title: 'Records: the change log and the comment rounds',
            placeHolder: 'Without them the bundle shows the changes but not the reasons',
        },
    );
    if (answer === undefined) return null;
    if (answer === skip) return undefined;
    if (answer === reuse) return last;

    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Use as records',
        title: 'Records: the change log and the comment rounds',
        defaultUri: vscode.Uri.file(last ?? repo),
    });
    return picked?.[0]?.fsPath ?? null;
}

/** Run one build with the progress the host can show, and report it in the channel */
async function build(context: BuildContext, answers: BuildAnswers): Promise<boolean> {
    const { channel } = context;
    channel.show();
    channel.appendLine(`building ${answers.out}`);
    channel.appendLine(
        `  source ${answers.source}, repo ${answers.repo}, from ${answers.from}` +
            ` to ${answers.to ?? '(working revision)'}`,
    );
    channel.appendLine(`  records ${answers.records ?? '(none)'}`);

    const outcome = await withProgressIfAny(context.progress, 'Building the revision bundle', () =>
        runBuild(answers),
    );

    if (!outcome.ok) {
        // The problem is one sentence and the detail is the rest, the way the desktop
        // window reports it; both go to the channel so nothing is lost behind a dialog
        channel.appendLine(`\n${outcome.problem}`);
        for (const line of outcome.detail) channel.appendLine(`  ${line}`);
        await vscode.window.showErrorMessage(outcome.problem);
        return false;
    }

    channel.appendLine(`\n${outcome.summary}`);
    for (const warning of outcome.warnings) channel.appendLine(`warning: ${warning}`);
    channel.appendLine(`\nwrote ${outcome.out}`);

    await rememberAnswers(context.store, { ...answers, out: outcome.out });
    return true;
}

/**
 * A notification with a spinner where the host has one, the bare task where it does not.
 *
 * The State A host has no `withProgress`; the build still runs there and the output
 * channel still says when it ended.
 */
export async function withProgressIfAny<T>(
    available: boolean,
    title: string,
    task: () => Promise<T>,
): Promise<T> {
    if (!available) return task();
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        task,
    );
}

/**
 * `revlens.buildBundle`. `folder` arrives when the command was invoked on a folder in
 * the explorer context menu, and it is the repository.
 */
export async function buildBundleCommand(context: BuildContext, folder?: vscode.Uri): Promise<void> {
    const answers = await collectAnswers(context.store, folder);
    if (answers === undefined) return;
    if (!(await build(context, answers))) return;

    await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(answers.out),
        BundleEditorProvider.viewType,
    );
}

/**
 * `revlens.rebuildBundle` - run again the build that wrote the open bundle.
 *
 * `bundle` is the file the command was invoked on, else the bundle in the active tab.
 * With nothing remembered for it the form is offered, starting from its folder, rather
 * than an error: the reader asked for a build and the form is how one is had.
 */
export async function rebuildBundleCommand(context: BuildContext, bundle?: vscode.Uri): Promise<void> {
    const target = bundle?.fsPath ?? context.provider.activeBundle();
    const remembered = target === undefined ? undefined : answersForBundle(context.store, target);

    if (remembered === undefined) {
        context.channel.appendLine(
            target === undefined
                ? 'rebuild: no bundle is open, so the build form is offered instead'
                : `rebuild: nothing is remembered for ${target}, so the build form is offered instead`,
        );
        await buildBundleCommand(context);
        return;
    }

    if (!(await build(context, remembered))) return;
    // The file watcher usually gets there first; where the host has none, or the reader
    // switched it off, this is what makes the tab show the new result
    await context.provider.reload(remembered.out);
}
