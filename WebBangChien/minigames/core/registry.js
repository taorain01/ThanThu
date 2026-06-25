import speedDerbyGame from "../games/speed-derby/index.js";
import plinko3DGame from "../games/plinko-3d/index.js";
import towerClimbGame from "../games/tower-climb/index.js";

export const gameRegistry = [
  speedDerbyGame,
  plinko3DGame,
  towerClimbGame
];

const WHEEL_COLORS = ["#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export function getGameById(id) {
  return gameRegistry.find((game) => game.id === id) || null;
}

export function getGameByLegacyId(legacyId) {
  return gameRegistry.find((game) => game.legacyId === legacyId) || null;
}

export function getEnabledGames() {
  return gameRegistry.filter((game) => game.enabled);
}

export function getRandomWheelEntries() {
  const enabledGames = getEnabledGames();
  const sourceGames = enabledGames.length ? enabledGames : [speedDerbyGame];

  return WHEEL_COLORS.map((color, index) => {
    const game = sourceGames[index % sourceGames.length];
    return {
      id: game.legacyId,
      gameId: game.id,
      name: game.name,
      color,
      icon: game.icon
    };
  });
}
