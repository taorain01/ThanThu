import { PLINKO_CONFIG } from "./config.js";

const TRACK_LENGTH_FOR_SHARED_LEADERBOARD = 120;
const FINISH_Z_FOR_SHARED_LEADERBOARD = 10;
const DEFAULT_GAME_DURATION_SECONDS = 60;
const COLLECTIBLE_TYPES = {
  coin: { icon: "●", color: "#facc15", label: "+80" },
  star: { icon: "★", color: "#fef08a", label: "+250" },
  luckyStar: { icon: "✦", color: "#f0abfc", label: "+500" },
  tiny: { icon: "↘", color: "#67e8f9", label: "Tí hon" },
  magnet: { icon: "U", color: "#93c5fd", label: "Hút" },
  shield: { icon: "◆", color: "#bbf7d0", label: "Thuẫn" },
  grow: { icon: "↗", color: "#fb7185", label: "To" },
  sticky: { icon: "■", color: "#c084fc", label: "Kẹt" },
  kick: { icon: "▲", color: "#fdba74", label: "Đá" }
};

let fallbackLoopId = null;
let fallbackCountdownTimer = null;
let fallbackRunning = false;
let fallbackLegacy = null;
let fallbackBalls = [];
let fallbackPegs = [];
let fallbackSlots = [];
let fallbackBumpers = [];
let fallbackBlackHoles = [];
let fallbackCollectibles = [];
let fallbackParticles = [];
let fallbackStartMs = 0;
let fallbackLastFrameMs = 0;
let fallbackDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
let fallbackNextCollectibleAt = 0;
let fallbackNextBlackHoleAt = 0;
let fallbackResizeHandler = null;
let fallbackFinishTriggered = false;
let fallbackStageMode = false;
let fallbackLeaderboardSyncAt = 0;
let fallbackQueue = [];
let fallbackActiveBall = null;
let fallbackCurrentBallIndex = 0;
let fallbackRoundEndAt = 0;
let fallbackBallStartedAt = 0;
let fallbackNextBallAt = 0;
let fallbackLandingSequence = 0;
let fallbackPrizeCount = 3;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function getDurationSeconds() {
  const value = parseInt(document.getElementById("race-duration-select")?.value || String(DEFAULT_GAME_DURATION_SECONDS), 10);
  return Number.isFinite(value) ? value : DEFAULT_GAME_DURATION_SECONDS;
}

function getSelectedPrizeCount() {
  const value = parseInt(document.getElementById("prize-count-select")?.value || "3", 10);
  return clamp(Number.isFinite(value) ? value : 3, 1, 5);
}

function getPodiumPositions(count) {
  const visualOrder = {
    1: [1],
    2: [2, 1],
    3: [2, 1, 3],
    4: [4, 2, 1, 3],
    5: [4, 2, 1, 3, 5]
  }[count] || [4, 2, 1, 3, 5];
  const spacing = count <= 3 ? 7.2 : 4.15;
  const heights = [0, 1.25, 0.92, 0.76, 0.62, 0.52];
  const colors = ["", "#facc15", "#cbd5e1", "#fdba74", "#60a5fa", "#a78bfa"];
  return visualOrder.map((rank, index) => ({
    rank,
    x: (index - (visualOrder.length - 1) / 2) * spacing,
    y: -4.35 + heights[rank] * 0.9,
    color: colors[rank]
  }));
}

function getPrizeText(rank) {
  return document.getElementById(`prize-input-${rank}`)?.value || `Giải ${rank}`;
}

function shortName(value, max = 12) {
  const text = String(value || "Linh Ngọc").trim() || "Linh Ngọc";
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function isMobileCanvas() {
  const canvas = document.getElementById("fallback-canvas");
  return (canvas?.width || window.innerWidth || 1024) < 700;
}

function setupFallbackDom(names) {
  const lobby = document.getElementById("lobby-view");
  const arena = document.getElementById("arena-view");
  const webglCanvas = document.getElementById("webgl-canvas");
  const fallbackCanvas = document.getElementById("fallback-canvas");
  const labelOverlay = document.getElementById("derby-label-overlay");
  const cameraLayer = document.getElementById("derby-camera-layer");
  const container = document.getElementById("webgl-container");

  if (lobby) lobby.style.display = "none";
  if (arena) arena.style.display = "flex";
  if (webglCanvas) webglCanvas.style.display = "none";
  if (fallbackCanvas) fallbackCanvas.style.display = "block";
  if (labelOverlay) labelOverlay.innerHTML = "";
  if (cameraLayer) cameraLayer.style.display = "none";
  if (container) container.classList.add("plinko-3d-active");

  const logo = document.querySelector(".arena-logo");
  const sidebarTitle = document.querySelector("#arena-sidebar .sidebar-title span");
  if (logo) logo.textContent = "Rơi Tự Do";
  if (sidebarTitle) sidebarTitle.textContent = "Bảng Điểm Linh Ngọc";
  document.getElementById("racer-progress-title").textContent = `Round ${getDurationSeconds()}s: 0 / ${names.length}`;
  document.getElementById("leaderboard-list").innerHTML = "";
  fallbackLegacy?.updateCommentaryText?.("🔮 Plinko 2D dự phòng: ăn mốc, nhặt sao, né bẫy và giữ điểm đến hết giờ.");
}

function getCanvasMetrics(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const boardWidth = Math.min(width * 0.9, 1080);
  const boardHeight = Math.min(height * 0.82, 790);
  const left = (width - boardWidth) / 2;
  const top = Math.max(26, (height - boardHeight) / 2);
  return { width, height, left, right: left + boardWidth, top, bottom: top + boardHeight, boardWidth, boardHeight };
}

function boardToCanvas(metrics, x, y) {
  const cfg = PLINKO_CONFIG.board;
  return {
    x: metrics.left + ((x + cfg.width / 2) / cfg.width) * metrics.boardWidth,
    y: metrics.top + ((cfg.topY - y) / (cfg.topY - cfg.bottomY)) * metrics.boardHeight
  };
}

function canvasRadius(metrics, worldRadius) {
  return worldRadius * (metrics.boardWidth / PLINKO_CONFIG.board.width);
}

function buildFallbackBoard() {
  const cfg = PLINKO_CONFIG.board;
  fallbackPegs = [];
  fallbackSlots = [];
  fallbackBumpers = [];

  for (let row = 0; row < cfg.pegRows; row++) {
    const count = row % 2 === 0 ? 10 : 11;
    const y = cfg.pegStartY - row * cfg.rowSpacing;
    for (let col = 0; col < count; col++) {
      fallbackPegs.push({
        id: `${row}-${col}`,
        x: (col - (count - 1) / 2) * cfg.pegSpacing,
        y,
        radius: cfg.pegRadius,
        pulse: 0
      });
    }
  }

  [
    [-13.5, 7.2, 4.1, -0.18],
    [13.5, 7.0, 4.1, 0.18],
    [-6.8, 2.2, 4.9, 0.24],
    [6.8, 1.7, 4.9, -0.24],
    [-12.2, -3.0, 4.6, 0.2],
    [12.2, -3.4, 4.6, -0.2],
    [0, -7.6, 5.5, 0]
  ].forEach(([x, y, length, angle], index) => {
    fallbackBumpers.push({ id: index, x, y, length, angle, radius: PLINKO_CONFIG.traps.bumperRadius, pulse: 0 });
  });

  const slotWidth = cfg.width / PLINKO_CONFIG.slots.length;
  PLINKO_CONFIG.slots.forEach((slot, index) => {
    fallbackSlots.push({ ...slot, index, x: -cfg.width / 2 + slotWidth * (index + 0.5), width: slotWidth, pulse: 0 });
  });
}

function buildFallbackBalls(names) {
  const skins = fallbackLegacy?.MYTHICAL_BEAST_SKINS || [];
  const cfg = PLINKO_CONFIG.board;
  fallbackLandingSequence = 0;
  fallbackBalls = names.map((name, index) => {
    const skin = skins[index % Math.max(1, skins.length)] || {
      name: "Linh Ngọc",
      color: ["#38bdf8", "#facc15", "#22c55e", "#f472b6"][index % 4]
    };
    return {
      name,
      index,
      skinName: skin.name || "Linh Ngọc",
      emoji: "🔮",
      color: skin.color || "#38bdf8",
      x: 0,
      y: cfg.topY + 1.1,
      vx: 0,
      vy: 0,
      grossScore: 0,
      timePenalty: 0,
      score: 0,
      scoreLabel: "0đ",
      rank: null,
      rawZ: TRACK_LENGTH_FOR_SHARED_LEADERBOARD,
      finished: false,
      landed: false,
      slotIndex: null,
      boostTimer: 0,
      slowTimer: 0,
      active: false,
      completed: false,
      completedAt: 0,
      visibleOnBoard: false,
      startedAt: 0,
      landedOrder: 0,
      leaderboardFlyUntil: 0,
      holdUntil: 0,
      holdTarget: null,
      outCooldownUntil: 0,
      blackHoleCooldownUntil: 0,
      scaleUntil: 0,
      scaleMode: null,
      magnetUntil: 0,
      shieldUntil: 0,
      shieldCharges: 0,
      lastProgress: 0,
      lastCollisionKey: "",
      lastCollisionAt: 0,
      sameCollisionCount: 0,
      collisionCooldowns: Object.create(null),
      milestones: PLINKO_CONFIG.milestones.map(() => ({ armed: true })),
      stageTarget: null
    };
  });
  fallbackQueue = [...fallbackBalls];
  fallbackActiveBall = null;
  fallbackCurrentBallIndex = 0;
  fallbackBallStartedAt = 0;
  fallbackNextBallAt = 0;
}

function resetFallbackBallRunState(ball) {
  const cfg = PLINKO_CONFIG.board;
  ball.x = randomBetween(-cfg.width * 0.34, cfg.width * 0.34);
  ball.y = cfg.topY + randomBetween(0.8, 1.7);
  ball.vx = randomBetween(-0.07, 0.07);
  ball.vy = randomBetween(-0.07, -0.015);
  ball.finished = false;
  ball.landed = false;
  ball.slotIndex = null;
  ball.boostTimer = 0;
  ball.slowTimer = 0;
  ball.active = true;
  ball.completed = false;
  ball.completedAt = 0;
  ball.visibleOnBoard = true;
  ball.landedOrder = 0;
  ball.leaderboardFlyUntil = 0;
  ball.holdUntil = 0;
  ball.holdTarget = null;
  ball.outCooldownUntil = 0;
  ball.blackHoleCooldownUntil = 0;
  ball.scaleUntil = 0;
  ball.scaleMode = null;
  ball.magnetUntil = 0;
  ball.shieldUntil = 0;
  ball.shieldCharges = 0;
  ball.lastProgress = 0;
  ball.lastCollisionKey = "";
  ball.lastCollisionAt = 0;
  ball.sameCollisionCount = 0;
  ball.collisionCooldowns = Object.create(null);
  ball.milestones = PLINKO_CONFIG.milestones.map(() => ({ armed: true }));
}

function startNextFallbackBall(now) {
  if (fallbackStageMode || fallbackFinishTriggered || now >= fallbackRoundEndAt) return false;
  const ball = fallbackQueue.shift();
  if (!ball) return false;
  resetFallbackBallRunState(ball);
  ball.startedAt = now;
  fallbackActiveBall = ball;
  fallbackCurrentBallIndex = ball.index + 1;
  fallbackBallStartedAt = now;
  fallbackNextBallAt = now + PLINKO_CONFIG.round.dropStaggerMs;
  fallbackLegacy?.updateCommentaryText?.(`🔮 Thả ${ball.name} (${ball.index + 1}/${fallbackBalls.length}) từ vị trí ngẫu nhiên.`);
  syncFallbackLeaderboard(true);
  return true;
}

function completeFallbackActiveBall(now, hide = true) {
  const ball = fallbackActiveBall;
  if (!ball) return;
  completeFallbackBall(ball, now, hide);
  if (fallbackActiveBall === ball) fallbackActiveBall = null;
}

function completeFallbackBall(ball, now, hide = true) {
  if (!ball) return;
  syncBallScore(ball, now);
  ball.active = false;
  ball.completed = true;
  ball.finished = true;
  ball.vx = 0;
  ball.vy = 0;
  ball.holdUntil = 0;
  ball.holdTarget = null;
  if (hide) ball.visibleOnBoard = false;
}

function markFallbackActiveBallDone(ball, now) {
  if (!ball || ball.completed) return;
  ball.completed = true;
  ball.completedAt = now + PLINKO_CONFIG.physics.postLandDelayMs;
}

function getBallScale(ball, now) {
  if (ball.scaleUntil <= now) return 1;
  if (ball.scaleMode === "tiny") return PLINKO_CONFIG.buffs.tinyScale;
  if (ball.scaleMode === "grow") return PLINKO_CONFIG.buffs.growScale;
  return 1;
}

function getBallRadius(ball, now) {
  return PLINKO_CONFIG.board.ballRadius * getBallScale(ball, now);
}

function clampBallVelocity(ball, limit = PLINKO_CONFIG.physics.maxSpeed) {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (speed <= limit || speed <= 0.0001) return;
  const ratio = limit / speed;
  ball.vx *= ratio;
  ball.vy *= ratio;
}

function shouldSkipCollision(ball, key, now) {
  return Boolean(ball.collisionCooldowns && ball.collisionCooldowns[key] > now);
}

function noteCollision(ball, key, nx, now) {
  const physics = PLINKO_CONFIG.physics;
  if (ball.lastCollisionKey === key && now - ball.lastCollisionAt <= physics.sameCollisionWindowMs) {
    ball.sameCollisionCount += 1;
  } else {
    ball.lastCollisionKey = key;
    ball.sameCollisionCount = 1;
  }
  ball.lastCollisionAt = now;
  if (ball.sameCollisionCount < physics.sameCollisionLimit) return false;
  const side = nx >= 0 ? 1 : -1;
  ball.x += side * physics.antiStuckPushX;
  ball.y -= physics.antiStuckPushY;
  ball.vx = side * Math.max(Math.abs(ball.vx), 0.14);
  ball.vy = Math.min(ball.vy, -0.08);
  ball.sameCollisionCount = 0;
  ball.collisionCooldowns[key] = now + physics.postCollisionGraceMs * 2.2;
  clampBallVelocity(ball, physics.maxSpeed * 1.15);
  createParticle(ball.x, ball.y, "#bfdbfe", 5);
  return true;
}

function getBoardProgress(ball) {
  const cfg = PLINKO_CONFIG.board;
  return clamp((cfg.topY - ball.y) / Math.max(1, cfg.topY - cfg.slotY), 0, 1);
}

function setSharedLeaderboardProgress(ball, progress) {
  ball.rawZ = TRACK_LENGTH_FOR_SHARED_LEADERBOARD
    - clamp(progress, 0, 1) * (TRACK_LENGTH_FOR_SHARED_LEADERBOARD - FINISH_Z_FOR_SHARED_LEADERBOARD);
}

function getSortedFallbackBalls() {
  return [...fallbackBalls].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const progressDiff = getBoardProgress(b) - getBoardProgress(a);
    if (Math.abs(progressDiff) > 0.001) return progressDiff;
    return a.index - b.index;
  });
}

function getLiveFallbackLeaderboardOrder() {
  if (fallbackStageMode) return getSortedFallbackBalls();
  return [...fallbackBalls].sort((a, b) => {
    const aLanded = a.landedOrder > 0;
    const bLanded = b.landedOrder > 0;
    if (aLanded && bLanded) return b.landedOrder - a.landedOrder;
    if (aLanded !== bLanded) return aLanded ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.index - b.index;
  });
}

function syncBallScore(ball, now) {
  if (ball.active && !ball.landed && !fallbackStageMode) {
    ball.timePenalty = Math.floor(((now - ball.startedAt) / 1000) * PLINKO_CONFIG.scoring.timePenaltyPerSecond);
  }
  ball.score = Math.max(0, Math.round(ball.grossScore - ball.timePenalty));
  ball.scoreLabel = `${ball.score}đ`;
}

function syncFallbackLeaderboard(force = false) {
  const now = performance.now();
  if (!force && now - fallbackLeaderboardSyncAt < 140) return getLiveFallbackLeaderboardOrder();
  fallbackLeaderboardSyncAt = now;
  fallbackBalls.forEach((ball) => syncBallScore(ball, now));
  const scoreSorted = getSortedFallbackBalls();
  scoreSorted.forEach((ball, index) => {
    ball.rank = index + 1;
  });
  const displayOrder = fallbackStageMode ? scoreSorted : getLiveFallbackLeaderboardOrder();
  displayOrder.forEach((ball) => {
    ball.finished = fallbackStageMode || ball.completed;
    ball.displayRankLabel = fallbackStageMode ? `Top ${ball.rank}` : (ball.landedOrder ? `#${ball.landedOrder}` : "...");
    const classes = [fallbackStageMode ? "plinko-final-item" : "plinko-live-item"];
    if (!fallbackStageMode && ball.leaderboardFlyUntil > now) classes.push("plinko-leaderboard-flyin");
    ball.leaderboardClass = classes.join(" ");
    setSharedLeaderboardProgress(ball, clamp(ball.score / Math.max(1, PLINKO_CONFIG.scoring.glowMaxScore), 0, 1));
  });
  fallbackLegacy?.updateLeaderboardUI?.(displayOrder);
  const title = document.getElementById("racer-progress-title");
  if (title) {
    const remaining = Math.max(0, Math.ceil(((fallbackRoundEndAt || fallbackStartMs + fallbackDurationMs) - now) / 1000));
    const current = Math.min(fallbackBalls.length, Math.max(fallbackCurrentBallIndex, fallbackBalls.length - fallbackQueue.length));
    title.textContent = fallbackStageMode ? `Top ${fallbackPrizeCount} nhận giải` : `Còn ${remaining}s • Bi ${current}/${fallbackBalls.length}`;
  }
  return displayOrder;
}

function addScore(ball, amount, reason, now) {
  ball.grossScore = Math.max(0, ball.grossScore + amount);
  syncBallScore(ball, now);
  ball.boostTimer = amount > 0 ? 45 : ball.boostTimer;
  if (reason && amount >= 500) fallbackLegacy?.updateCommentaryText?.(`✨ ${ball.name}: ${reason} (${amount > 0 ? "+" : ""}${amount})`);
  createParticle(ball.x, ball.y, amount >= 0 ? "#facc15" : "#fb7185", amount >= 500 ? 9 : 5);
}

function applyPenalty(ball, amount, reason, now) {
  if (ball.shieldCharges > 0 && ball.shieldUntil > now) {
    ball.shieldCharges = 0;
    ball.shieldUntil = 0;
    fallbackLegacy?.updateCommentaryText?.(`🛡️ Linh Thuẫn của ${ball.name} chặn ${reason}.`);
    createParticle(ball.x, ball.y, "#bbf7d0", 8);
    return false;
  }
  addScore(ball, -Math.abs(amount), reason, now);
  ball.slowTimer = 55;
  return true;
}

function maxCollectibles() {
  return isMobileCanvas() ? PLINKO_CONFIG.collectibles.maxMobile : PLINKO_CONFIG.collectibles.maxDesktop;
}

function weightedCollectibleType() {
  const entries = Object.entries(PLINKO_CONFIG.collectibles.weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return "coin";
}

function spawnCollectibles(now) {
  fallbackCollectibles = fallbackCollectibles.filter((item) => !item.taken && now < item.expiresAt);
  if (!fallbackBalls.some((ball) => ball.active && !ball.completed) || fallbackCollectibles.length >= maxCollectibles() || now < fallbackNextCollectibleAt) return;
  const cfg = PLINKO_CONFIG.board;
  const type = weightedCollectibleType();
  fallbackCollectibles.push({
    type,
    x: randomBetween(-cfg.width * 0.42, cfg.width * 0.42),
    y: randomBetween(cfg.slotY + 2.2, cfg.topY - 1.8),
    radius: PLINKO_CONFIG.collectibles.radius * (type === "coin" ? 0.82 : 1),
    bornAt: now,
    expiresAt: now + PLINKO_CONFIG.collectibles.lifetimeMs,
    taken: false
  });
  fallbackNextCollectibleAt = now + randomBetween(PLINKO_CONFIG.collectibles.spawnMinMs, PLINKO_CONFIG.collectibles.spawnMaxMs);
}

function spawnBlackHoles(now) {
  fallbackBlackHoles = fallbackBlackHoles.filter((hole) => now < hole.expiresAt);
  const max = isMobileCanvas() ? PLINKO_CONFIG.traps.blackHoleMaxMobile : PLINKO_CONFIG.traps.blackHoleMaxDesktop;
  if (!fallbackBalls.some((ball) => ball.active && !ball.completed) || fallbackBlackHoles.length >= max || now < fallbackNextBlackHoleAt) return;
  const cfg = PLINKO_CONFIG.board;
  fallbackBlackHoles.push({
    x: randomBetween(-cfg.width * 0.36, cfg.width * 0.36),
    y: randomBetween(cfg.slotY + 4, cfg.topY - 5),
    radius: PLINKO_CONFIG.traps.blackHoleRadius,
    expiresAt: now + PLINKO_CONFIG.traps.blackHoleLifetimeMs
  });
  fallbackNextBlackHoleAt = now + randomBetween(PLINKO_CONFIG.traps.blackHoleSpawnMinMs, PLINKO_CONFIG.traps.blackHoleSpawnMaxMs);
}

function createParticle(x, y, color, count = 6) {
  for (let i = 0; i < count; i++) {
    fallbackParticles.push({
      x,
      y,
      vx: randomBetween(-0.08, 0.08),
      vy: randomBetween(-0.04, 0.12),
      life: randomBetween(22, 42),
      maxLife: 42,
      color,
      size: randomBetween(0.05, 0.13)
    });
  }
}

function createScoreParticle(x, y, text, color) {
  fallbackParticles.push({
    x,
    y,
    vx: 0,
    vy: 0.11,
    life: 58,
    maxLife: 58,
    color,
    size: 0.12,
    text
  });
}

function triggerFallbackLeaderboardFlyIn(ball, now) {
  ball.leaderboardFlyUntil = now + 1600;
  syncFallbackLeaderboard(true);
  const canvas = document.getElementById("fallback-canvas");
  const list = document.getElementById("leaderboard-list");
  if (!canvas || !list) return;
  const metrics = getCanvasMetrics(canvas);
  const point = boardToCanvas(metrics, ball.x, ball.y);
  const canvasRect = canvas.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const startX = canvasRect.left + (point.x / Math.max(1, canvas.width)) * canvasRect.width;
  const startY = canvasRect.top + (point.y / Math.max(1, canvas.height)) * canvasRect.height;
  const endX = listRect.left + 32;
  const endY = listRect.top + 32;
  const pill = document.createElement("div");
  pill.className = "plinko-score-flyer";
  pill.textContent = `${shortName(ball.name, 14)} +${PLINKO_CONFIG.slots[ball.slotIndex]?.score || 0}`;
  pill.style.setProperty("--sx", `${startX}px`);
  pill.style.setProperty("--sy", `${startY}px`);
  pill.style.setProperty("--ex", `${endX}px`);
  pill.style.setProperty("--ey", `${endY}px`);
  pill.style.setProperty("--ball-color", ball.color || "#38bdf8");
  document.body.appendChild(pill);
  setTimeout(() => pill.remove(), 1200);
}

function applyCollectible(ball, item, now) {
  item.taken = true;
  const points = PLINKO_CONFIG.collectibles.points[item.type] || 0;
  if (points) {
    addScore(ball, points, COLLECTIBLE_TYPES[item.type]?.label || "nhặt thưởng", now);
    fallbackLegacy?.playTickSound?.(500 + points * 0.25, 0.045);
  } else if (item.type === "tiny") {
    ball.scaleMode = "tiny";
    ball.scaleUntil = now + PLINKO_CONFIG.buffs.tinyMs;
    fallbackLegacy?.updateCommentaryText?.(`💠 ${ball.name} hóa Tí Hon, dễ lọt khe hơn!`);
  } else if (item.type === "magnet") {
    ball.magnetUntil = now + PLINKO_CONFIG.buffs.magnetMs;
    fallbackLegacy?.updateCommentaryText?.(`🧲 ${ball.name} bật Nam Châm hút đồng xu và sao.`);
  } else if (item.type === "shield") {
    ball.shieldUntil = now + PLINKO_CONFIG.buffs.shieldMs;
    ball.shieldCharges = 1;
    fallbackLegacy?.updateCommentaryText?.(`🛡️ ${ball.name} có Linh Thuẫn.`);
  } else if (item.type === "grow") {
    if (applyPenalty(ball, 0, "Phình To", now)) {
      ball.scaleMode = "grow";
      ball.scaleUntil = now + PLINKO_CONFIG.buffs.growMs;
    }
  } else if (item.type === "sticky") {
    if (applyPenalty(ball, 0, "Dính Kẹt", now)) {
      ball.holdUntil = now + PLINKO_CONFIG.buffs.stickyMs;
      ball.holdTarget = { x: ball.x, y: ball.y };
    }
  } else if (item.type === "kick") {
    if (applyPenalty(ball, PLINKO_CONFIG.scoring.kickPenalty, "Đá Bay", now)) {
      ball.vy = PLINKO_CONFIG.physics.kickVelocityY;
      ball.vx += randomBetween(-PLINKO_CONFIG.physics.kickVelocityX, PLINKO_CONFIG.physics.kickVelocityX);
    }
  }
  createParticle(item.x, item.y, COLLECTIBLE_TYPES[item.type]?.color || "#facc15", 7);
}

function handleCollectibles(dt, now) {
  fallbackBalls.filter((ball) => ball.active && !ball.completed).forEach((ball) => {
    const radius = getBallRadius(ball, now);
    fallbackCollectibles.forEach((item) => {
      if (item.taken) return;
      if (ball.magnetUntil > now && PLINKO_CONFIG.collectibles.points[item.type]) {
        const mdx = ball.x - item.x;
        const mdy = ball.y - item.y;
        const md = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
        if (md < PLINKO_CONFIG.collectibles.magnetRadius) {
          item.x += (mdx / md) * 0.12 * dt;
          item.y += (mdy / md) * 0.12 * dt;
        }
      }
      const dx = ball.x - item.x;
      const dy = ball.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < radius + item.radius) applyCollectible(ball, item, now);
    });
  });
  fallbackCollectibles = fallbackCollectibles.filter((item) => !item.taken && now < item.expiresAt);
}

function handlePegCollision(ball, peg, dt, now) {
  const key = `peg:${peg.id}`;
  if (shouldSkipCollision(ball, key, now)) return false;
  const dx = ball.x - peg.x;
  const dy = ball.y - peg.y;
  let dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = getBallRadius(ball, now) + peg.radius;
  if (dist >= minDist) return false;
  if (dist < 0.0001) dist = 0.0001;
  const nx = dx / dist || randomBetween(-1, 1);
  const ny = dy / dist || 1;
  ball.x = peg.x + nx * minDist;
  ball.y = peg.y + ny * minDist;
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot < 0.18) {
    ball.vx -= (1 + PLINKO_CONFIG.physics.bounce) * dot * nx;
    ball.vy -= (1 + PLINKO_CONFIG.physics.bounce) * dot * ny;
  }
  ball.vx += randomBetween(-PLINKO_CONFIG.physics.nudge, PLINKO_CONFIG.physics.nudge) * dt;
  clampBallVelocity(ball, PLINKO_CONFIG.physics.maxSpeed);
  noteCollision(ball, key, nx, now);
  peg.pulse = 1;
  return true;
}

function closestPointOnBumper(ball, bumper) {
  const cos = Math.cos(bumper.angle);
  const sin = Math.sin(bumper.angle);
  const dx = ball.x - bumper.x;
  const dy = ball.y - bumper.y;
  const localX = dx * cos + dy * sin;
  const clampedX = clamp(localX, -bumper.length / 2, bumper.length / 2);
  return { x: bumper.x + clampedX * cos, y: bumper.y + clampedX * sin };
}

function handleBumperCollision(ball, bumper, dt, now) {
  const key = `bumper:${bumper.id}`;
  if (shouldSkipCollision(ball, key, now)) return false;
  const point = closestPointOnBumper(ball, bumper);
  const dx = ball.x - point.x;
  const dy = ball.y - point.y;
  const tangentX = Math.cos(bumper.angle);
  const tangentY = Math.sin(bumper.angle);
  const localX = (ball.x - bumper.x) * tangentX + (ball.y - bumper.y) * tangentY;
  let dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = getBallRadius(ball, now) + bumper.radius + 0.06;
  if (dist >= minDist) return false;
  if (dist < 0.0001) dist = 0.0001;
  const nx = dx / dist || Math.sin(bumper.angle);
  const ny = dy / dist || Math.cos(bumper.angle);
  ball.x = point.x + nx * minDist;
  ball.y = point.y + ny * minDist;
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot < 0) {
    ball.vx -= (1 + PLINKO_CONFIG.physics.bumperBounce) * dot * nx;
    ball.vy -= (1 + PLINKO_CONFIG.physics.bumperBounce) * dot * ny;
  }

  const tangentVelocity = ball.vx * tangentX + ball.vy * tangentY;
  const escapeDirection = Math.abs(localX) > 0.08
    ? Math.sign(localX)
    : (Math.abs(tangentVelocity) > 0.025 ? Math.sign(tangentVelocity) : (ball.index % 2 === 0 ? 1 : -1));
  const slideImpulse = PLINKO_CONFIG.physics.bumperSlideImpulse * dt;
  ball.vx += tangentX * escapeDirection * slideImpulse;
  ball.vy += tangentY * escapeDirection * slideImpulse;

  const escapedRepeatedCollision = noteCollision(ball, key, tangentX * escapeDirection, now);
  if (escapedRepeatedCollision) {
    ball.x += tangentX * escapeDirection * PLINKO_CONFIG.physics.bumperEscapePush;
    ball.y += tangentY * escapeDirection * PLINKO_CONFIG.physics.bumperEscapePush;
    ball.vx = tangentX * escapeDirection * Math.max(
      Math.abs(ball.vx),
      PLINKO_CONFIG.physics.bumperEscapeVelocity
    );
    ball.vy = Math.min(ball.vy, -0.1);
  }
  clampBallVelocity(ball, PLINKO_CONFIG.physics.maxSpeed * 1.35);
  bumper.pulse = 1;
  createParticle(point.x, point.y, "#f8fafc", 4);
  return true;
}

function handleBlackHole(ball, now) {
  if (now < ball.blackHoleCooldownUntil || ball.holdUntil > now) return;
  const hole = fallbackBlackHoles.find((item) => {
    const dx = ball.x - item.x;
    const dy = ball.y - item.y;
    return Math.sqrt(dx * dx + dy * dy) < item.radius + getBallRadius(ball, now);
  });
  if (!hole) return;
  ball.holdUntil = now + randomBetween(PLINKO_CONFIG.traps.blackHoleHoldMinMs, PLINKO_CONFIG.traps.blackHoleHoldMaxMs);
  ball.blackHoleCooldownUntil = now + PLINKO_CONFIG.traps.blackHoleCooldownMs;
  ball.holdTarget = { x: hole.x, y: hole.y };
  ball.vx *= 0.1;
  ball.vy *= 0.1;
}

function getSlotIndexForX(x) {
  const cfg = PLINKO_CONFIG.board;
  const slotWidth = cfg.width / PLINKO_CONFIG.slots.length;
  return clamp(Math.floor((x + cfg.width / 2) / slotWidth), 0, PLINKO_CONFIG.slots.length - 1);
}

function landBall(ball, now) {
  if (ball.landed) return;
  const slotIndex = getSlotIndexForX(ball.x);
  const slot = fallbackSlots[slotIndex];
  ball.grossScore += slot.score;
  ball.landed = true;
  ball.slotIndex = slotIndex;
  ball.landedOrder = ++fallbackLandingSequence;
  ball.leaderboardFlyUntil = now + 1600;
  ball.x = lerp(ball.x, slot.x, 0.78);
  ball.y = PLINKO_CONFIG.board.slotY;
  ball.vx = 0;
  ball.vy = 0;
  slot.pulse = slot.jackpot ? 2.8 : 2.1;
  syncBallScore(ball, now);
  createParticle(slot.x, ball.y, slot.color, slot.jackpot ? 28 : 16);
  createScoreParticle(slot.x, ball.y + 0.8, `+${slot.score}`, slot.color);
  triggerFallbackLeaderboardFlyIn(ball, now);
  if (slot.jackpot) fallbackLegacy?.updateCommentaryText?.(`🏆 ${ball.name} rơi vào JACKPOT: +${slot.score} điểm!`);
  markFallbackActiveBallDone(ball, now);
}

function checkMilestones(ball, now) {
  const progress = getBoardProgress(ball);
  PLINKO_CONFIG.milestones.forEach((milestone, index) => {
    const state = ball.milestones[index];
    if (state.armed && ball.lastProgress < milestone.progress && progress >= milestone.progress) {
      state.armed = false;
      addScore(ball, milestone.score, `qua mốc ${milestone.label}`, now);
    }
    if (!state.armed && progress < milestone.progress - 0.055) state.armed = true;
  });
  ball.lastProgress = progress;
}

function handleOutOfBounds(ball, now) {
  const cfg = PLINKO_CONFIG.board;
  const outX = cfg.width / 2 + cfg.outPadding;
  const outTop = cfg.topY + 5;
  if (Math.abs(ball.x) <= outX && ball.y <= outTop) return;
  if (now < ball.outCooldownUntil) return;
  ball.outCooldownUntil = now + 1800;
  applyPenalty(ball, PLINKO_CONFIG.scoring.outPenalty, "rớt ra ngoài", now);
  const side = ball.x < 0 ? -1 : 1;
  ball.x = side * (cfg.width * 0.42);
  ball.y = clamp(ball.y, cfg.slotY + 6, cfg.topY - 1.8);
  ball.vx = -side * randomBetween(0.18, 0.28);
  ball.vy = randomBetween(-0.12, -0.04);
  createParticle(ball.x, ball.y, "#38bdf8", 10);
}

function updateBallPhysics(ball, dt, now) {
  if (!ball || !ball.active || ball.completed || ball.landed || fallbackStageMode) return;
  if (ball.holdUntil && now < ball.holdUntil) {
    const target = ball.holdTarget || { x: ball.x, y: ball.y };
    ball.x = lerp(ball.x, target.x, 0.14);
    ball.y = lerp(ball.y, target.y, 0.14);
    return;
  }
  if (ball.holdUntil && now >= ball.holdUntil) {
    ball.holdUntil = 0;
    ball.holdTarget = null;
    ball.vx += randomBetween(-0.08, 0.08);
    ball.vy -= 0.08;
  }

  const cfg = PLINKO_CONFIG.board;
  const physics = PLINKO_CONFIG.physics;
  ball.vy -= physics.gravity * dt;
  ball.vx *= Math.pow(physics.horizontalDamping, dt);
  ball.vy *= Math.pow(physics.verticalDamping, dt);
  ball.vx = clamp(ball.vx, -physics.maxSpeed, physics.maxSpeed);
  ball.vy = clamp(ball.vy, -physics.maxSpeed, physics.kickVelocityY);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < -cfg.width / 2 + cfg.wallPadding) ball.vx += 0.018 * dt;
  if (ball.x > cfg.width / 2 - cfg.wallPadding) ball.vx -= 0.018 * dt;

  for (const peg of fallbackPegs) {
    if (Math.abs(ball.y - peg.y) > 1.2 || Math.abs(ball.x - peg.x) > 1.2) continue;
    if (handlePegCollision(ball, peg, dt, now)) break;
  }
  for (const bumper of fallbackBumpers) {
    if (Math.abs(ball.y - bumper.y) > 1.35 || Math.abs(ball.x - bumper.x) > bumper.length / 2 + 1.55) continue;
    if (handleBumperCollision(ball, bumper, dt, now)) break;
  }

  handleBlackHole(ball, now);
  handleOutOfBounds(ball, now);
  checkMilestones(ball, now);
  if (ball.y <= cfg.slotY) landBall(ball, now);
  syncBallScore(ball, now);
}

function updateFallbackParticles(dt) {
  for (let i = fallbackParticles.length - 1; i >= 0; i--) {
    const particle = fallbackParticles[i];
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy -= 0.004 * dt;
    particle.life -= dt;
    if (particle.life <= 0) fallbackParticles.splice(i, 1);
  }
}

function finishFallbackGame(now = performance.now(), reason = "time") {
  if (fallbackFinishTriggered) return;
  const finishNow = Math.min(now, fallbackRoundEndAt || now);
  fallbackFinishTriggered = true;
  fallbackStageMode = true;
  fallbackBalls.forEach((ball) => {
    syncBallScore(ball, finishNow);
    ball.active = false;
    ball.completed = true;
    ball.visibleOnBoard = false;
    ball.vx = 0;
    ball.vy = 0;
    ball.finished = true;
    ball.holdUntil = 0;
    ball.holdTarget = null;
  });
  fallbackActiveBall = null;
  fallbackQueue = [];
  const sorted = syncFallbackLeaderboard(true);
  const podium = getPodiumPositions(fallbackPrizeCount);
  podium.forEach((pos) => {
    const ball = sorted[pos.rank - 1];
    if (ball) {
      ball.visibleOnBoard = true;
      ball.stageTarget = { ...pos, scale: pos.rank === 1 ? 1.8 : 1.55 };
    }
  });
  fallbackLegacy?.stopRaceTimer?.(true);
  fallbackLegacy?.playVictorySound?.();
  fallbackLegacy?.showPostGameActions?.(sorted, { camera: false });
  fallbackLegacy?.updateCommentaryText?.(
    reason === "all-balls-complete"
      ? `🏆 Tất cả linh ngọc đã rơi xong! Top ${fallbackPrizeCount} đang bay lên bục nhận giải.`
      : `🏆 Hết giờ! Top ${fallbackPrizeCount} linh ngọc đang bay lên bục nhận giải.`
  );
}

function updateStage(dt) {
  fallbackBalls.forEach((ball) => {
    if (!ball.stageTarget) return;
    ball.x = lerp(ball.x, ball.stageTarget.x, 0.035 * dt);
    ball.y = lerp(ball.y, ball.stageTarget.y, 0.035 * dt);
  });
}

function drawFallback(ctx, canvas, now) {
  const metrics = getCanvasMetrics(canvas);
  const { width, height, left, top, boardWidth, boardHeight, bottom } = metrics;
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#020817");
  bg.addColorStop(0.56, "#061527");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = "rgba(56,189,248,0.28)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "rgba(11,41,56,0.9)";
  ctx.strokeStyle = "rgba(186,230,253,0.52)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  drawRoundedRect(ctx, left, top, boardWidth, boardHeight, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  PLINKO_CONFIG.milestones.forEach((milestone) => {
    const y = PLINKO_CONFIG.board.topY - milestone.progress * (PLINKO_CONFIG.board.topY - PLINKO_CONFIG.board.slotY);
    const point = boardToCanvas(metrics, -PLINKO_CONFIG.board.width / 2 + 2, y);
    ctx.strokeStyle = "rgba(254,240,138,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 28, point.y);
    ctx.lineTo(left + boardWidth - 28, point.y);
    ctx.stroke();
    const label = `${milestone.label} +${milestone.score}`;
    const labelW = 168;
    ctx.fillStyle = "rgba(2,6,23,0.84)";
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    drawRoundedRect(ctx, point.x - labelW / 2, point.y - 43, labelW, 36, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fef08a";
    ctx.font = "900 23px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, point.x, point.y - 17);
  });

  fallbackPegs.forEach((peg) => {
    const point = boardToCanvas(metrics, peg.x, peg.y);
    const radius = canvasRadius(metrics, peg.radius) * (1 + peg.pulse * 0.42);
    ctx.fillStyle = "#dffcf4";
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    peg.pulse = Math.max(0, peg.pulse - 0.055);
  });
  ctx.shadowBlur = 0;

  fallbackBumpers.forEach((bumper) => {
    const point = boardToCanvas(metrics, bumper.x, bumper.y);
    const len = canvasRadius(metrics, bumper.length);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(-bumper.angle);
    ctx.fillStyle = "#f8fafc";
    ctx.shadowColor = "#e0f2fe";
    ctx.shadowBlur = 10 + bumper.pulse * 14;
    ctx.fillRect(-len / 2, -3 - bumper.pulse * 4, len, 6 + bumper.pulse * 8);
    ctx.restore();
    bumper.pulse = Math.max(0, bumper.pulse - 0.055);
  });

  fallbackBlackHoles.forEach((hole) => {
    const point = boardToCanvas(metrics, hole.x, hole.y);
    const radius = canvasRadius(metrics, hole.radius);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.68 + Math.sin(now * 0.006) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#020617";
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * 0.36, 0, Math.PI * 2);
    ctx.fill();
  });

  fallbackCollectibles.forEach((item) => {
    const meta = COLLECTIBLE_TYPES[item.type] || COLLECTIBLE_TYPES.coin;
    const point = boardToCanvas(metrics, item.x, item.y + Math.sin(now * 0.004 + item.x) * 0.08);
    const radius = canvasRadius(metrics, item.radius);
    ctx.fillStyle = meta.color;
    ctx.shadowColor = meta.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#020617";
    ctx.font = "900 11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(meta.icon, point.x, point.y + 4);
  });

  fallbackSlots.forEach((slot) => {
    const center = boardToCanvas(metrics, slot.x, PLINKO_CONFIG.board.bottomY + 1.4);
    const slotW = (slot.width / PLINKO_CONFIG.board.width) * boardWidth;
    const x = center.x - slotW / 2;
    const y = bottom - 72;
    const height = 58 + slot.pulse * 10;
    ctx.fillStyle = `${slot.color}66`;
    ctx.strokeStyle = `${slot.color}dd`;
    ctx.lineWidth = 2;
    ctx.shadowColor = slot.color;
    ctx.shadowBlur = 8 + slot.pulse * 16;
    ctx.beginPath();
    drawRoundedRect(ctx, x, y, slotW - 4, height, 9);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff7cc";
    ctx.font = slot.jackpot ? "900 23px Inter, sans-serif" : "900 27px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(slot.label, center.x, y + height / 2);
    ctx.textBaseline = "alphabetic";
    slot.pulse = Math.max(0, slot.pulse - 0.055);
  });

  fallbackParticles.forEach((particle) => {
    const point = boardToCanvas(metrics, particle.x, particle.y);
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    if (particle.text) {
      const boxW = 112;
      const boxH = 38;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = "rgba(2,6,23,0.88)";
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      drawRoundedRect(ctx, point.x - boxW / 2, point.y - boxH / 2, boxW, boxH, 10);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff7cc";
      ctx.font = "900 22px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(particle.text, point.x, point.y + 1);
      ctx.textBaseline = "alphabetic";
    } else {
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, canvasRadius(metrics, particle.size) * (0.7 + alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  const sorted = getSortedFallbackBalls();
  const topFive = new Set(sorted.slice(0, 5).map((ball) => ball.index));
  fallbackBalls.filter((ball) => fallbackStageMode ? ball.stageTarget : ball.visibleOnBoard).forEach((ball) => {
    const point = boardToCanvas(metrics, ball.x, ball.y);
    const glowLevel = topFive.has(ball.index)
      ? Math.floor(clamp(ball.score, 0, PLINKO_CONFIG.scoring.glowMaxScore) / PLINKO_CONFIG.scoring.glowStep)
      : 0;
    const radius = canvasRadius(metrics, PLINKO_CONFIG.board.ballRadius * getBallScale(ball, now)) * (fallbackStageMode && ball.stageTarget ? ball.stageTarget.scale : 1);
    ctx.save();
    ctx.shadowColor = ball.color;
    ctx.shadowBlur = 10 + glowLevel * 1.7;
    const grad = ctx.createRadialGradient(point.x - radius * 0.35, point.y - radius * 0.4, radius * 0.1, point.x, point.y, radius);
    grad.addColorStop(0, "#fff7cc");
    grad.addColorStop(0.42, ball.color);
    grad.addColorStop(1, "#312e81");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ball.shieldCharges > 0 ? "#bbf7d0" : "rgba(255,247,204,0.84)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const labelY = point.y - radius - 72;
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(2,6,23,0.96)";
    ctx.lineWidth = 7;
    ctx.fillStyle = "#f8fafc";
    ctx.font = "900 28px Inter, sans-serif";
    ctx.strokeText(shortName(ball.name, 16), point.x, labelY);
    ctx.fillText(shortName(ball.name, 16), point.x, labelY);
    ctx.strokeStyle = "rgba(2,6,23,0.96)";
    ctx.lineWidth = 6;
    ctx.fillStyle = "#fff7cc";
    ctx.font = "900 24px Inter, sans-serif";
    ctx.strokeText(`${ball.score} điểm`, point.x, labelY + 34);
    ctx.fillText(`${ball.score} điểm`, point.x, labelY + 34);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  });

  if (fallbackStageMode) {
    const positions = getPodiumPositions(fallbackPrizeCount);
    positions.forEach((pos) => {
      const point = boardToCanvas(metrics, pos.x, pos.y - 1.2);
      const ball = sorted[pos.rank - 1];
      ctx.fillStyle = `${pos.color}aa`;
      ctx.beginPath();
      drawRoundedRect(ctx, point.x - 62, point.y, 124, 58, 10);
      ctx.fill();
      ctx.fillStyle = "#020617";
      ctx.font = "900 13px Inter, sans-serif";
      ctx.fillText(`Hạng ${pos.rank}`, point.x, point.y + 16);
      ctx.fillText(ball ? `${shortName(ball.name, 10)} • ${ball.score}đ` : "Đang chờ", point.x, point.y + 34);
      ctx.font = "800 10px Inter, sans-serif";
      ctx.fillText(getPrizeText(pos.rank), point.x, point.y + 50);
    });
  }
}

function resizeFallbackCanvas(canvas) {
  const container = document.getElementById("webgl-container");
  const width = Math.max(1, container?.clientWidth || window.innerWidth || 960);
  const height = Math.max(1, container?.clientHeight || window.innerHeight || 540);
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function animateFallback(now = performance.now()) {
  if (!fallbackRunning) return;
  const canvas = document.getElementById("fallback-canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const dt = clamp((now - (fallbackLastFrameMs || now)) / 16.67, 0.45, 2.25);
  fallbackLastFrameMs = now;
  fallbackLegacy?.updateRaceTimerDisplay?.();
  if (!fallbackStageMode && now >= fallbackRoundEndAt) finishFallbackGame(now, "time");

  if (fallbackStageMode) {
    updateStage(dt);
  } else {
    while (fallbackQueue.length > 0 && now >= fallbackNextBallAt && now < fallbackRoundEndAt) {
      startNextFallbackBall(fallbackNextBallAt || now);
    }
    spawnCollectibles(now);
    spawnBlackHoles(now);
    fallbackBalls.forEach((ball) => {
      if (ball.active && !ball.completed) updateBallPhysics(ball, dt, now);
      if (ball.active && ball.completed && now >= ball.completedAt) completeFallbackBall(ball, now, true);
    });
    handleCollectibles(dt, now);
    const allBallsComplete = fallbackQueue.length === 0
      && fallbackBalls.length > 0
      && fallbackBalls.every((ball) => ball.completed && !ball.active);
    if (allBallsComplete) finishFallbackGame(now, "all-balls-complete");
  }
  fallbackBalls.forEach((ball) => {
    ball.boostTimer = Math.max(0, ball.boostTimer - dt);
    ball.slowTimer = Math.max(0, ball.slowTimer - dt);
  });
  updateFallbackParticles(dt);
  syncFallbackLeaderboard(fallbackStageMode);
  drawFallback(ctx, canvas, now);
  fallbackLoopId = requestAnimationFrame(animateFallback);
}

function runFallbackCountdown() {
  const overlay = document.getElementById("countdown-overlay");
  const number = document.getElementById("countdown-number");
  if (!overlay || !number) {
    fallbackStartMs = performance.now();
    fallbackLastFrameMs = fallbackStartMs;
    const dropWindowMs = Math.max(0, fallbackBalls.length - 1) * PLINKO_CONFIG.round.dropStaggerMs;
    fallbackRoundEndAt = fallbackStartMs + fallbackDurationMs + dropWindowMs;
    fallbackNextBallAt = fallbackStartMs;
    fallbackLoopId = requestAnimationFrame(animateFallback);
    fallbackLegacy?.startRaceTimer?.(Math.ceil((fallbackRoundEndAt - fallbackStartMs) / 1000));
    startNextFallbackBall(fallbackStartMs);
    return;
  }
  overlay.style.display = "flex";
  number.classList.remove("show");
  let sec = 3;
  const showValue = (value) => {
    number.classList.remove("show");
    setTimeout(() => {
      number.textContent = value;
      number.classList.add("show");
    }, 40);
  };
  showValue(sec);
  fallbackLegacy?.playTickSound?.(620, 0.05);
  fallbackCountdownTimer = setInterval(() => {
    sec -= 1;
    if (sec > 0) {
      showValue(sec);
      fallbackLegacy?.playTickSound?.(620 + sec * 80, 0.05);
      return;
    }
    clearInterval(fallbackCountdownTimer);
    fallbackCountdownTimer = null;
    showValue("THẢ!");
    fallbackLegacy?.playHornSound?.();
    setTimeout(() => {
      if (!fallbackRunning) return;
      number.classList.remove("show");
      overlay.style.display = "none";
      fallbackStartMs = performance.now();
      fallbackLastFrameMs = fallbackStartMs;
      const dropWindowMs = Math.max(0, fallbackBalls.length - 1) * PLINKO_CONFIG.round.dropStaggerMs;
      fallbackRoundEndAt = fallbackStartMs + fallbackDurationMs + dropWindowMs;
      fallbackNextBallAt = fallbackStartMs;
      fallbackNextCollectibleAt = fallbackStartMs + 450;
      fallbackNextBlackHoleAt = fallbackStartMs + 2400;
      fallbackLoopId = requestAnimationFrame(animateFallback);
      fallbackLegacy?.startRaceTimer?.(Math.ceil((fallbackRoundEndAt - fallbackStartMs) / 1000));
      startNextFallbackBall(fallbackStartMs);
    }, 640);
  }, 900);
}

export function startPlinkoFallback2D(context, names) {
  cleanupPlinkoFallback2D();
  fallbackLegacy = context?.legacy || window.__minigamesLegacyApi || {};
  fallbackDurationMs = getDurationSeconds() * 1000;
  fallbackPrizeCount = getSelectedPrizeCount();
  fallbackFinishTriggered = false;
  fallbackStageMode = false;
  fallbackRunning = true;
  setupFallbackDom(names);
  if (typeof window.mngMusicSetMode === "function") window.mngMusicSetMode("playing");
  const canvas = document.getElementById("fallback-canvas");
  if (canvas) {
    resizeFallbackCanvas(canvas);
    fallbackResizeHandler = () => resizeFallbackCanvas(canvas);
    window.addEventListener("resize", fallbackResizeHandler, { passive: true });
  }
  buildFallbackBoard();
  buildFallbackBalls(names);
  runFallbackCountdown();
}

export function cleanupPlinkoFallback2D() {
  fallbackRunning = false;
  if (fallbackLoopId) {
    cancelAnimationFrame(fallbackLoopId);
    fallbackLoopId = null;
  }
  if (fallbackCountdownTimer) {
    clearInterval(fallbackCountdownTimer);
    fallbackCountdownTimer = null;
  }
  if (fallbackResizeHandler) {
    window.removeEventListener("resize", fallbackResizeHandler);
    fallbackResizeHandler = null;
  }
  document.getElementById("webgl-container")?.classList.remove("plinko-3d-active");
  const derbyLayer = document.getElementById("derby-camera-layer");
  if (derbyLayer) derbyLayer.style.display = "";

  fallbackLegacy = null;
  fallbackBalls = [];
  fallbackPegs = [];
  fallbackSlots = [];
  fallbackBumpers = [];
  fallbackBlackHoles = [];
  fallbackCollectibles = [];
  fallbackParticles = [];
  fallbackLeaderboardSyncAt = 0;
  fallbackQueue = [];
  fallbackActiveBall = null;
  fallbackCurrentBallIndex = 0;
  fallbackRoundEndAt = 0;
  fallbackBallStartedAt = 0;
  fallbackNextBallAt = 0;
  fallbackLandingSequence = 0;
  fallbackPrizeCount = 3;
}
