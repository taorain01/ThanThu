import { PLINKO_CONFIG } from "./config.js";
import { startPlinko3DGame, cleanupPlinko3DGame } from "./engine3d.js";
import { startPlinkoFallback2D, cleanupPlinkoFallback2D } from "./fallback2d.js";

const plinko3DGame = {
  id: "plinko-3d",
  legacyId: 3,
  name: "Linh Ngọc Plinko 3D",
  icon: "🔮",
  description: "Một round tính điểm theo thời gian, nhặt sao, né bẫy và săn Jackpot.",
  enabled: true,
  maxPlayers: 40,
  config: PLINKO_CONFIG,
  start: startPlinko3DGame,
  startFallback: startPlinkoFallback2D,
  cleanup(context) {
    cleanupPlinko3DGame(context);
    cleanupPlinkoFallback2D(context);
  }
};

export default plinko3DGame;
