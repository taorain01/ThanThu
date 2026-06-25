export const PLINKO_CONFIG = {
  board: {
    width: 42,
    height: 36,
    topY: 16,
    bottomY: -17,
    slotY: -14.5,
    pegStartY: 12.8,
    pegRows: 13,
    pegSpacing: 2.8,
    rowSpacing: 2.05,
    pegRadius: 0.2,
    ballRadius: 0.38,
    wallPadding: 0.72,
    outPadding: 2.8
  },
  slots: [
    { label: "500", score: 500, color: "#22c55e" },
    { label: "800", score: 800, color: "#38bdf8" },
    { label: "1200", score: 1200, color: "#a78bfa" },
    { label: "1800", score: 1800, color: "#f97316" },
    { label: "2500", score: 2500, color: "#facc15" },
    { label: "JACKPOT", score: 5000, color: "#fef08a", jackpot: true },
    { label: "2500", score: 2500, color: "#facc15" },
    { label: "1800", score: 1800, color: "#f97316" },
    { label: "1200", score: 1200, color: "#a78bfa" },
    { label: "800", score: 800, color: "#38bdf8" },
    { label: "500", score: 500, color: "#22c55e" }
  ],
  milestones: [
    { label: "10m", progress: 0.18, score: 1000 },
    { label: "20m", progress: 0.34, score: 1000 },
    { label: "30m", progress: 0.5, score: 1000 },
    { label: "40m", progress: 0.66, score: 1000 },
    { label: "50m", progress: 0.82, score: 1000 }
  ],
  physics: {
    gravity: 0.0048,
    bounce: 0.55,
    bumperBounce: 1.25,
    wallBounce: 0.68,
    horizontalDamping: 0.994,
    verticalDamping: 0.998,
    maxSpeed: 0.32,
    nudge: 0.026,
    kickVelocityY: 0.48,
    kickVelocityX: 0.18,
    postCollisionGraceMs: 150,
    sameCollisionWindowMs: 700,
    sameCollisionLimit: 5,
    antiStuckPushX: 0.34,
    antiStuckPushY: 0.11,
    perBallMaxMs: 8200,
    perBallMinMs: 1800,
    postLandDelayMs: 520
  },
  scoring: {
    timePenaltyPerSecond: 20,
    outPenalty: 300,
    kickPenalty: 250,
    glowStep: 500,
    glowMaxScore: 10000
  },
  round: {
    dropStaggerMs: 3000,
    activeOnly: false
  },
  collectibles: {
    maxDesktop: 12,
    maxMobile: 7,
    spawnMinMs: 450,
    spawnMaxMs: 800,
    lifetimeMs: 6000,
    radius: 0.32,
    magnetRadius: 3.2,
    weights: {
      coin: 48,
      star: 18,
      luckyStar: 6,
      tiny: 8,
      magnet: 7,
      shield: 5,
      grow: 4,
      sticky: 2,
      kick: 2
    },
    points: {
      coin: 80,
      star: 250,
      luckyStar: 500
    }
  },
  buffs: {
    tinyScale: 0.75,
    growScale: 1.45,
    tinyMs: 4000,
    growMs: 4000,
    magnetMs: 4000,
    shieldMs: 5000,
    stickyMs: 700
  },
  traps: {
    bumperRadius: 0.2,
    blackHoleRadius: 1.3,
    blackHoleMaxDesktop: 2,
    blackHoleMaxMobile: 1,
    blackHoleHoldMinMs: 500,
    blackHoleHoldMaxMs: 700,
    blackHoleCooldownMs: 2000,
    blackHoleSpawnMinMs: 4200,
    blackHoleSpawnMaxMs: 7200,
    blackHoleLifetimeMs: 9000
  },
  renderer: {
    cameraZ: 48,
    cameraY: 0.2,
    fov: 46
  }
};
