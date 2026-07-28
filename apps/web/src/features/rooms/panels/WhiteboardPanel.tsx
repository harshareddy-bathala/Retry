import { Tldraw } from 'tldraw';
import { useSync } from '@tldraw/sync';
import type { TLAssetStore } from 'tldraw';
import 'tldraw/tldraw.css';
import { getAccessToken } from '../../../lib/api.js';
import { useInputLayer } from '../input/useInputLayer.js';

const ROOM_WS_URL =
  (import.meta.env.VITE_ROOM_WS_URL as string | undefined) ?? 'ws://localhost:4100/ws';
// Same host as the world socket, dedicated sync endpoint (Phase 6).
const WHITEBOARD_WS_BASE = ROOM_WS_URL.replace(/\/ws$/, '/whiteboard');

// Unlicensed tldraw renders a "get a license for production" watermark. The only
// sanctioned way to remove it is a real key — the licence lists watermark display
// among the software's technical measures, so hiding it with CSS would breach it.
// Absent → watermark, which is the correct unlicensed state; present → clean.
const LICENSE_KEY = import.meta.env.VITE_TLDRAW_LICENSE_KEY as string | undefined;

// V1 whiteboards are shapes/ink only — no uploaded media (FR-ROOM-35 spirit:
// no file uploads anywhere in rooms). tldraw requires an asset store; this one
// declines uploads and resolves nothing.
const noUploads: TLAssetStore = {
  upload: () => Promise.reject(new Error('uploads are disabled')),
  resolve: () => null,
};

type WhiteboardPanelProps = { roomId: string; onClose: () => void };

// Shared whiteboard (FR-ROOM-37..39): full-screen overlay over the live canvas,
// synced through the self-hosted tldraw endpoint, persisted server-side.
export default function WhiteboardPanel({ roomId, onClose }: WhiteboardPanelProps) {
  // The board takes the keyboard — tldraw's own shortcuts must work, and none
  // of the world's may fire underneath it.
  //
  // Deliberately NO onEscape. tldraw uses Escape to deselect and to cancel a
  // draw in progress; a capturing layer that declines ends the Escape walk
  // without preventing the default, so the key reaches tldraw and the panel
  // below stays open. Pressing Escape here used to unmount the whole board and
  // its sync store mid-stroke. Close is a button, not a keystroke.
  useInputLayer(true, { kind: 'modal', name: 'whiteboard', capturesKeys: true });

  const token = getAccessToken() ?? '';
  const store = useSync({
    uri: `${WHITEBOARD_WS_BASE}?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`,
    assets: noUploads,
  });

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
        <p className="font-mono text-[11px] uppercase text-ink-muted">Whiteboard</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-card border border-edge px-2 py-0.5 text-xs text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>
      <div className="relative flex-1">
        {store.status === 'error' ? (
          <p className="p-4 text-sm text-ink-muted">
            The whiteboard is for room members only.
          </p>
        ) : (
          <Tldraw store={store} licenseKey={LICENSE_KEY} />
        )}
      </div>
    </div>
  );
}
