# The Live Space HUD

Two contracts hold the world together. Both were learned by breaking them, and
both are cheap to break again by accident.

---

## 1. Layout is a grid. Nothing positions itself.

`apps/web/src/features/rooms/hud/RoomHud.tsx` and the `.room-hud` rules in
`apps/web/src/styles/theme.css`.

```
grid-template-columns: minmax(0,1fr)  var(--hud-sidebar-w)  var(--hud-rail-w);
grid-template-rows:    auto           minmax(0,1fr)         auto;

  ┌──────────────────────────────────────────────┐
  │ top          (spans everything)              │
  ├──────────────────────────┬─────────┬─────────┤
  │ stage                    │ sidebar │  rail   │
  ├──────────────────────────┤         │         │
  │ dock                     │         │         │
  └──────────────────────────┴─────────┴─────────┘
```

**The sidebar is a column track, not an overlay.** `--hud-sidebar-w` is `0px`
closed and `min(20rem, 30vw)` open, flipped by `data-sidebar` on the frame.
When it opens the stage genuinely narrows, so the canvas, the minimap and the
toasts move out of its way. There is nothing to overlap, and therefore no
z-index to arbitrate.

That is the whole design. The HUD it replaced was eight independently
absolutely-positioned children with hand-picked insets, and at the supported
minimum of 1024px three of them physically collided:

- the AV controls (`left-1/2`) painted over the say bar (`left-3`, in a ~660px
  row) and — being a later DOM sibling at the same z — swallowed its clicks;
- an open panel (`right-14 w-80`) completely buried the minimap (`right-3`,
  132px wide) **including its own "show map" button**, so there was no way to
  get it back without closing the panel;
- the knock toast sat at `z-20` and the panel rail at `z-30`, so somebody
  knocking at the door while you had chat open rendered underneath the rail.

### Rules

- **A new control gets a slot, not an inset.** If it needs `absolute`, it
  belongs *inside* the stage and is anchoring to the world, not to the viewport.
- **The stage is `position: relative`.** Anything glued to the canvas anchors
  there, which is what makes it move when the sidebar opens.
- **Use the z tokens**, never a raw `z-40`: `z-world`, `z-overlay`, `z-hud`,
  `z-sidebar`, `z-toast`, `z-modal`. Note that **toast outranks sidebar** —
  that inversion is the knock-toast bug, fixed.
- **The canvas needs the `ResizeObserver`** in `RoomCanvas.tsx`. Phaser's
  `Scale.RESIZE` listens to `window.resize` and nothing else, so without it the
  world silently keeps its old width when the sidebar opens and the camera fit
  drifts. This is not optional decoration; it is what makes the canvas legal in
  a moving grid track.

---

## 2. One keyboard, one owner.

`apps/web/src/features/rooms/input/input-layers.ts`. There is exactly **one**
`keydown` listener in the world, installed by `useInputRoot`.

Push a layer with `useInputLayer(active, spec)`. Escape walks the stack from the
top down:

1. `onEscape()` returns `true` → handled: `preventDefault`, stop.
2. the layer has `capturesKeys` → stop regardless, **without** `preventDefault`.
3. otherwise, keep walking down.

Rule 2 is the load-bearing one, and it does two jobs. It is how Escape reaches
tldraw to deselect while the whiteboard panel stays open (a capturing layer with
no `onEscape`), and it is how the character creator swallows Escape on a
first-ever visit, where there is no previous look to cancel back to and being
ejected from the room would be the worse outcome.

Release is by **handle identity**, not by name or position, so two layers can
close in either order and the canvas gets its keys back only when the last one
goes.

### Rules

- **Never add a bare `window.addEventListener('keydown')` in a room component.**
  Six of them used to coexist, three in the capture phase specifically to beat
  the other three. That arrangement produced three bugs: Escape in the
  whiteboard tore down the board mid-stroke; `3` in the whiteboard picked a
  tldraw tool *and* broadcast an emote to the room; and closing the say bar
  while the chat panel was open re-enabled Phaser's keyboard, so WASD walked
  your avatar through your own sentence.
- **World hotkeys go through `useHotkey`.** They go inert automatically under
  any capturing layer. A tag check does not work — the whiteboard is a canvas,
  which is neither an `INPUT` nor a `TEXTAREA`.
- **Anything hosting a text input or a rich editor sets `capturesKeys`.**
- Phaser hears about this over exactly one event, `input:canvas-keys`. The
  scene obeys; the stack decides.

---

## 3. Primitives, tokens, and the lint that guards them

`apps/web/src/components/ui/` holds the whole set: `button`, `icon-button`,
`dialog`, `tooltip`. Radix supplies **Dialog and Tooltip only** — taken for the
focus trap, `aria-modal` and focus restore, which are the parts that hand-rolling
gets subtly wrong. Everything else is written here.

- **`text-accent-ink`, never `text-white`.** White on the copper accent is about
  1.9:1 — a WCAG failure at any size — and it was written that way at six call
  sites while the correct token was used at others, so the same button existed
  in two incompatible versions.
- **Semantic colour tokens only**: `success`, `danger`, `warn` and their
  `-tint` / `-ink` pairs. Raw `emerald`/`red`/`amber` sat beside them and the
  same state got drawn two different ways in two different files.
- **Icon-only controls use `IconButton`, which requires a `label`.** It becomes
  both the `aria-label` and the tooltip. A `title` attribute is not a reliable
  name for assistive tech and shows nothing at all on touch — which is what the
  rail used to ship, with the unread count as a purely visual badge that was
  never announced.
- **Icons are `lucide-react`, not emoji and not the pack's UI sheet.** Emoji
  render as full colour on Windows, monochrome on Linux, and at different
  metrics everywhere. The licensed `UI_32x32.png` is tempting and was declined:
  it is non-redistributable raster, so routing chrome through it would mean the
  HUD does not render without the pack — and raster cannot take `currentColor`,
  so every hover and disabled state would need its own crop. Pixel art stays
  *inside* the world, where the emote strip already is.

`node scripts/lint-tokens.mjs` (wired into `pnpm lint`) enforces all of the
above plus the two rules from sections 1 and 2 — no raw z-index, no bare
`keydown` listener. ESLint cannot see inside a class string; this can.

---

## 4. Phaser or DOM?

> Anything that must occlude, or be occluded by, world geometry lives in Phaser.
> Anything that hosts a DOM media element lives in the overlay.

So: name tags, speech pills and emote bubbles are Phaser — they y-sort with the
world and scale with camera zoom, and both would be wrong in DOM. AV bubbles are
DOM, because a `<video>` cannot reach a Phaser texture without a per-frame GPU
copy, and the bubble must host the video the instant a track arrives.

The pixel offsets shared across that boundary live in one place,
`overlay-metrics.ts`. They used to be duplicated in `BubbleOverlay.tsx` and
`RoomScene.ts` — two files, two coordinate systems, and an implicit agreement
that nothing enforced. It imports nothing, because both Phaser and React read
it and a dependency either way would be a cycle.

### The rAF loops write; they do not read

`BubbleOverlay` and `Minimap` both run a per-frame loop, and neither may read
layout or recompute anything that only changes per room.

The bubble loop reads nothing at all: the outer element is a zero-size anchor
carrying the translate, and the inner element centres itself with a static
`translate(-50%, -100%)`, so there is no size to measure. A zone change animates
as `scale`, not `width`/`height` — the latter dirties layout, which turned the
old loop's `offsetWidth` read into a real forced reflow for the 200ms of every
proximity crossing. Two students walking in and out of range measured **76
layouts over 8 seconds; it is now 0** (`Performance.getMetrics` over CDP).

The minimap paints the collision grid **once per room** into an offscreen
canvas; per frame it is one `drawImage` plus the dots. It used to repaint every
blocked cell with its own `fillRect` — up to 880 for the Commons — and call
`getContext('2d')` on every tick, sixty times a second, to draw something that
changes once per door. Palette values come from `getComputedStyle` once per
rebuild rather than per frame, and the loop skips entirely while the tab is
hidden.

---

## 5. The renderer, and the gate

**`Phaser.AUTO`, never `Phaser.WEBGL`.** Forcing WebGL for the performance is
tempting and wrong: a machine that cannot create a WebGL context then renders
*nothing* — a black rectangle where the world should be, with no error. Headless
browsers are the obvious case, but so is an old campus lab machine. A slow world
beats no world. The Canvas fallback is reported as a toast rather than being
silent, which was the actual complaint.

**The gate distinguishes `narrow` from `pointer`, and the difference matters.**

- `pointer` is a phone. It will never drive this world whatever happens to the
  viewport, so nothing mounts and no socket opens.
- `narrow` is a desktop window one drag away from working. **The session
  survives**: the socket and the LiveKit room stay up and only the canvas
  unmounts, so widening puts you back where you were standing. Re-mounting
  sends a bare `join`, which is the protocol's own resync request.

Both used to be one early return, and `canRenderWorld` also sat in the connect
effect's dependency array — so dragging a window narrower for one second
disconnected you, and a slow drag across the boundary thrashed connect/disconnect
dozens of times. `apps/e2e/tests/rooms.spec.ts` counts `WebSocket` constructions
across a resize cycle and asserts zero.


## Tilesets load per template, not up front

`RoomScene.preload` no longer loads tilesets. It loads what every session needs
— character layers, emote strips, animated objects — and the sheets a *map*
draws from arrive in `ensureTilesets`, on the way into that world.

The union of five rooms' sheets is several megabytes of texture for a room that
draws on four, including the museum's 512×3904 for a 24×20 studio. It got worse
when the rooms gained `walls3d` and `shadows`.

Two consequences worth knowing before touching this:

- **The canvas now exists before the room it will draw does.** `preload` used to
  block the scene from starting; now the scene starts and the sheets follow. The
  first build fades in from black so that reads as arriving somewhere rather
  than as a stall. It is still strictly less waiting than before.
- **`waitForWorld` is no longer sufficient in a test.** Waiting for the canvas
  element does not mean the room is drawn. `apps/e2e/tests/maps.spec.ts` polls
  the Phaser texture cache instead.

A sheet that fails to load raises a toast and lets `buildWorld` throw a named
error into the ErrorBoundary — which beats a black rectangle with a live socket.


## AV: what is decided where

Three different things govern whether you can hear someone, and keeping them
apart is what makes the system explainable:

| Decision | Owner | Mechanism |
|---|---|---|
| Am I publishing? | the student | `AvState`, persisted, **default off** |
| Can I hear *them*? | the server | proximity + map zones → `subscribe`/`unsubscribe` |
| How loud? | the client | WebAudio gain, ramped 200 ms |

The zone gain is an **envelope over server policy**, not a volume control:
`out` is 0 because the track is unsubscribed, not because it is far away. That
is why the optional `PannerNode` is inserted *before* the gain — downstream, it
could make an unsubscribed peer audible and would be overruling the server from
the client.

**Screen share is the one exception to proximity**, and it is deliberate. A
demo is for the room; a five-tile radius would mean the back row watches someone
gesture at a screen they cannot see. Their *audio* still follows proximity —
sharing a screen is not on its own a claim on everyone's ears, and `spotlight`
(Phase 6) is how that claim is made.

Screen share renders into the **`stage` grid area**, dimming the world rather
than unmounting it: Phaser keeps running, avatars keep moving, and closing the
share does not mean rebuilding the world.

### Spatial audio

Off. `localStorage.setItem('retry.rooms.spatial', 'on')` and reload. It is a
runtime switch rather than a build flag because the open question is not whether
it works but whether it earns its CPU on a lab machine with eight people in
earshot — and only someone listening on that hardware can answer it.

### Testing AV

`apps/e2e/tests/av.spec.ts`, in its own Playwright project (`edge-av`) with a
fake camera and synthetic mic. The default project has **no media devices at
all**, which is a supported state the other specs quietly cover — granting
permissions globally would delete that coverage.

It asserts through `window.__av()` rather than the DOM, because subscribed and
muted render identically: same bubble, same initials, same silence. And it
counts inbound RTP bytes, because `isSubscribed` is a signalling fact — with a
broken ICE path every subscription still reports true and the room is silent.
