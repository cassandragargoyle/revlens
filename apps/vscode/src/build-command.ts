import { join } from 'node:path';
import * as vscode from 'vscode';
import { listSources, runBuild } from '@revlens/adapters';
import { BundleEditorProvider } from './bundle-editor.js';

/**
 * `revlens.buildBundle` — produce a bundle without leaving the host.
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

/** Where the build's output goes; structurally a `vscode.OutputChannel` */
export interface BuildLog {
    readonly name: string;
    appendLine(value: string): void;
    show(): void;
}

/** What the dialogs collected, ready for `runBuild` */
export interface BuildAnswers {
    readonly records: string;
    readonly repo: string;
    readonly source: string;
    readonly from: string;
    readonly out: string;
}

/**
 * The source adapters this build knows, as quick-pick labels.
 *
 * Read from the registry rather than hard-coded, so an adapter added to
 * `packages/adapters` appears here without anybody remembering to update a list.
 */
export function sourceChoices(): string[] {
    return listSources().map((source) => source.name);
}

/** Ask for everything a build requires; undefined means the user backed out */
async function collectAnswers(folder: vscode.Uri | undefined): Promise<BuildAnswers | undefined> {
    // The folder arrives from the explorer context menu, whose label says **Build
    // Revision Bundle** on a directory. What a reader right-clicks there is the
    // repository they want analysed, so that is the question it answers.
    const repo =
        folder ??
        (
            await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Use as repository',
                title: 'Repository holding the chapters',
            })
        )?.[0];
    if (repo === undefined) return undefined;

    const records = (
        await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Use as records',
            title: 'Records: the change log and the comment rounds',
            defaultUri: repo,
        })
    )?.[0];
    if (records === undefined) return undefined;

    const choices = sourceChoices();
    // One adapter is not a choice worth making; more than one is
    const source =
        choices.length === 1
            ? choices[0]
            : await vscode.window.showQuickPick(choices, {
                  title: 'Source adapter',
                  placeHolder: 'Which adapter reads these records',
              });
    if (source === undefined) return undefined;

    const from = await vscode.window.showInputBox({
        title: 'Baseline revision',
        prompt: 'The revision the history is measured against',
        value: 'baseline',
    });
    if (from === undefined || from.trim() === '') return undefined;

    const out = await vscode.window.showSaveDialog({
        title: 'Write the bundle to',
        saveLabel: 'Build',
        // The plain suffix, never the compound one. Pilot matches a bare
        // `path.extname`, so a `*.revlens.json` file is one of the two hosts cannot
        // open - and a bundle that only opens here is not what this extension is for
        defaultUri: vscode.Uri.file(join(repo.fsPath, 'bundle.revlens')),
        filters: { 'Revision bundle': ['revlens'] },
    });
    if (out === undefined) return undefined;

    return {
        records: records.fsPath,
        repo: repo.fsPath,
        source: typeof source === 'string' ? source : String(source),
        from: from.trim(),
        out: out.fsPath,
    };
}

/**
 * The command handler. `folder` arrives when the command was invoked on a row in the
 * explorer context menu, which is the path that needs no dialog for the records.
 */
export async function buildBundleCommand(
    channel: BuildLog,
    folder?: vscode.Uri,
): Promise<void> {
    const answers = await collectAnswers(folder);
    if (answers === undefined) return;

    channel.show();
    channel.appendLine(`building ${answers.out}`);
    channel.appendLine(`  source ${answers.source}, repo ${answers.repo}, from ${answers.from}`);

    const outcome = await runBuild({
        source: answers.source,
        repo: answers.repo,
        from: answers.from,
        records: answers.records,
        out: answers.out,
    });

    if (!outcome.ok) {
        // The problem is one sentence and the detail is the rest, the way the desktop
        // window reports it; both go to the channel so nothing is lost behind a dialog
        channel.appendLine(`\n${outcome.problem}`);
        for (const line of outcome.detail) channel.appendLine(`  ${line}`);
        await vscode.window.showErrorMessage(outcome.problem);
        return;
    }

    channel.appendLine(`\n${outcome.summary}`);
    for (const warning of outcome.warnings) channel.appendLine(`warning: ${warning}`);
    channel.appendLine(`\nwrote ${outcome.out}`);

    await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(outcome.out),
        BundleEditorProvider.viewType,
    );
}
