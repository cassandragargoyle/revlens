import type { Content, Parent, Root } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { BlockKind } from '@revlens/core';

/**
 * A chapter parsed into blocks - headings, paragraphs, list items, quotes, tables.
 *
 * The blocks are the unit attribution is carried in, so the parse has to be stable: the
 * same Markdown must always yield the same block sequence, or block identity would shift
 * between commits for no reason and every paragraph would look rewritten.
 */
export interface ParsedBlock {
  readonly kind: BlockKind;
  readonly level?: number;
  /** Plain text of the block, which is what the diff and the runs work on. */
  readonly text: string;
  /** Heading path above the block, for reporting rather than for matching. */
  readonly headingPath: readonly string[];
  /** 1-based line in the source file, for build report messages. */
  readonly line: number;
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseChapter(markdown: string): ParsedBlock[] {
  const root = processor.parse(stripFrontmatter(markdown)) as Root;
  const blocks: ParsedBlock[] = [];
  const headingPath: string[] = [];

  walk(root, blocks, headingPath);

  return blocks.filter((block) => block.text.trim().length > 0);
}

function walk(parent: Parent, blocks: ParsedBlock[], headingPath: string[]): void {
  for (const node of parent.children as Content[]) {
    switch (node.type) {
      case 'heading': {
        const text = mdastToString(node);
        headingPath.length = Math.max(0, node.depth - 1);
        headingPath[node.depth - 1] = text;
        blocks.push({
          kind: 'heading',
          level: node.depth,
          text,
          headingPath: [...headingPath.slice(0, node.depth - 1)],
          line: node.position?.start.line ?? 0,
        });
        break;
      }

      case 'paragraph':
        blocks.push(leaf('paragraph', node, headingPath));
        break;

      case 'blockquote':
        // The quote is one block; its inner paragraphs are not separately navigable.
        blocks.push(leaf('quote', node, headingPath));
        break;

      case 'code':
        blocks.push({
          kind: 'code',
          text: node.value,
          headingPath: [...headingPath],
          line: node.position?.start.line ?? 0,
        });
        break;

      case 'list':
        for (const item of node.children) {
          // A list item with nested blocks still counts as one block: a reader follows a
          // bullet, not the paragraphs inside it.
          blocks.push(leaf('listItem', item, headingPath));
        }
        break;

      case 'table':
        blocks.push(leaf('table', node, headingPath));
        break;

      case 'thematicBreak':
      case 'definition':
      case 'footnoteDefinition':
      case 'html':
        break;

      default:
        if ('children' in node && Array.isArray((node as Parent).children)) {
          walk(node as Parent, blocks, headingPath);
        }
        break;
    }
  }
}

function leaf(kind: BlockKind, node: Content, headingPath: readonly string[]): ParsedBlock {
  return {
    kind,
    text: normalizeWhitespace(mdastToString(node)),
    headingPath: [...headingPath],
    line: node.position?.start.line ?? 0,
  };
}

/**
 * Source wrapping is an authoring decision, not a change to the text. Collapsing it means
 * a re-wrapped paragraph does not show up as an edit in every line it touched.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** YAML frontmatter is metadata about the chapter, not text the reviewers read. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return markdown;
  const after = markdown.indexOf('\n', end + 1);
  return after < 0 ? '' : markdown.slice(after + 1);
}
