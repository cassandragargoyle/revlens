// `revlens.tryExample` - a working engagement written to disk, and built, in one command
// The answer to "what do I put where" is a directory the reader can open, not a paragraph

import { join } from 'node:path';
import * as vscode from 'vscode';
import { listExamples, tryExample } from '@revlens/adapters';
import type { ExampleChoice } from '@revlens/adapters';
import type { BuildLog } from './build-command.js';
import { BundleEditorProvider } from './bundle-editor.js';

/**
 * Where the examples are once the extension is installed.
 *
 * They are copied next to the viewer by `esbuild.mjs`, so a reader needs no checkout of
 * revlens to see one. Both hosts hand the extension its own directory, which is the one
 * thing this needs to know.
 */
export function examplesRoot(extensionPath: string): string {
    return join(extensionPath, 'media', 'examples');
}

interface ExampleItem extends vscode.QuickPickItem {
    readonly choice: ExampleChoice;
}

/**
 * The command handler.
 *
 * Three questions and no form: which example, which language when it has more than one,
 * and where to put it. Everything after that is `tryExample`, which is the same call the
 * desktop window makes.
 */
export async function tryExampleCommand(
    channel: BuildLog,
    extensionPath: string,
): Promise<void> {
    const root = examplesRoot(extensionPath);
    const choices = await listExamples(root, vscode.env?.language ?? 'en');

    if (choices.length === 0) {
        const problem = `No examples were found in ${root}.`;
        channel.appendLine(problem);
        await vscode.window.showErrorMessage(problem);
        return;
    }

    const items: ExampleItem[] = choices.map((choice) => ({
        label: choice.title,
        detail: choice.description,
        description: choice.id,
        choice,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        title: 'Try an example',
        placeHolder: 'A complete engagement, written to a folder and built',
    });
    if (picked === undefined) return;

    const language = await pickLanguage(picked.choice);
    if (language === undefined) return;

    const target = (
        await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Write the example here',
            title: 'An empty folder for the example',
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        })
    )?.[0];
    if (target === undefined) return;

    channel.show();
    channel.appendLine(`writing ${picked.choice.id} (${language}) into ${target.fsPath}`);

    const outcome = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Building ${picked.choice.title}`,
            cancellable: false,
        },
        async () =>
            tryExample({
                root,
                id: picked.choice.id,
                language,
                target: target.fsPath,
            }),
    );

    if (!outcome.ok) {
        channel.appendLine(`\n${outcome.problem}`);
        for (const line of outcome.detail) channel.appendLine(`  ${line}`);
        await vscode.window.showErrorMessage(outcome.problem);
        return;
    }

    // What the reader came for is not only the document: it is knowing where the records
    // that produced it are, so the next build can be their own.
    channel.appendLine(`\n${outcome.summary}`);
    for (const warning of outcome.warnings) channel.appendLine(`warning: ${warning}`);
    channel.appendLine(`\nrecords    ${join(outcome.records, 'docs')}`);
    channel.appendLine(`repository ${outcome.repository}`);
    channel.appendLine(`bundle     ${outcome.out}`);

    await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(outcome.out),
        BundleEditorProvider.viewType,
    );
}

/** One language is not a choice worth making; more than one is. */
async function pickLanguage(choice: ExampleChoice): Promise<string | undefined> {
    if (choice.languages.length <= 1) return choice.language;

    return vscode.window.showQuickPick([...choice.languages], {
        title: 'Which language',
        placeHolder: 'The same engagement, told in each of these',
    });
}
