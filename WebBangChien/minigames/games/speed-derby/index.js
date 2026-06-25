import { DERBY_SCENE_CONFIG } from "./config.js";
import { startSpeedDerbyGame, cleanupSpeedDerbyGame } from "./engine3d.js";
import { startSpeedDerbyFallback2D } from "./fallback2d.js";

const speedDerbyGame = {
  id: "speed-derby",
  legacyId: 1,
  name: "Đua Thú",
  icon: "🚀",
  description: "Chạy đua tối đa 40 làn, tránh sét, nhặt tốc độ về đích.",
  enabled: true,
  maxPlayers: 40,
  config: DERBY_SCENE_CONFIG,
  start: startSpeedDerbyGame,
  startFallback: startSpeedDerbyFallback2D,
  cleanup: cleanupSpeedDerbyGame
};

export default speedDerbyGame;
