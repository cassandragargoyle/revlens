import type { ReactElement } from 'react';
import type { BundleIndex } from '@revlens/core';
import { computeStats, distinctGateValues } from '@revlens/core';
import cover from '../assets/revlens-cover.png';
import { cs } from '../strings.js';
import { VERSION } from '../version.js';
import { formatDateTime } from './Sidebar.js';

/**
 * What this thing is, and where its numbers came from.
 *
 * The viewer gets handed to people who did not build it - a reviewer opening a link, a
 * sponsor, a colleague picking the engagement up months later. The three columns say what
 * changed; nothing else on the screen says what the tool is or what it is showing.
 *
 * The provenance block at the end is the part that matters most: a viewer that cannot say
 * which document, which baseline, generated when and by what, is not evidence.
 */

export interface AboutProps {
  readonly index: BundleIndex;
  onClose(): void;
}

export function About({ index, onClose }: AboutProps): ReactElement {
  const bundle = index.bundle;
  const stats = computeStats(index);
  const gates = [
    { label: cs.comments.verdict, question: cs.about.gateVerdict, gate: 'verdict' as const },
    { label: cs.comments.decision, question: cs.about.gateDecision, gate: 'decision' as const },
    {
      label: cs.comments.resolution,
      question: cs.about.gateResolution,
      gate: 'resolution' as const,
    },
  ];

  return (
    <main className="about">
      <div className="about__inner">
        <div className="toolbar about__back">
          <button type="button" onClick={onClose}>
            {cs.about.close}
          </button>
        </div>

        <h1 className="about__title">{cs.about.title}</h1>
        <p className="about__lead">{cs.about.lead}</p>

        <figure className="about__figure">
          <img src={cover} alt={cs.about.coverAlt} className="about__cover" />
          <figcaption>{cs.about.coverCaption}</figcaption>
        </figure>

        <section>
          <h2>{cs.about.reading}</h2>
          <p>{cs.about.readingModes}</p>
          <p>{cs.about.readingClick}</p>
          <h3 className="about__keysHeading">{cs.keyboard.heading}</h3>
          <ul className="about__keys">
            <li>{cs.keyboard.nextSibling}</li>
            <li>{cs.keyboard.previousSibling}</li>
            <li>{cs.keyboard.nextEdit}</li>
            <li>{cs.keyboard.previousEdit}</li>
            <li>{cs.keyboard.escape}</li>
          </ul>
        </section>

        {(bundle.comments ?? []).length > 0 && (
          <section>
            <h2>{cs.about.gates}</h2>
            <p>{cs.about.gatesLead}</p>
            <table className="about__table">
              <thead>
                <tr>
                  <th>Brána</th>
                  <th>Otázka</th>
                  <th>Hodnoty v tomto dokumentu</th>
                </tr>
              </thead>
              <tbody>
                {gates.map((entry) => (
                  <tr key={entry.gate}>
                    <td>{entry.label}</td>
                    <td>{entry.question}</td>
                    <td className="about__values">
                      {distinctGateValues(index, entry.gate).map((value) => (
                        <span key={value} className="badge">
                          {value}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">{cs.about.gatesOutstanding}</p>
          </section>
        )}

        <section>
          <h2>{cs.about.ids}</h2>
          <p>{cs.about.idsLead}</p>
          <table className="about__table">
            <tbody>
              <tr>
                <td>
                  <code>#/edit/…</code>, <code>#/revision/…</code>, <code>#/comment/…</code>
                </td>
                <td>{cs.about.idsDurable}</td>
              </tr>
              <tr>
                <td>
                  <code>ch-04-wp-a1/b-17</code>
                </td>
                <td>{cs.about.idsVolatile}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>{cs.about.provenance}</h2>
          <dl className="about__facts">
            <dt>{cs.about.document}</dt>
            <dd>{bundle.document.title}</dd>

            <dt>{cs.about.version}</dt>
            <dd>{bundle.document.version}</dd>

            {bundle.document.baseline !== undefined && (
              <>
                <dt>{cs.about.baseline}</dt>
                <dd>
                  {bundle.document.baseline.version}
                  {bundle.document.baseline.commit === undefined ? null : (
                    <>
                      {' '}
                      <code>{bundle.document.baseline.commit.slice(0, 10)}</code>
                    </>
                  )}
                </dd>
              </>
            )}

            <dt>{cs.about.generated}</dt>
            <dd>{formatDateTime(bundle.document.generated)}</dd>

            <dt>{cs.about.generator}</dt>
            <dd>
              <code>{bundle.document.generator ?? cs.about.unknownGenerator}</code>
            </dd>

            {/* What wrote the file and what is showing it are two facts, and a reader
                reporting a problem needs the second one as much as the first. */}
            <dt>{cs.about.tool}</dt>
            <dd>
              <code>RevLens {VERSION}</code>
            </dd>

            <dt>{cs.about.totals}</dt>
            <dd>{cs.about.totalsValue(stats.chapters, stats.blocks)}</dd>

            <dt>{cs.about.changes}</dt>
            <dd>{stats.edits}</dd>

            <dt>{cs.about.revisions}</dt>
            <dd>{stats.revisions}</dd>

            <dt>{cs.about.commentCount}</dt>
            <dd>{stats.comments}</dd>

            {/* Printed whether it is zero or not: a number that appears only when there is
                a problem cannot be told from a number nobody computed. */}
            <dt>{cs.about.unexplained}</dt>
            <dd>{stats.unexplainedEdits}</dd>
          </dl>
          <p className="hint">{cs.about.unexplainedHint}</p>
        </section>
      </div>
    </main>
  );
}
