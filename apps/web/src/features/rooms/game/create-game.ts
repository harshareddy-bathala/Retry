import Phaser from 'phaser';
import { RoomScene, type RoomSceneData } from './RoomScene.js';

// 30x22 tiles of viewport at zoom 2 — smaller than the 20x15-tile map's pixel
// size, so the camera actually pans and the bounds clamp is exercised.
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 704;

export type { RoomSceneData };

export function createRoomGame(parent: HTMLElement, data: RoomSceneData): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#171512',
    pixelArt: true,
    physics: { default: 'arcade' },
  });
  game.scene.add('room', RoomScene, true, data);
  if (import.meta.env.DEV) {
    // Dev-only handle so a headless drive can inspect scene/input state when
    // the world stops responding — there is no other way in from the outside.
    (window as unknown as { __roomGame?: Phaser.Game }).__roomGame = game;
  }
  return game;
}
