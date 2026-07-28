import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '../../../components/ui/button.js';
import { Dialog } from '../../../components/ui/dialog.js';
import { cn } from '../../../lib/cn.js';
import type { AvState } from '../av-state.js';
import { avManager } from './av-manager.js';
import { requestDeviceAccess, startDeviceWatch, useDevices } from './devices.js';

// "Can they hear me?", answered before anyone has to ask it out loud.
//
// AVControls.tsx has carried this comment since it was written: *a silent room
// is indistinguishable from a broken one — the worst failure mode for a beta,
// because it teaches people the product does not work when in fact nobody has
// spoken.* A level meter that moves is the only thing that tells those two
// apart before a single word is said.
//
// It works with no SFU at all: everything here is local capture. That matters —
// it is useful on the day LiveKit is down, and it was useful for the three
// weeks LiveKit did not exist.

/** How often the meter samples. 20Hz looks live and costs nothing. */
const METER_MS = 50;
/** Bars in the meter. Discrete, because a smooth bar reads as decorative. */
const BARS = 12;

type PreJoinDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  av: AvState;
  onJoin: (next: AvState) => void;
};

export function PreJoinDialog({ open, onOpenChange, av, onJoin }: PreJoinDialogProps) {
  const devices = useDevices();
  const [draft, setDraft] = useState<AvState>(av);
  const [level, setLevel] = useState(0);
  const [asked, setAsked] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (open) setDraft(av);
  }, [open, av]);

  useEffect(() => {
    if (open) startDeviceWatch();
  }, [open]);

  // Local preview + meter. Deliberately NOT the LiveKit tracks: this runs
  // before anything is published, which is the entire point.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;

    const stop = (): void => {
      if (timer) clearInterval(timer);
      source?.disconnect();
      analyser?.disconnect();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setLevel(0);
    };

    void (async () => {
      if (!draft.audio && !draft.video) {
        stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: draft.audio ? (draft.micId ? { deviceId: { exact: draft.micId } } : true) : false,
          video: draft.video ? (draft.camId ? { deviceId: { exact: draft.camId } } : true) : false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        setAsked(true);
        if (videoRef.current) videoRef.current.srcObject = stream;

        if (draft.audio) {
          // Reuse the manager's context, created HERE inside a user gesture.
          // Built lazily on the first remote track instead, it starts
          // `suspended` under autoplay policy and the first person to speak to
          // you is inaudible until something else happens to resume it.
          const ctx = avManager.primeAudio();
          source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          // The analyser is NOT connected to the destination: this is a meter,
          // not a monitor, and routing your own mic to your speakers is how you
          // get feedback howl in a room full of laptops.
          source.connect(analyser);
          const buffer = new Uint8Array(analyser.frequencyBinCount);
          timer = setInterval(() => {
            analyser?.getByteTimeDomainData(buffer);
            let peak = 0;
            for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128));
            setLevel(Math.min(1, peak / 90));
          }, METER_MS);
        }
      } catch {
        // A refusal is an answer, not an error — the dialog exists to surface
        // it, and `asked` is what turns the labels on.
        setAsked(true);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, draft.audio, draft.video, draft.micId, draft.camId]);

  const lit = Math.round(level * BARS);
  const needsPermission = !devices.labelled && !asked;

  const pick = (
    label: string,
    list: { deviceId: string; label: string }[],
    value: string | undefined,
    onPick: (id: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      {label}
      <select
        className="rounded-card border border-edge bg-page px-2 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        value={value ?? ''}
        disabled={list.length === 0}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">{list.length === 0 ? 'None found' : 'Browser default'}</option>
        {list.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || 'Unnamed device'}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Can they hear you?"
      description="Nothing is published until you join. This is only your own machine."
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-card border border-edge bg-page">
          {draft.video ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="aspect-[4/3] w-full scale-x-[-1] object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center text-ink-muted">
              <VideoOff size={28} aria-hidden />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              variant={draft.audio ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={draft.audio}
              onClick={() => setDraft((d) => ({ ...d, audio: !d.audio }))}
            >
              {draft.audio ? <Mic size={14} aria-hidden /> : <MicOff size={14} aria-hidden />}
              <span className="ml-1.5">Mic</span>
            </Button>
            <Button
              variant={draft.video ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={draft.video}
              onClick={() => setDraft((d) => ({ ...d, video: !d.video }))}
            >
              {draft.video ? <Video size={14} aria-hidden /> : <VideoOff size={14} aria-hidden />}
              <span className="ml-1.5">Camera</span>
            </Button>
          </div>

          {/* The meter. `aria-hidden` on the bars with a live text reading
              beside it: twelve divs animating is meaningless to a screen
              reader, and "no sound detected" is the actual information. */}
          <div>
            <div className="flex gap-0.5" aria-hidden>
              {Array.from({ length: BARS }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-4 flex-1 rounded-[2px] transition-colors',
                    i < lit ? 'bg-success' : 'bg-edge',
                  )}
                />
              ))}
            </div>
            <p role="status" className="mt-1 font-mono text-[10px] text-ink-muted">
              {!draft.audio
                ? 'Microphone off'
                : level > 0.06
                  ? 'Picking you up'
                  : 'Say something — no sound yet'}
            </p>
          </div>

          {needsPermission ? (
            <div className="rounded-card border border-edge bg-page p-3">
              <p className="text-xs text-ink-muted">
                Your browser hides device names until you allow access once.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void requestDeviceAccess('both')}
              >
                Choose devices
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {pick('Microphone', devices.mics, draft.micId, (id) =>
                setDraft((d) => ({ ...d, micId: id || undefined })),
              )}
              {pick('Camera', devices.cams, draft.camId, (id) =>
                setDraft((d) => ({ ...d, camId: id || undefined })),
              )}
            </div>
          )}
        </div>
      </div>

      {/*
        One button per distinct outcome.

        Both buttons used to be able to read "Join muted" at the same time —
        the primary falls back to that label when nothing is enabled, which is
        the DEFAULT state, so the commonest way to see this dialog showed two
        adjacent identical buttons. Ambiguous to anyone, and to a screen reader
        it is two controls with one name. "Join muted" only exists as an
        alternative when there is something to be an alternative to.
      */}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {(draft.audio || draft.video) && (
          <Button
            variant="secondary"
            onClick={() => {
              onJoin({ ...draft, audio: false, video: false });
              onOpenChange(false);
            }}
          >
            Join muted
          </Button>
        )}
        <Button
          onClick={() => {
            onJoin(draft);
            onOpenChange(false);
          }}
        >
          {draft.audio || draft.video ? 'Join with these' : 'Join muted'}
        </Button>
      </div>
    </Dialog>
  );
}
