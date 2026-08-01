import Phaser from 'phaser';
import { toastStore } from '../hud/toast-store.js';
import { RoomScene, zoomForViewport, type RoomSceneData } from './RoomScene.js';

// The world fills its container and follows it on resize (W2). It used to be a
// fixed 960x704 box inside an article layout, and that single fact is most of
// why it read as a widget rather than a place.

export type { RoomSceneData };
export { zoomForViewport };

export function createRoomGame(parent: HTMLElement, data: RoomSceneData): Phaser.Game {
  const game = new Phaser.Game({
    // AUTO, deliberately. Forcing WEBGL for the performance is tempting and
    // wrong: a machine that cannot make a WebGL context then renders NOTHING —
    // a black rectangle where the world should be, with no error. Headless
    // browsers are the common case, but so is an old campus lab machine, and a
    // slow world beats no world. The fallback is reported below rather than
    // being silent, which was the actual complaint.
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#171512',
    pixelArt: true,
    // Kills sub-pixel shimmer on a moving camera. Only the text pills were
    // rounded before, so the tiles crawled under them while walking.
    roundPixels: true,
    powerPreference: 'high-performance',
    // The input-layer stack owns focus now; Phaser must not steal it back.
    autoFocus: false,
    disableContextMenu: true,
    physics: { default: 'arcade' },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
    },
  });
  game.scene.add('room', RoomScene, true, data);
  // Canvas is a supported but markedly slower renderer for a pixelArt world.
  // Say so once rather than leaving a halved frame rate to be discovered.
  game.events.once(Phaser.Core.Events.READY, () => {
    if (game.renderer.type === Phaser.WEBGL) return;
    toastStore.show({
      id: 'renderer',
      tone: 'warn',
      dismissible: true,
      body: 'This browser has no hardware acceleration, so the world will draw slowly.',
    });
  });
  if (import.meta.env.DEV) {
    // Dev-only handle so a headless drive can inspect scene/input state when
    // the world stops responding — there is no other way in from the outside.
    (window as unknown as { __roomGame?: Phaser.Game }).__roomGame = game;
  }
  return game;
}
