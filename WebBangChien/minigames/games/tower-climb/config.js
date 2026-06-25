export const TOWER_CONFIG = {
  towerRadius: 8,
  towerHeight: 92,
  baselineDurationSeconds: 35,
  stepsPerRevolution: 14,
  platformWidth: 2.35,
  platformDepth: 1.35,
  platformHeight: 0.18,
  stepHeight: 1.35,
  pillarRadius: 1.05,
  lanternInterval: 8,
  vineCount: 10,
  camera: {
    radius: 24,
    yOffset: 9,
    lookYOffset: 2.8,
    leadProgress: 0.035,
    orbitSpeed: 0.00032,
    smooth: 0.055, // deprecated, kept for fallback
    spring: {
      stiffness: 45,
      damping: 0.85,
      lagMs: 200
    },
    dynamicFov: {
      enabled: true,
      min: 60,
      max: 70,
      speedThreshold: 0.015,
      smoothing: 0.1
    },
    eventZoom: {
      enabled: true,
      duration: 300,
      intensity: 0.85
    }
  },
  motion: {
    hopHeight: 0.74,
    landingBounce: 0.22,
    groundOffset: 0.62,
    podiumGroundOffset: 1.12,
    stepSnapStrength: 0.14,
    maxVisualStepsPerSecond: 4.2,
    strideSpeed: 0.018,
    trailIntervalMs: 120,
    dustCount: 4,
    boostTrailCount: 8
  },
  events: {
    minDelayMs: 720,
    maxDelayMs: 1450,
    trapPenaltyRatio: 0.055,
    windPenaltyRatio: 0.032,
    boostBonusRatio: 0.046,
    goldenBonusRatio: 0.078,
    trapPenaltySteps: { min: 3, max: 4 },
    windPenaltySteps: { min: 2, max: 2.8 },
    boostBonusSteps: { min: 3, max: 4 },
    goldenBonusSteps: { min: 5, max: 6 },
    maxStackedJumpSteps: 6
  },
  renderer: {
    toneMapping: 'ACESFilmic',
    toneMappingExposure: 1.4,
    shadowMapType: 'PCFSoft'
  },
  ambientDust: {
    count: 200,
    upwardSpeed: { min: 0.005, max: 0.015 },
    radius: 15,
    size: 0.15,
    opacity: 0.3,
    color: '#aaffaa'
  },
  stars: {
    count: 500,
    radius: 150,
    size: 0.5,
    opacity: 0.8,
    twinkleSpeed: 0.00001
  },
  sky: {
    topColor: '#0a0020',
    midColor: '#1a0a3e',
    bottomColor: '#2d1b4e',
    radius: 200
  }
};
