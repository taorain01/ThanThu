import speedDerbyGame from "../games/speed-derby/index.js?v=20260625-3";
import plinko3DGame from "../games/plinko-3d/index.js?v=20260625-6";
import towerClimbGame from "../games/tower-climb/index.js?v=20260625-3";

export const gameRegistry = [
  speedDerbyGame,
  towerClimbGame,
  plinko3DGame
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

  return sourceGames.map((game, index) => {
    return {
      id: game.legacyId,
      gameId: game.id,
      name: game.name,
      color: WHEEL_COLORS[index % WHEEL_COLORS.length],
      icon: game.icon
    };
  });
}
