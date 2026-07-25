import { useEffect, useRef, useState } from 'react';
import type { Blueprint, BlueprintFieldKey } from '@retry/protocol';
import { roomSocket } from '../net/room-socket.js';
import { formatWhen } from '../../../lib/when.js';

// Project Blueprint (FR-ROOM-11/12). Three optional free-text questions, all
// skippable, none validated — the point is to make a team articulate the
// problem, not to gate them on a form.

const FIELDS: Array<{ key: BlueprintFieldKey; question: string; hint: string }> = [
  {
    key: 'problem',
    question: 'What problem are we solving?',
    hint: 'In one or two sentences, in plain language.',
  },
  {
    key: 'audience',
    question: 'Who experiences this problem?',
    hint: 'Be specific — "second-year students on night shift" beats "users".',
  },
  {
    key: 'existing',
    question: 'What already exists, and why is it not enough?',
    hint: 'Existing tools, past projects, the manual way people cope today.',
  },
];

type BlueprintPanelProps = {
  blueprint: Blueprint;
  lastEdit: Partial<Record<BlueprintFieldKey, { by: string; at: string }>>;
};

export function BlueprintPanel({ blueprint, lastEdit }: BlueprintPanelProps) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-mono text-[11px] uppercase text-ink-muted">Project blueprint</h3>
      <div className="flex flex-col gap-4 rounded-panel border border-edge bg-surface px-4 py-4">
        {FIELDS.map((field) => (
          <BlueprintField
            key={field.key}
            field={field}
            value={blueprint[field.key]}
            {...(lastEdit[field.key] ? { edit: lastEdit[field.key] } : {})}
          />
        ))}
        <p className="font-mono text-[11px] text-ink-muted">
          All three are optional. Only your team sees this.
        </p>
      </div>
    </section>
  );
}

function BlueprintField({
  field,
  value,
  edit,
}: {
  field: { key: BlueprintFieldKey; question: string; hint: string };
  value: string | null;
  edit?: { by: string; at: string };
}) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  const lastSent = useRef(value ?? '');

  // Accept a teammate's edit — but never while this box has the caret, or
  // their keystrokes would rewrite the sentence you are in the middle of.
  useEffect(() => {
    if (!focused.current) {
      setDraft(value ?? '');
      lastSent.current = value ?? '';
    }
  }, [value]);

  const commit = (): void => {
    focused.current = false;
    if (draft === lastSent.current) return;
    lastSent.current = draft;
    roomSocket.send({ t: 'blueprintUpdate', field: field.key, value: draft });
  };

  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-display text-sm font-medium text-ink">{field.question}</span>
      <textarea
        value={draft}
        rows={3}
        maxLength={4000}
        placeholder={field.hint}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        // Saved on blur rather than per keystroke: this is prose, and a
        // broadcast per character would fight every other member's caret.
        onBlur={commit}
        className="resize-y rounded-card border border-edge bg-page px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      {edit && (
        <span className="font-mono text-[11px] text-ink-muted">
          {edit.by} · {formatWhen(edit.at)}
        </span>
      )}
    </label>
  );
}
