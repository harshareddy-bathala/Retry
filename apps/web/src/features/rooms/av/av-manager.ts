import {
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { ServerMessage, Zone } from '@retry/protocol';
import { reportWarning } from '../../../lib/report.js';
import { roomEvents } from '../event-bus.js';
import type { AvState } from '../av-state.js';
import { avatarTilePositions } from '../avatar-positions.js';
import { avStore } from './av-store.js';

/**
 * Position an AudioListener or PannerNode.
 *
 * Both grew AudioParam `positionX/Y/Z` and both still carry a deprecated
 * `setPosition`, and which one exists depends on the browser — Safari only
 * shipped the params recently. Ramping to the value rather than setting it
 * avoids a zipper noise when someone walks.
 */
function setXYZ(
  node: AudioListener | PannerNode,
  x: number,
  y: number,
  z: number,
  now: number,
): void {
  const target = node as unknown as {
    positionX?: AudioParam;
    positionY?: AudioParam;
    positionZ?: AudioParam;
    setPosition?: (x: number, y: number, z: number) => void;
  };
  if (target.positionX && target.positionY && target.positionZ) {
    const ease = now + 1 / PANNER_HZ;
    target.positionX.linearRampToValueAtTime(x, ease);
    target.positionY.linearRampToValueAtTime(y, ease);
    target.positionZ.linearRampToValueAtTime(z, ease);
  } else {
    target.setPosition?.(x, y, z);
  }
}

// LiveKit session manager (rooms Phase 5; migrated from Daily.co — ADR-012).
// One Room connection per map instance; a door transition disconnects the old
// one and connects the new. THE mechanic is unchanged: the room is joined with
// autoSubscribe OFF, and a peer's tracks are subscribed only while the
// proximity engine says 'close' or 'near' — bandwidth scales with proximity,
// not with room population. Never a full mesh hidden with CSS.
//
// LiveKit participant identity IS the Retry userId (set server-side on the
// token), so no session-id bookkeeping is needed to map a participant onto an
// actor — that was two maps' worth of state under Daily.

const GAIN_BY_ZONE: Record<Zone, number> = { close: 1.0, near: 0.5, out: 0 };
// An abrupt gain change is audible; ramp over 200ms (plan §3).
const GAIN_RAMP_S = 0.2;

/**
 * Spatial audio: OFF unless someone turns it on.
 *
 * `localStorage.setItem('retry.rooms.spatial', 'on')` and reload. Deliberately
 * a runtime switch rather than a build flag, because the open question is not
 * "does it work" — it is whether it is worth its cost on a lab machine with
 * eight people in earshot, and that can only be answered by someone listening
 * on the hardware in question.
 *
 * Honest about the trade: with a hard 5-tile cutoff the perceptual win is real
 * but modest — you can tell left from right, and that is roughly it — while
 * HRTF panning costs measurable CPU per stream and starts to show above about
 * six concurrent.
 */
const SPATIAL_KEY = 'retry.rooms.spatial';
function spatialEnabled(): boolean {
  try {
    return localStorage.getItem(SPATIAL_KEY) === 'on';
  } catch {
    return false;
  }
}

/** How often panner positions are refreshed. Ears do not resolve faster. */
const PANNER_HZ = 10;

type AudioChain = {
  trackId: string;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  /** Present only when spatial audio is on. */
  panner: PannerNode | null;
  // Chrome quirk: a remote WebRTC track is silent in WebAudio unless it is
  // also attached to a (muted) HTMLAudioElement. Long-standing crbug/121673.
  el: HTMLAudioElement;
};

class AvManager {
  private room: Room | null = null;
  private unsub: (() => void) | null = null;
  private local: AvState = { audio: true, video: true };
  private zones = new Map<string, Zone>();
  private currentRoomName: string | null = null;
  /** Serializes connect/disconnect — a fast double door press must not interleave them. */
  private ops: Promise<void> = Promise.resolve();
  private audioCtx: AudioContext | null = null;
  private chains = new Map<string, AudioChain>();
  private pannerTimer: ReturnType<typeof setInterval> | null = null;

  start(local: AvState): void {
    this.local = local;
    this.unsub ??= roomEvents.on('net:server-message', (msg) => this.onMessage(msg));
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.zones.clear();
    this.enqueue(async () => {
      const room = this.room;
      this.room = null;
      this.currentRoomName = null;
      if (room) await room.disconnect().catch(() => undefined);
    });
    for (const userId of [...this.chains.keys()]) this.dropAudioChain(userId);
    this.stopPannerLoop();
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    avStore.clear();
    avStore.setStatus('off');
  }

  /** Mic/cam toggles and device choice — carried across every map transition. */
  setLocal(next: AvState): void {
    const previous = this.local;
    this.local = next;
    const room = this.room;
    if (room) {
      void room.localParticipant
        .setMicrophoneEnabled(next.audio)
        .then(() => {
          // Recovering from a denial has to CLEAR it. Otherwise the status line
          // keeps saying the mic is blocked after the student has fixed it.
          if (next.audio && avStore.getStatus() === 'denied') avStore.setStatus('live');
        })
        .catch((err: unknown) => {
          // This branch used to only warn to Sentry, so a student who joined
          // muted and later unmuted into a permission refusal got silence and
          // no explanation — the exact failure av-store.ts calls the worst one
          // in the product. Only `switchRoom` ever set this.
          if (next.audio) avStore.setStatus('denied');
          reportWarning('rooms: microphone unavailable; continuing without it', err);
        });
      void room.localParticipant.setCameraEnabled(next.video).catch((err: unknown) =>
        // No camera permission is a fully supported state: audio (or nothing)
        // continues and bubbles fall back to initials — never a black rectangle.
        reportWarning('rooms: camera unavailable; continuing without video', err),
      );
      this.applyDevices(previous);
    }
    this.resumeAudio();
  }

  /**
   * Push changed device choices at LiveKit.
   *
   * Only the ones that actually changed: `switchActiveDevice` republishes the
   * track, which is an audible click on audio and a visible flicker on video,
   * and `setLocal` is called on every mic toggle.
   */
  private applyDevices(previous: AvState): void {
    const room = this.room;
    if (!room) return;
    const next = this.local;
    const switchTo = (kind: MediaDeviceKind, id: string | undefined): void => {
      if (!id) return;
      void room.switchActiveDevice(kind, id).catch((err: unknown) =>
        reportWarning(`rooms: could not switch ${kind}`, err),
      );
    };
    if (next.micId !== previous.micId) switchTo('audioinput', next.micId);
    if (next.camId !== previous.camId) switchTo('videoinput', next.camId);
    if (next.speakerId !== previous.speakerId) switchTo('audiooutput', next.speakerId);
  }

  /**
   * Create and resume the AudioContext from inside a user gesture.
   *
   * Otherwise it is built lazily on the first REMOTE track, which can be long
   * after any click — and a context created outside a gesture starts
   * `suspended` under autoplay policy, so the first person to speak to you is
   * inaudible until something else happens to resume it. The pre-join dialog is
   * a gesture and calls this.
   */
  primeAudio(): AudioContext {
    const ctx = (this.audioCtx ??= new AudioContext());
    this.resumeAudio();
    return ctx;
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'avToken':
        // Resyncs re-send the same grant — only an actual room change reconnects.
        if (msg.room !== this.currentRoomName) this.switchRoom(msg.serverUrl, msg.room, msg.token);
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

  /** Map-transition handoff: disconnect, reconnect to the new room, resubscribe. */
  private switchRoom(serverUrl: string, roomName: string, token: string): void {
    this.currentRoomName = roomName;
    this.enqueue(async () => {
      if (this.currentRoomName !== roomName) return; // superseded by a later door
      try {
        const old = this.room;
        if (old) {
          this.room = null;
          await old.disconnect().catch(() => undefined);
        }
        for (const userId of [...this.chains.keys()]) this.dropAudioChain(userId);
        avStore.clear();
        avStore.setStatus('connecting');

        const room = this.createRoom();
        this.room = room;
        await room.connect(serverUrl, token, { autoSubscribe: false });
        avStore.setStatus('live');
        // A refused microphone is a supported state, but it must be VISIBLE:
        // otherwise the student is inaudible and has no way to know it.
        let micOk = true;
        await room.localParticipant.setMicrophoneEnabled(this.local.audio).catch(() => {
          micOk = false;
        });
        await room.localParticipant.setCameraEnabled(this.local.video).catch(() => undefined);
        if (!micOk && this.local.audio) avStore.setStatus('denied');
        // Device choice does not survive a reconnect on its own: a new Room
        // means new tracks, published with the browser default.
        this.applyDevices({ audio: false, video: false });
        // Peers already close/near are subscribed as LiveKit reports their
        // publications; anyone already present is handled here.
        for (const participant of room.remoteParticipants.values()) {
          this.applySubscription(participant.identity);
        }
      } catch (err) {
        avStore.setStatus('failed');
        reportWarning('rooms: livekit connect failed; placeholder bubbles remain', err);
      }
    });
  }

  private createRoom(): Room {
    // adaptiveStream would size streams by element visibility; our bubbles are
    // tiny and proximity already governs what is subscribed, so it stays off.
    // dynacast lets the SFU stop forwarding layers nobody subscribes to.
    const room = new Room({ adaptiveStream: false, dynacast: true });

    room.on(RoomEvent.TrackPublished, (_pub: RemoteTrackPublication, p: RemoteParticipant) =>
      this.applySubscription(p.identity),
    );
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) =>
      // A peer can appear AFTER proximity already said 'close' (our socket
      // beats WebRTC); apply the pending subscription the moment they exist.
      this.applySubscription(p.identity),
    );
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) =>
      this.attachTrack(p.identity, track),
    );
    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Video) {
        this.dropAudioChain(p.identity);
      } else if (track.source === Track.Source.ScreenShare) {
        avStore.setScreenTrack(p.identity, null);
      } else {
        avStore.setVideoTrack(p.identity, null);
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      this.dropAudioChain(p.identity);
      avStore.remove(p.identity);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const remote = speakers.find((s) => s.identity !== room.localParticipant.identity);
      avStore.setSpeaking(remote?.identity ?? null);
    });
    room.on(RoomEvent.MediaDevicesError, (err: Error) =>
      reportWarning('rooms: media device unavailable; continuing without it', err),
    );
    return room;
  }

  private attachTrack(userId: string, track: RemoteTrack): void {
    if (track instanceof RemoteVideoTrack) {
      if (track.source === Track.Source.ScreenShare) {
        avStore.setScreenTrack(userId, track.mediaStreamTrack);
      } else {
        avStore.setVideoTrack(userId, track.mediaStreamTrack);
      }
    } else if (track instanceof RemoteAudioTrack) {
      // Routed through WebAudio rather than LiveKit's setVolume so a zone
      // change can be RAMPED — an instant volume step is audible.
      this.ensureAudioChain(userId, track.mediaStreamTrack);
      this.applyGain(userId);
    }
  }

  /**
   * Subscribe/unsubscribe every publication of a peer according to its zone —
   * EXCEPT a shared screen, which ignores distance entirely.
   *
   * This one line is the difference between a demo and a huddle. Proximity is
   * right for conversation: you hear who you are standing near. It is exactly
   * wrong for a presentation, where the whole point is that everyone can see
   * it, and a five-tile radius would mean the back of the room watches someone
   * gesture at a screen they cannot see.
   *
   * The AUDIO of a presenter still follows proximity. Use the `spotlight` zone
   * (Phase 6) if they should be heard across the map too — sharing a screen is
   * not on its own a claim on everyone's ears.
   */
  private applySubscription(userId: string): void {
    const participant = this.room?.remoteParticipants.get(userId);
    if (!participant) return;
    const zone = this.zones.get(userId);
    const near = zone === 'close' || zone === 'near';
    for (const publication of participant.trackPublications.values()) {
      const wanted = publication.source === Track.Source.ScreenShare ? true : near;
      if (publication.isSubscribed !== wanted) publication.setSubscribed(wanted);
    }
  }

  /**
   * Start or stop sharing this screen.
   *
   * Not part of `AvState`: mic and camera are persisted intent that survives a
   * reload, and a screen share is not — coming back to a page and finding
   * yourself still presenting your desktop is a privacy failure, not a
   * convenience.
   */
  async setScreenShare(enabled: boolean): Promise<boolean> {
    const room = this.room;
    if (!room) return false;
    try {
      await room.localParticipant.setScreenShareEnabled(enabled);
      return enabled;
    } catch (err) {
      // Cancelling the browser's own picker lands here, and is not an error —
      // it is the answer "no".
      reportWarning('rooms: screen share not started', err);
      return false;
    }
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

    // source → [panner] → gain → destination.
    //
    // The panner goes BEFORE the gain, never after, and the order is the whole
    // safety property: the zone gain is the ENVELOPE and encodes server policy
    // — `out` is 0 because the track is unsubscribed, not because it is
    // distant. A panner downstream of it could make an unsubscribed peer
    // audible or a close one faint, and would be overruling the server from
    // the client.
    const panner = spatialEnabled() ? this.createPanner(ctx) : null;
    if (panner) source.connect(panner).connect(gain).connect(ctx.destination);
    else source.connect(gain).connect(ctx.destination);

    this.chains.set(userId, { trackId: track.id, source, gain, panner, el });
    this.startPannerLoop();
  }

  private createPanner(ctx: AudioContext): PannerNode {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    // One tile is "right next to you"; NEAR_TILES is the hard cutoff the
    // server already enforces by unsubscribing, so rolling off past it would
    // be attenuating something that is not there.
    panner.refDistance = 1;
    panner.maxDistance = 5;
    panner.rolloffFactor = 1;
    return panner;
  }

  /**
   * Move the panners to where the avatars are, at 10Hz.
   *
   * Reads `avatarTilePositions` — the same per-frame module map the minimap
   * uses — rather than subscribing to anything: positions change 60 times a
   * second and this needs them six times less often than that. Phase 5 is the
   * standing reminder about what per-frame work costs.
   *
   * The tile plane maps to WebAudio's X/Z (Z is depth), with the listener at
   * the local avatar. Y stays 0: nobody is above anybody.
   */
  private startPannerLoop(): void {
    if (this.pannerTimer !== null) return;
    this.pannerTimer = setInterval(() => {
      const ctx = this.audioCtx;
      const selfId = this.room?.localParticipant.identity;
      if (!ctx || !selfId) return;
      const self = avatarTilePositions.get(selfId);
      if (!self) return;

      setXYZ(ctx.listener, self.x, 0, self.y, ctx.currentTime);
      for (const [userId, chain] of this.chains) {
        if (!chain.panner) continue;
        const at = avatarTilePositions.get(userId);
        if (!at) continue;
        setXYZ(chain.panner, at.x, 0, at.y, ctx.currentTime);
      }
    }, 1000 / PANNER_HZ);
  }

  private stopPannerLoop(): void {
    if (this.pannerTimer === null) return;
    clearInterval(this.pannerTimer);
    this.pannerTimer = null;
  }

  private dropAudioChain(userId: string): void {
    const chain = this.chains.get(userId);
    if (!chain) return;
    this.chains.delete(userId);
    chain.source.disconnect();
    chain.panner?.disconnect();
    chain.gain.disconnect();
    chain.el.srcObject = null;
    if (this.chains.size === 0) this.stopPannerLoop();
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
      reportWarning('rooms: livekit operation failed', err);
    });
  }

  /**
   * What is actually subscribed, right now, per peer.
   *
   * Exists for the drive, and it has to exist there because the mechanic this
   * whole design rests on is INVISIBLE from the DOM: a peer whose tracks are
   * subscribed and a peer whose tracks are merely muted render identically —
   * same bubble, same initials, same silence. The claim being tested is that
   * walking away DROPS the subscription rather than muting it, and only the
   * LiveKit room object knows the difference.
   */
  probe(): AvProbe {
    const room = this.room;
    return {
      status: avStore.getStatus(),
      room: this.currentRoomName,
      peers: [...(room?.remoteParticipants.values() ?? [])].map((p) => ({
        userId: p.identity,
        zone: this.zones.get(p.identity) ?? 'out',
        subscribed: [...p.trackPublications.values()]
          .filter((pub) => pub.isSubscribed)
          .map((pub) => String(pub.source)),
      })),
    };
  }

  /**
   * Bytes actually received, per peer, from the WebRTC stats.
   *
   * `isSubscribed` is a SIGNALLING fact — it says the SFU was asked to forward
   * a track, not that a single packet arrived. If ICE fails (the classic dev
   * failure: LiveKit advertising a container address the browser cannot reach)
   * every subscription still reports true and the room is silent. This is the
   * difference between "we asked for audio" and "audio is here".
   */
  async probeBytes(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      let total = 0;
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (!track) continue;
        const report = await track.getRTCStatsReport().catch(() => null);
        report?.forEach((stat: { type?: string; bytesReceived?: number }) => {
          if (stat.type === 'inbound-rtp') total += stat.bytesReceived ?? 0;
        });
      }
      out[participant.identity] = total;
    }
    return out;
  }
}

export type AvProbe = {
  status: ReturnType<typeof avStore.getStatus>;
  room: string | null;
  peers: Array<{ userId: string; zone: Zone; subscribed: string[] }>;
};

export const avManager = new AvManager();

// Dev-only handle, mirroring `__roomGame` in game/create-game.ts and there for
// the same reason: some of what this code does cannot be observed from outside
// it, and a drive that can only see the DOM would be asserting the wrong thing.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __av?: () => AvProbe;
    __avBytes?: () => Promise<Record<string, number>>;
  };
  w.__av = () => avManager.probe();
  w.__avBytes = () => avManager.probeBytes();
}
