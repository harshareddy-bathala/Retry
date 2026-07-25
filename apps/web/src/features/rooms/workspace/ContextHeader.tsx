import { DOMAIN_TAGS, type DomainTag, type ProjectStage } from '@retry/protocol';
import { roomSocket } from '../net/room-socket.js';

// Project Context header (FR-ROOM-09/10). Any member may change these at any
// time; the change is persisted and broadcast, so two people looking at the
// room see the same thing without refreshing.

const STAGES: Array<{ value: ProjectStage; label: string }> = [
  { value: 'ideation', label: 'Ideation' },
  { value: 'planning', label: 'Planning' },
  { value: 'building', label: 'Building' },
  { value: 'testing', label: 'Testing' },
  { value: 'complete', label: 'Complete' },
];

export function ContextHeader({
  stage,
  domainTag,
  disabled,
}: {
  stage: ProjectStage;
  domainTag: DomainTag | null;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase text-ink-muted">Stage</span>
        <select
          value={stage}
          disabled={disabled}
          onChange={(e) =>
            roomSocket.send({ t: 'contextUpdate', stage: e.target.value as ProjectStage })
          }
          className="rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink disabled:opacity-60"
        >
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase text-ink-muted">Domain</span>
        <select
          value={domainTag ?? ''}
          disabled={disabled}
          onChange={(e) =>
            roomSocket.send({
              t: 'contextUpdate',
              domainTag: e.target.value === '' ? null : (e.target.value as DomainTag),
            })
          }
          className="rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink disabled:opacity-60"
        >
          <option value="">Not set</option>
          {DOMAIN_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
