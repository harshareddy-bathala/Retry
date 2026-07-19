import Daily, {
  type DailyCall,
  type DailyEventObjectActiveSpeakerChange,
  type DailyEventObjectParticipant,
  type DailyEventObjectParticipantLeft,
  type DailyParticipant,
} from '@daily-co/daily-js';
import type { ServerMessage, Zone } from '@foundry/protocol';
import { reportWarning } from '../../../lib/report.js';
import { roomEvents } from '../event-bus.js';
import type { AvState } from '../av-state.js';
import { avStore } from './av-store.js';

// Daily.co session manager (rooms build plan Phase 5). One call object for the
// whole live-space visit; door transitions leave the old Daily room and join
// the new one on the same object. THE mechanic: the call is joined with all
// tracks unsubscribed, and a peer's tracks are subscribed only while the
// proximity engine says 'close' or 'near' — bandwidth scales with proximity,
// not room population. Never a full mesh hidden with CSS.

const GAIN_BY_ZONE: Record<Zone, number> = { close: 1.0, near: 0.5, out: 0 };
// An abrupt gain change is audible; ramp over 200ms (plan §3).
const GAIN_RAMP_S = 0.2;

type AudioChain = {
  trackId: string;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  // Chrome quirk: a remote WebRTC track is silent in WebAudio unless it is
  // also attached to an (muted) HTMLAudioElement. Long-standing crbug/121673.
  el: HTMLAudioElement;
};

class AvManager {
  private call: DailyCall | null = null;
  private unsub: (() => void) | null = null;
  private local: AvState = { audio: true, video: true };
  private zones = new Map<string, Zone>();
  private sessionByUser = new Map<string, string>();
  private userBySession = new Map<string, string>();
  private currentUrl: string | null = null;
  /** Serializes join/leave — a fast double door press must not interleave them. */
  private ops: Promise<void> = Promise.resolve();
  private audioCtx: AudioContext | null = null;
  private chains = new Map<string, AudioChain>();

  start(local: AvState): void {
    this.local = local;
    this.unsub ??= roomEvents.on('net:server-message', (msg) => this.onMessage(msg));
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.zones.clear();
    this.enqueue(async () => {
      const call = this.call;
      this.call = null;
      this.currentUrl = null;
      if (call) {
        await call.leave().catch(() => undefined);
        await call.destroy().catch(() => undefined);
      }
    });
    for (const userId of [...this.chains.keys()]) this.dropAudioChain(userId);
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.sessionByUser.clear();
    this.userBySession.clear();
    avStore.clear();
  }

  /** Mic/cam toggles — state carries unchanged across every map transition. */
  setLocal(next: AvState): void {
    this.local = next;
    const call = this.call;
    if (call) {
      call.setLocalAudio(next.audio);
      call.setLocalVideo(next.video);
    }
    this.resumeAudio();
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'avToken':
        // Resyncs re-send the same grant — only an actual room change moves the call.
        if (msg.roomUrl !== this.currentUrl) this.switchRoom(msg.roomUrl, msg.token);
        break;
      case 'proximity':
        for (const pair of msg.pairs) {
          if (pair.zone === 'out') this.zones.delete(pair.userId);
          else this.zones.set(pair.userId, pair.zone);
          this.applySubscription(pair.userId);
          this.applyGain(pair.userId);
        }
        this.resumeAudio();
        break;
      case 'snapshot':
        // Zone state rebuilds from the proximity events that follow a snapshot;
        // existing subscriptions are corrected then, not blipped now.
        this.zones.clear();
        break;
      case 'actorLeave':
        this.zones.delete(msg.userId);
        break;
      default:
        break;
    }
  }

  /** Map-transition handoff: unsubscribe all (implicit in leave), rejoin, resubscribe. */
  private switchRoom(url: string, token: string): void {
    this.currentUrl = url;
    this.enqueue(async () => {
      if (this.currentUrl !== url) return; // superseded by a later door
      try {
        const call = this.ensureCall();
        if (call.meetingState() !== 'new' && call.meetingState() !== 'left-meeting') {
          await call.leave();
        }
        await call.join({
          url,
          token,
          startAudioOff: !this.local.audio,
          startVideoOff: !this.local.video,
        });
        // Subscriptions for peers already close/near re-apply as Daily reports
        // participants (syncParticipant), completing the handoff.
      } catch (err) {
        reportWarning('rooms: daily join failed; placeholder bubbles remain', err);
      }
    });
  }

  private ensureCall(): DailyCall {
    if (this.call) return this.call;
    const call = Daily.createCallObject({ subscribeToTracksAutomatically: false });
    call.on('participant-joined', (e: DailyEventObjectParticipant) => this.syncParticipant(e.participant));
    call.on('participant-updated', (e: DailyEventObjectParticipant) => this.syncParticipant(e.participant));
    call.on('participant-left', (e: DailyEventObjectParticipantLeft) => {
      const userId = this.userBySession.get(e.participant.session_id);
      this.userBySession.delete(e.participant.session_id);
      if (userId) {
        this.sessionByUser.delete(userId);
        this.dropAudioChain(userId);
        avStore.remove(userId);
      }
    });
    call.on('active-speaker-change', (e: DailyEventObjectActiveSpeakerChange) => {
      avStore.setSpeaking(this.userBySession.get(e.activeSpeaker.peerId) ?? null);
    });
    call.on('camera-error', (e) => {
      // No camera permission is a fully supported state: audio (or nothing)
      // continues, bubbles fall back to initials — never a black rectangle.
      reportWarning('rooms: camera unavailable; continuing without video', e);
    });
    call.on('error', (e) => reportWarning('rooms: daily call error', e));
    this.call = call;
    return call;
  }

  private syncParticipant(p: DailyParticipant): void {
    if (p.local) return;
    const userId = p.user_id;
    if (!userId) return;
    this.sessionByUser.set(userId, p.session_id);
    this.userBySession.set(p.session_id, userId);

    // A peer can appear AFTER proximity already said 'close' (WS beats WebRTC);
    // apply the pending subscription the moment Daily knows about them.
    this.applySubscription(userId);

    const video = p.tracks.video;
    avStore.setVideoTrack(
      userId,
      video.state === 'playable' && video.persistentTrack ? video.persistentTrack : null,
    );

    const audio = p.tracks.audio;
    if (audio.state === 'playable' && audio.persistentTrack) {
      this.ensureAudioChain(userId, audio.persistentTrack);
      this.applyGain(userId);
    } else {
      this.dropAudioChain(userId);
    }
  }

  private applySubscription(userId: string): void {
    const call = this.call;
    const sessionId = this.sessionByUser.get(userId);
    if (!call || !sessionId) return;
    const zone = this.zones.get(userId);
    const wanted = zone === 'close' || zone === 'near';
    const current = call.participants()[sessionId]?.tracks.audio.subscribed;
    if (wanted === (current === true)) return;
    call.updateParticipant(sessionId, {
      setSubscribedTracks: wanted ? { audio: true, video: true } : false,
    });
  }

  // ---------------------------------------------------------------------------
  // WebAudio: per-peer gain, ramped between zones
  // ---------------------------------------------------------------------------

  private ensureAudioChain(userId: string, track: MediaStreamTrack): void {
    const existing = this.chains.get(userId);
    if (existing?.trackId === track.id) return;
    if (existing) this.dropAudioChain(userId);

    const ctx = (this.audioCtx ??= new AudioContext());
    const stream = new MediaStream([track]);
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0; // fade in from silence to the zone's level
    source.connect(gain).connect(ctx.destination);
    this.chains.set(userId, { trackId: track.id, source, gain, el });
  }

  private dropAudioChain(userId: string): void {
    const chain = this.chains.get(userId);
    if (!chain) return;
    this.chains.delete(userId);
    chain.source.disconnect();
    chain.gain.disconnect();
    chain.el.srcObject = null;
  }

  private applyGain(userId: string): void {
    const chain = this.chains.get(userId);
    const ctx = this.audioCtx;
    if (!chain || !ctx) return;
    const target = GAIN_BY_ZONE[this.zones.get(userId) ?? 'out'];
    const g = chain.gain.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + GAIN_RAMP_S);
  }

  /** Autoplay policy: the context may start suspended until a user gesture. */
  private resumeAudio(): void {
    if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume().catch(() => undefined);
  }

  private enqueue(op: () => Promise<void>): void {
    this.ops = this.ops.then(op).catch((err: unknown) => {
      reportWarning('rooms: daily operation failed', err);
    });
  }
}

export const avManager = new AvManager();
