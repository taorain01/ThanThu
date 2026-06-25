import { startTowerClimbGame, cleanupTowerClimbGame } from "./engine3d.js?v=20260625-3";
import { startTowerClimbFallback2D, cleanupTowerClimbFallback2D } from "./fallback2d.js?v=20260625-3";

const towerClimbGame = {
  id: "tower-climb",
  legacyId: 4,
  name: "Tháp",
  icon: "🏯",
  description: "Leo tháp xoắn ốc, tránh bẫy sập, nhặt ngọc tăng tốc lên đỉnh.",
  enabled: true,
  maxPlayers: 40,
  start: startTowerClimbGame,
  startFallback: startTowerClimbFallback2D,
  cleanup(context) {
    cleanupTowerClimbGame(context);
    cleanupTowerClimbFallback2D(context);
  }
};

export default towerClimbGame;
