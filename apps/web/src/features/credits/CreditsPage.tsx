import { Link } from 'react-router-dom';

// The art licence requires crediting limezu.itch.io. A line in a repository file
// is not a credit anyone sees, so it lives here, in the product, reachable from
// the footer of every page. Do not remove it.

const ART_SOURCE = {
  name: 'Modern Interiors',
  author: 'LimeZu',
  url: 'https://limezu.itch.io/moderninteriors',
};

const TOOLS = [
  { name: 'Phaser', what: 'the 2D world', url: 'https://phaser.io' },
  { name: 'tldraw', what: 'the shared whiteboard', url: 'https://tldraw.dev' },
  { name: 'LiveKit', what: 'proximity audio and video', url: 'https://livekit.io' },
  { name: 'IBM Plex & Space Grotesk', what: 'typefaces', url: 'https://fonts.google.com' },
];

export default function CreditsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="text-sm text-accent hover:underline">
          ← back
        </Link>
        <h2 className="mt-1 font-display text-xl font-semibold text-ink">Credits</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">
          Retry is a final-year project built at NTTF, Bangalore. It stands on other
          people&apos;s work.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[11px] uppercase text-ink-muted">Art</h3>
        <div className="rounded-panel border border-edge bg-surface px-4 py-4">
          <p className="font-display text-sm font-semibold text-ink">
            {ART_SOURCE.name} — {ART_SOURCE.author}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Every tile, every piece of furniture and every character in the Rooms world.
          </p>
          <a
            href={ART_SOURCE.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-block font-mono text-[11px] text-accent hover:underline"
          >
            limezu.itch.io
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-[11px] uppercase text-ink-muted">Built with</h3>
        <ul className="divide-y divide-edge rounded-panel border border-edge bg-surface">
          {TOOLS.map((tool) => (
            <li key={tool.name} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-ink">
                <span className="font-medium">{tool.name}</span>
                <span className="text-ink-muted"> — {tool.what}</span>
              </span>
              <a
                href={tool.url}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 font-mono text-[11px] text-accent hover:underline"
              >
                site
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
