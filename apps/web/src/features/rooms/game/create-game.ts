import Phaser from 'phaser';
import { RoomScene, zoomForViewport, type RoomSceneData } from './RoomScene.js';

// The world fills its container and follows it on resize (W2). It used to be a
// fixed 960x704 box inside an article layout, and that single fact is most of
// why it read as a widget rather than a place.

export type { RoomSceneData };
export { zoomForViewport };

export function createRoomGame(parent: HTMLElement, data: RoomSceneData): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#171512',
    pixelArt: true,
    physics: { default: 'arcade' },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
    },
  });
  game.scene.add('room', RoomScene, true, data);
  if (import.meta.env.DEV) {
    // Dev-only handle so a headless drive can inspect scene/input state when
    // the world stops responding — there is no other way in from the outside.
    (window as unknown as { __roomGame?: Phaser.Game }).__roomGame = game;
  }
  return game;
}
