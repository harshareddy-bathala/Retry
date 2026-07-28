# Rooms — where the world stands, and what to do next

Written at the end of the **beta polish** track (R6), which followed the
"make the rooms real with the licensed art" track. This is the handover: what
exists now, what to do first when you sit down, and what is deliberately left.

---

## Do this first (20 minutes)

```bash
pnpm install
pnpm --filter @retry/maps assets:build     # the pack is REQUIRED
pnpm --filter @retry/maps assets:check     # must print "licensed pack present and built"
pnpm --filter @retry/db migrate
docker compose up -d                       # postgres, redis, mailpit
pnpm dev
```

Then run the drive, which does in fifteen seconds what used to take ten minutes
by hand:

```bash
pnpm --filter @retry/e2e drive
```

Then look at it yourself, because drives assert and eyes judge. Open `/world`
in two browsers as two students and check:

1. The character creator opens on a first-ever entry, and the preview walks.
2. The Commons floor is a clean, uniform cream — **not** a lattice of offset
   rectangles. If it is, someone changed `FLOORS` without rendering a map.
3. Twelve doors along the north wall, swinging open as you approach.
4. Walk up to a chair: **"E — sit"**. Sit, and the avatar faces the way the
   chair does. Any movement key stands you up.
5. Press `1`–`8`: a thought bubble over your head, seen in the other browser.
6. Press Enter, type, send: a speech bubble over your head that only the other
   student sees **if they are standing near you**. Walk away and try again.
7. Open the chat panel in a room and type: the other side shows "… is typing".
8. Kill the room server. Remotes freeze and dim, a banner appears, you can
   still walk. After five attempts, a **Rejoin** button. Restart it and press it.
9. Open `/world` at 800px wide: an explanation, not a broken canvas.

---

## What exists now

| Track | What it did |
|---|---|
| Pack world (5 commits) | Licensed art, character creator, y-sorting, five templates, animated doors |
| **R6 beta polish** (5 commits) | Everything below |

R6, in one line each:

- Socket status is **read** from the socket, not accumulated from events —
  the "RECONNECTING… while it plainly works" bug was a replay problem.
- Application-level `ping`/`pong`; four unanswered beats reconnect.
- Build-plan Phase 8.1: freeze-and-dim remotes, a banner, and **Rejoin** after
  five attempts instead of retrying forever.
- Avatar texture cache LRU-capped at 40 with the live cast pinned.
- Public rooms are created **doorless** when the Commons is full instead of
  409ing; doors are re-handed out when one frees, and reconciled at boot.
- The Commons is 40×16 with **twelve** doors and a furnished centre.
- Floors fixed (see the trap in `docs/authoring-maps.md`), chairs fixed,
  `tableRound` fixed, classroom desk grid staggered, walls decorated.
- **Sitting**, **emotes**, **typing notices**, **proximity speech**, a
  **minimap**, **click-a-name-to-pan**, and a **Say bar** on Enter.
- A **desktop gate** under 1024px or a coarse pointer.
- `apps/e2e`: a committed two-browser drive and a 50-socket load script.

Docs worth reading before you touch anything:
`docs/assets-setup.md` (the pack, and why CI can never render),
`docs/authoring-maps.md` (the layer contract, seats, and the floor trap),
`WEBSOCKET_EVENTS.md` §6 (the whole wire protocol),
`packages/maps/README.md` (the pipeline).

---

## Next steps, in the order I would do them

### 1. Provision LiveKit — the largest remaining gap

**AV has never run.** It is coded, unit-tested, and shipped *off*, because no
server exists. Everything else in the rooms has now been driven end to end;
this has not. `docs/livekit-vps.md` has the recipe, including the warning that
TURN on TCP/443 is mandatory rather than optional on Indian campus and mobile
networks.

Set `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in
`apps/room-server/.env`, then verify the four things `PROGRESS.md` has recorded
as unexercised since Phase 5:

- audio connects in under a second;
- bandwidth in `chrome://webrtc-internals` tracks **proximity**, not room
  population — that is the whole mechanic, and nothing has ever confirmed it;
- the 200 ms gain ramp is smooth across a zone boundary rather than a step;
- denying camera permission degrades to initials, and the HUD says so (the
  status line under the mic/cam toggles is new and untested against a real
  server).

### 2. Author the rooms properly

The generator is gone (`seed-maps.ts`, `tiles.catalog.ts` and the four sheet
preview scripts were deleted). The five JSONs in `packages/maps/maps/` are the
only source of truth, and the loop is edit → validate → render → look:

```bash
pnpm --filter @retry/maps tiled         # if you want the Tiled palette
pnpm --filter @retry/maps validate      # after every session, before committing
pnpm --filter @retry/maps preview:all   # generated/preview/*.png
```

Read "Things that will bite you" in `docs/authoring-maps.md` first — especially
**do not convert the embedded tilesets to external ones**, because Phaser
cannot follow an external `.tsx` and will render an empty room without erroring.

Five Room_Builder sheets are already built into `generated/tilesets/` and used
by **no map**: `walls3d`, `shadows`, `borders`, `entryways`, `connectors`.
Bringing them in is pure map-JSON work — no build change — and it is what turns
a walled rectangle into a room.

What is still worth an eye:
- The Commons is large and its two ends are quieter than its middle.
- The lounge's counter run reads as floating cabinets rather than a bar.
- The `podium` in the conference room is not obviously a podium.

### 3. Finding tiles

There is no catalogue to grow. The pack numbers its 5,470 objects rather than
naming them, so render a map and read it — the grid is misleading and your eye
is the only real check. Earlier passes shipped a conference table that was two
shelf strips, audience chairs that were backpacks, and a "round table" that was
a crate stacked on a sofa arm. All three looked right in a sheet preview.

### 4. Things I would watch in the first week of real use

- **The `chatMessage` id for nearby speech is session-scoped**, not a database
  id. Nothing persists it and the client only needs a React key. If anything
  ever tries to reference a nearby line by id, it will be referencing nothing.
- **`room_members.last_position`.** Re-authoring a room moves the floor under
  stored positions. People spawn inside walls and get resynced out. Prefer
  editing rooms nobody is standing in.
- **The Commons is 40 tiles wide and the camera shows about 30.** That is what
  the minimap is for; if the hall grows again, check the minimap still reads.
- **Emote keys are validated but never persisted.** Adding one is free.
  Renaming one breaks the client of anyone mid-session — add, don't rename.

### 5. Before this is student-facing

- **AV.** See above. This is the one.
- **The accessibility story is honest but thin.** The world is a canvas with an
  aria-label naming the Workspace as the equivalent path, and the desktop gate
  says the same. That is deliberate rather than accidental now, which is an
  improvement on where it was — but nobody has tested the Workspace with a
  screen reader, and that is the path we are pointing people at.
- **The pack licence.** Credit is carried in
  `packages/maps/art/ATTRIBUTION.md` by project decision. If the product ever
  gets an about/credits screen, `limezu.itch.io` belongs on it.

---

## Things you should know that are not obvious

Measured during this work, and easy to get wrong later:

- **Phaser defers `destroy()` to its next step.** A game torn down before it has
  ever stepped — StrictMode's double-invoke, a fast route change — never removes
  its canvas, and the dead one stacks over the live one so the world renders as
  a black rectangle. `RoomCanvas` removes `game.canvas` itself for this reason.
- **`watch` validates `roomId` as a uuid.** A non-uuid frame is dropped as
  unparseable with **no reply at all**, so the client waits forever. Three tests
  failed silently on this before anyone noticed.
- **`RoomHub.broadcast` reaches watchers only for allow-listed events**
  (`WATCHER_EVENTS`). Adding a server→client event that a Workspace should see
  means adding it there too; `actorTyping` was missed exactly once.
- **The scope decides the requirement, not the map.** Speech needs an avatar; a
  chat log needs a room. Both `chat` and `typing` used to ask "am I in a room?"
  first and were therefore refused in the Commons, which is precisely where
  students run into each other.
- Character frames are **32×64**, on a **56×20** grid. Row 1 is idle, row 2 is
  walk, and the direction order inside a row is **right, up, left, down**.
- **Body sheets are 1854 px wide; every other layer is 1792.** Address frames by
  (column, row), never by linear index.
- Catalogue ids (`body_03`, `outfit_07`) are **persisted per user**. Add freely;
  never rename or remove one that someone may have chosen.

---

## The verification that exists

- **181 automated tests** (`pnpm -r test`): 100 room-server WS, 52 API,
  18 map/validator, 12 protocol.
- **A committed browser drive** (`pnpm --filter @retry/e2e drive`): two students
  in one room over system Edge, plus the phone gate. See `apps/e2e/README.md`.
- **A load script** (`pnpm --filter @retry/e2e load`): 50 sockets moving at the
  real client's cadence. Last run: p50 1.9 ms, p95 67.8 ms, p99 100.4 ms
  against the 150 ms NFR-PERF-06 budget.
- `pnpm -r build` passes **with and without** the art pack — without it the app
  builds and shows a setup screen rather than throwing. That is what CI runs.
