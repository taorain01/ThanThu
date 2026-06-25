import { startTowerClimbGame, cleanupTowerClimbGame } from "./engine3d.js";
import { startTowerClimbFallback2D, cleanupTowerClimbFallback2D } from "./fallback2d.js";

const towerClimbGame = {
  id: "tower-climb",
  legacyId: 4,
  name: "Leo Tháp Thần Thú 3D",
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
