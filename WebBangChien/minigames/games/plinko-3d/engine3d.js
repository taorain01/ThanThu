import { PLINKO_CONFIG } from "./config.js";
import { startPlinkoFallback2D, cleanupPlinkoFallback2D } from "./fallback2d.js";

const TRACK_LENGTH_FOR_SHARED_LEADERBOARD = 120;
const FINISH_Z_FOR_SHARED_LEADERBOARD = 10;
const DEFAULT_GAME_DURATION_SECONDS = 60;
const JACKPOT_SLOT_INDEX = PLINKO_CONFIG.slots.findIndex((slot) => slot.jackpot);
const COLLECTIBLE_TYPES = {
  coin: { icon: "●", color: "#facc15", emissive: "#f59e0b", label: "+80" },
  star: { icon: "★", color: "#fef08a", emissive: "#facc15", label: "+250" },
  luckyStar: { icon: "✦", color: "#f0abfc", emissive: "#d946ef", label: "+500" },
  tiny: { icon: "↘", color: "#67e8f9", emissive: "#06b6d4", label: "Tí hon" },
  magnet: { icon: "U", color: "#93c5fd", emissive: "#3b82f6", label: "Hút" },
  shield: { icon: "◆", color: "#bbf7d0", emissive: "#22c55e", label: "Thuẫn" },
  grow: { icon: "↗", color: "#fb7185", emissive: "#ef4444", label: "To" },
  sticky: { icon: "■", color: "#c084fc", emissive: "#7c3aed", label: "Kẹt" },
  kick: { icon: "▲", color: "#fdba74", emissive: "#f97316", label: "Đá" }
};

let plinkoScene = null;
let plinkoCamera = null;
let plinkoRenderer = null;
let plinkoGroup = null;
let plinkoLoopId = null;
let plinkoRunning = false;
let plinkoLegacy = null;
let plinkoBalls = [];
let plinkoPegs = [];
let plinkoSlots = [];
let plinkoBumpers = [];
let plinkoBlackHoles = [];
let plinkoCollectibles = [];
let plinkoParticles = [];
let plinkoPodiumGroup = null;
let plinkoCountdownTimer = null;
let plinkoResizeHandler = null;
let plinkoStartMs = 0;
let plinkoLastFrameMs = 0;
let plinkoDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
let plinkoBaseCameraZ = PLINKO_CONFIG.renderer.cameraZ;
let plinkoNextCollectibleAt = 0;
let plinkoNextBlackHoleAt = 0;
let plinkoFinishTriggered = false;
let plinkoStageMode = false;
let plinkoFocusBall = null;
let plinkoLeaderboardSyncAt = 0;
let plinkoQueue = [];
let plinkoActiveBall = null;
let plinkoCurrentBallIndex = 0;
let plinkoRoundEndAt = 0;
let plinkoBallStartedAt = 0;
let plinkoNextBallAt = 0;
let plinkoLandingSequence = 0;
let plinkoPrizeCount = 3;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    h: heights[rank],
    color: colors[rank],
    width: count <= 3 ? 4.8 : 3.55
  }));
}

function getPrizeText(rank) {
  return document.getElementById(`prize-input-${rank}`)?.value || `Giải ${rank}`;
}

function isMobileLayout() {
  const container = document.getElementById("webgl-container");
  return (container?.clientWidth || window.innerWidth || 1024) < 700;
}

function shortName(value, max = 14) {
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

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive || color,
    emissiveIntensity: num(options.emissiveIntensity, 0.16),
    roughness: num(options.roughness, 0.52),
    metalness: num(options.metalness, 0.08),
    transparent: Boolean(options.transparent),
    opacity: num(options.opacity, 1)
  });
}

function disposeObject(object) {
  if (!object) return;
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((mat) => {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      });
    }
  });
}

function createCanvasSprite(canvas, scaleX, scaleY) {
  const texture = new THREE.CanvasTexture(canvas);
  if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleX, scaleY, 1);
  return { sprite, texture };
}

function createLabelSprite(text, color = "#facc15", width = 760, height = 160, scaleX = 6.8, scaleY = 1.35) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  drawRoundedRect(ctx, 10, 16, width - 20, height - 32, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff7cc";
  ctx.font = `900 ${text.length > 10 ? 42 : 50}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2 + 1);
  return createCanvasSprite(canvas, scaleX, scaleY).sprite;
}

function createScoreSprite(ball) {
  const canvas = document.createElement("canvas");
  canvas.width = 840;
  canvas.height = 270;
  const { sprite, texture } = createCanvasSprite(canvas, 8.25, 2.65);
  sprite.position.set(0, 1.72, 0.12);
  ball.scoreCanvas = canvas;
  ball.scoreTexture = texture;
  ball.scoreSprite = sprite;
  updateScoreSprite(ball);
  return sprite;
}

function updateScoreSprite(ball) {
  if (!ball.scoreCanvas || !ball.scoreTexture) return;
  const ctx = ball.scoreCanvas.getContext("2d");
  const w = ball.scoreCanvas.width;
  const h = ball.scoreCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(2, 6, 23, 0.96)";
  ctx.lineWidth = 14;
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 68px Inter, sans-serif";
  ctx.strokeText(shortName(ball.name, 16), w / 2, 94);
  ctx.fillText(shortName(ball.name, 16), w / 2, 94);
  ctx.strokeStyle = "rgba(2, 6, 23, 0.96)";
  ctx.lineWidth = 12;
  ctx.fillStyle = "#fff7cc";
  ctx.font = "900 52px Inter, sans-serif";
  ctx.strokeText(`${ball.score} điểm`, w / 2, 166);
  ctx.fillText(`${ball.score} điểm`, w / 2, 166);
  ball.scoreTexture.needsUpdate = true;
}

function setupPlinkoDom(names) {
  const lobby = document.getElementById("lobby-view");
  const arena = document.getElementById("arena-view");
  const webglCanvas = document.getElementById("webgl-canvas");
  const fallbackCanvas = document.getElementById("fallback-canvas");
  const labelOverlay = document.getElementById("derby-label-overlay");
  const cameraLayer = document.getElementById("derby-camera-layer");
  const container = document.getElementById("webgl-container");

  if (lobby) lobby.style.display = "none";
  if (arena) arena.style.display = "flex";
  if (webglCanvas) webglCanvas.style.display = "block";
  if (fallbackCanvas) fallbackCanvas.style.display = "none";
  if (labelOverlay) labelOverlay.innerHTML = "";
  if (cameraLayer) cameraLayer.style.display = "none";
  if (container) container.classList.add("plinko-3d-active");

  const logo = document.querySelector(".arena-logo");
  const sidebarTitle = document.querySelector("#arena-sidebar .sidebar-title span");
  if (logo) logo.textContent = "Rơi Tự Do";
  if (sidebarTitle) sidebarTitle.textContent = "Bảng Điểm Linh Ngọc";
  document.getElementById("racer-progress-title").textContent = `Round ${getDurationSeconds()}s: 0 / ${names.length}`;
  document.getElementById("leaderboard-list").innerHTML = "";
  plinkoLegacy?.updateCommentaryText?.("🔮 Một lượt Plinko bắt đầu: ăn mốc, nhặt sao, né bẫy và giữ điểm đến khi hết giờ.");
}

function getCameraZForAspect(aspect) {
  const fovRad = (PLINKO_CONFIG.renderer.fov * Math.PI) / 180;
  const verticalZ = (PLINKO_CONFIG.board.height + 4) / (2 * Math.tan(fovRad / 2));
  const horizontalZ = (PLINKO_CONFIG.board.width + 4) / (2 * Math.tan(fovRad / 2) * Math.max(aspect, 0.34));
  return Math.max(PLINKO_CONFIG.renderer.cameraZ, verticalZ, horizontalZ);
}

function resizePlinkoScene() {
  const container = document.getElementById("webgl-container");
  if (!container || !plinkoRenderer || !plinkoCamera) return;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  plinkoRenderer.setSize(width, height);
  plinkoCamera.aspect = width / height;
  plinkoBaseCameraZ = getCameraZForAspect(plinkoCamera.aspect);
  plinkoCamera.position.z = plinkoBaseCameraZ;
  plinkoCamera.updateProjectionMatrix();
}

function buildBoard() {
  const cfg = PLINKO_CONFIG.board;
  plinkoGroup = new THREE.Group();
  plinkoScene.add(plinkoGroup);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.width + 1.8, cfg.height + 1.5, 0.34),
    makeMaterial("#0b2938", { emissive: "#0f172a", emissiveIntensity: 0.08, roughness: 0.74 })
  );
  panel.position.set(0, -0.35, -0.22);
  panel.receiveShadow = true;
  plinkoGroup.add(panel);

  const edgeMat = makeMaterial("#bae6fd", { emissive: "#38bdf8", emissiveIntensity: 0.28, transparent: true, opacity: 0.8 });
  [-1, 1].forEach((side) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.34, cfg.height, 0.9), edgeMat.clone());
    wall.position.set(side * (cfg.width / 2 + 0.34), -0.25, 0.22);
    wall.castShadow = true;
    plinkoGroup.add(wall);
  });

  const header = createLabelSprite("LINH NGỌC PLINKO", "#facc15", 760, 124, 7.4, 1.1);
  header.position.set(0, cfg.topY + 0.9, 0.9);
  plinkoGroup.add(header);

  PLINKO_CONFIG.milestones.forEach((milestone) => {
    const y = cfg.topY - milestone.progress * (cfg.topY - cfg.slotY);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.width - 2.4, 0.035, 0.05),
      new THREE.MeshBasicMaterial({ color: "#fef08a", transparent: true, opacity: 0.32 })
    );
    line.position.set(0, y, 0.42);
    plinkoGroup.add(line);
    const label = createLabelSprite(`${milestone.label} +${milestone.score}`, "#fef08a", 620, 150, 7.2, 1.45);
    label.position.set(-cfg.width / 2 - 1.3, y + 0.62, 0.78);
    plinkoGroup.add(label);
  });

  for (let row = 0; row < cfg.pegRows; row++) {
    const count = row % 2 === 0 ? 10 : 11;
    const y = cfg.pegStartY - row * cfg.rowSpacing;
    for (let col = 0; col < count; col++) {
      const x = (col - (count - 1) / 2) * cfg.pegSpacing;
      const material = makeMaterial("#dffcf4", { emissive: "#22c55e", emissiveIntensity: 0.24, roughness: 0.36 });
      const pegMesh = new THREE.Mesh(new THREE.CylinderGeometry(cfg.pegRadius, cfg.pegRadius, 0.54, 18), material);
      pegMesh.rotation.x = Math.PI / 2;
      pegMesh.position.set(x, y, 0.28);
      pegMesh.castShadow = true;
      pegMesh.receiveShadow = true;
      plinkoGroup.add(pegMesh);
      plinkoPegs.push({ id: `${row}-${col}`, x, y, radius: cfg.pegRadius, pulse: 0, mesh: pegMesh });
    }
  }

  buildBumpers();

  const slotWidth = cfg.width / PLINKO_CONFIG.slots.length;
  PLINKO_CONFIG.slots.forEach((slotCfg, index) => {
    const x = -cfg.width / 2 + slotWidth * (index + 0.5);
    const slotGroup = new THREE.Group();
    slotGroup.position.set(x, cfg.bottomY + 1.4, 0.28);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(slotWidth - 0.1, 1.75, 0.75),
      makeMaterial(slotCfg.color, { emissive: slotCfg.color, emissiveIntensity: slotCfg.jackpot ? 0.54 : 0.26, roughness: 0.48 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    slotGroup.add(mesh);
    const label = createLabelSprite(
      slotCfg.label,
      slotCfg.color,
      slotCfg.jackpot ? 760 : 540,
      180,
      slotCfg.jackpot ? 4.75 : 3.55,
      1.16
    );
    label.position.set(0, 0.62, 0.62);
    slotGroup.add(label);
    plinkoGroup.add(slotGroup);
    plinkoSlots.push({ ...slotCfg, index, x, width: slotWidth, mesh, group: slotGroup, pulse: 0 });
  });
}

function buildBumpers() {
  const cfg = PLINKO_CONFIG.board;
  const specs = [
    [-13.5, 7.2, 4.1, -0.18],
    [13.5, 7.0, 4.1, 0.18],
    [-6.8, 2.2, 4.9, 0.24],
    [6.8, 1.7, 4.9, -0.24],
    [-12.2, -3.0, 4.6, 0.2],
    [12.2, -3.4, 4.6, -0.2],
    [0, -7.6, 5.5, 0]
  ];
  specs.forEach(([x, y, length, angle], index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.22, 0.58),
      makeMaterial("#f8fafc", { emissive: "#e0f2fe", emissiveIntensity: 0.46, roughness: 0.3 })
    );
    mesh.position.set(x, y, 0.55);
    mesh.rotation.z = angle;
    mesh.castShadow = true;
    plinkoGroup.add(mesh);
    plinkoBumpers.push({ id: index, x, y, length, angle, radius: PLINKO_CONFIG.traps.bumperRadius, pulse: 0, mesh });
  });
}

function createBallModel(ball) {
  const group = new THREE.Group();
  group.name = `plinko-ball-${ball.index}`;

  const bodyMat = makeMaterial(ball.color, { emissive: ball.color, emissiveIntensity: 0.62, roughness: 0.27, metalness: 0.16 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(PLINKO_CONFIG.board.ballRadius, 30, 18), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(PLINKO_CONFIG.board.ballRadius * 1.55, 24, 14),
    new THREE.MeshBasicMaterial({
      color: ball.color,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  group.add(glow);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(PLINKO_CONFIG.board.ballRadius * 0.96, 0.04, 8, 30),
    makeMaterial("#fff7cc", { emissive: "#facc15", emissiveIntensity: 0.36, roughness: 0.38 })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  group.add(createScoreSprite(ball));
  group.position.set(ball.x, ball.y, 0.74 + ball.index * 0.004);
  group.visible = Boolean(ball.active);
  plinkoGroup.add(group);
  ball.group = group;
  ball.body = body;
  ball.glow = glow;
}

function buildBalls(names) {
  const skins = plinkoLegacy?.MYTHICAL_BEAST_SKINS || [];
  const cfg = PLINKO_CONFIG.board;
  plinkoLandingSequence = 0;
  plinkoBalls = names.map((name, index) => {
    const skin = skins[index % Math.max(1, skins.length)] || {
      name: "Linh Ngọc",
      color: ["#38bdf8", "#facc15", "#22c55e", "#f472b6"][index % 4]
    };
    const ball = {
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
      pingUntil: 0,
      lastSpriteUpdateAt: 0,
      lastProgress: 0,
      lastCollisionKey: "",
      lastCollisionAt: 0,
      sameCollisionCount: 0,
      collisionCooldowns: Object.create(null),
      milestones: PLINKO_CONFIG.milestones.map(() => ({ armed: true })),
      stageTarget: null
    };
    createBallModel(ball);
    return ball;
  });
  plinkoQueue = [...plinkoBalls];
  plinkoActiveBall = null;
  plinkoCurrentBallIndex = 0;
  plinkoBallStartedAt = 0;
  plinkoNextBallAt = 0;
  plinkoLandingSequence = 0;
}

function resetBallRunState(ball) {
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
  if (ball.group) {
    ball.group.visible = true;
    ball.group.position.set(ball.x, ball.y, 0.74 + ball.index * 0.004);
    ball.group.scale.setScalar(1);
  }
  updateScoreSprite(ball);
}

function startNextQueuedBall(now) {
  if (plinkoStageMode || plinkoFinishTriggered || now >= plinkoRoundEndAt) return false;
  const ball = plinkoQueue.shift();
  if (!ball) return false;
  resetBallRunState(ball);
  ball.startedAt = now;
  plinkoActiveBall = ball;
  plinkoCurrentBallIndex = ball.index + 1;
  plinkoBallStartedAt = now;
  plinkoNextBallAt = now + PLINKO_CONFIG.round.dropStaggerMs;
  plinkoFocusBall = ball;
  ball.pingUntil = now + 1400;
  plinkoLegacy?.updateCommentaryText?.(`🔮 Thả ${ball.name} (${ball.index + 1}/${plinkoBalls.length}) từ vị trí ngẫu nhiên.`);
  syncPlinkoLeaderboard(true);
  return true;
}

function completeActiveBall(now, hide = true) {
  const ball = plinkoActiveBall;
  if (!ball) return;
  completeBall(ball, now, hide);
  if (plinkoActiveBall === ball) plinkoActiveBall = null;
}

function completeBall(ball, now, hide = true) {
  if (!ball) return;
  syncBallScore(ball, now);
  ball.active = false;
  ball.completed = true;
  ball.finished = true;
  ball.vx = 0;
  ball.vy = 0;
  ball.holdUntil = 0;
  ball.holdTarget = null;
  updateScoreSprite(ball);
  if (hide) ball.visibleOnBoard = false;
  if (hide && ball.group) ball.group.visible = false;
  if (plinkoActiveBall === ball) plinkoActiveBall = null;
}

function markActiveBallDone(ball, now) {
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
  createParticleBurst(ball.x, ball.y, "#bfdbfe", 5);
  return true;
}

function getBoardProgress(ball) {
  const cfg = PLINKO_CONFIG.board;
  return clamp((cfg.topY - ball.y) / Math.max(1, cfg.topY - cfg.slotY), 0, 1);
}

function getSortedPlinkoBalls() {
  return [...plinkoBalls].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const progressDiff = getBoardProgress(b) - getBoardProgress(a);
    if (Math.abs(progressDiff) > 0.001) return progressDiff;
    return a.index - b.index;
  });
}

function getLivePlinkoLeaderboardOrder() {
  if (plinkoStageMode) return getSortedPlinkoBalls();
  return [...plinkoBalls].sort((a, b) => {
    const aLanded = a.landedOrder > 0;
    const bLanded = b.landedOrder > 0;
    if (aLanded && bLanded) return b.landedOrder - a.landedOrder;
    if (aLanded !== bLanded) return aLanded ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.index - b.index;
  });
}

function setSharedLeaderboardProgress(ball, progress) {
  ball.rawZ = TRACK_LENGTH_FOR_SHARED_LEADERBOARD
    - clamp(progress, 0, 1) * (TRACK_LENGTH_FOR_SHARED_LEADERBOARD - FINISH_Z_FOR_SHARED_LEADERBOARD);
}

function syncBallScore(ball, now) {
  if (ball.active && !ball.landed && !plinkoStageMode) {
    ball.timePenalty = Math.floor(((now - ball.startedAt) / 1000) * PLINKO_CONFIG.scoring.timePenaltyPerSecond);
  }
  ball.score = Math.max(0, Math.round(ball.grossScore - ball.timePenalty));
  ball.scoreLabel = `${ball.score}đ`;
}

function addScore(ball, amount, reason, now, color = "#facc15") {
  ball.grossScore = Math.max(0, ball.grossScore + amount);
  syncBallScore(ball, now);
  ball.boostTimer = amount > 0 ? 45 : ball.boostTimer;
  createParticleBurst(ball.x, ball.y, color, amount > 500 ? 10 : 5);
  if (reason && amount >= 500) plinkoLegacy?.updateCommentaryText?.(`✨ ${ball.name}: ${reason} (${amount > 0 ? "+" : ""}${amount})`);
  updateScoreSprite(ball);
}

function applyPenalty(ball, amount, reason, now) {
  if (ball.shieldCharges > 0 && ball.shieldUntil > now) {
    ball.shieldCharges = 0;
    ball.shieldUntil = 0;
    createParticleBurst(ball.x, ball.y, "#bbf7d0", 9);
    plinkoLegacy?.updateCommentaryText?.(`🛡️ Linh Thuẫn của ${ball.name} chặn ${reason}.`);
    updateScoreSprite(ball);
    return false;
  }
  addScore(ball, -Math.abs(amount), reason, now, "#fb7185");
  ball.slowTimer = 55;
  return true;
}

function syncPlinkoLeaderboard(force = false) {
  const now = performance.now();
  if (!force && now - plinkoLeaderboardSyncAt < 140) return getLivePlinkoLeaderboardOrder();
  plinkoLeaderboardSyncAt = now;
  plinkoBalls.forEach((ball) => syncBallScore(ball, now));
  const scoreSorted = getSortedPlinkoBalls();
  scoreSorted.forEach((ball, index) => {
    ball.rank = index + 1;
  });
  const displayOrder = plinkoStageMode ? scoreSorted : getLivePlinkoLeaderboardOrder();
  displayOrder.forEach((ball, index) => {
    ball.finished = plinkoStageMode || ball.completed;
    ball.displayRankLabel = plinkoStageMode ? `Top ${ball.rank}` : (ball.landedOrder ? `#${ball.landedOrder}` : "...");
    const classes = [plinkoStageMode ? "plinko-final-item" : "plinko-live-item"];
    if (!plinkoStageMode && ball.leaderboardFlyUntil > now) classes.push("plinko-leaderboard-flyin");
    ball.leaderboardClass = classes.join(" ");
    setSharedLeaderboardProgress(ball, clamp(ball.score / Math.max(1, PLINKO_CONFIG.scoring.glowMaxScore), 0, 1));
  });
  plinkoLegacy?.updateLeaderboardUI?.(displayOrder);
  const title = document.getElementById("racer-progress-title");
  if (title) {
    const remaining = Math.max(0, Math.ceil(((plinkoRoundEndAt || plinkoStartMs + plinkoDurationMs) - now) / 1000));
    const current = Math.min(plinkoBalls.length, Math.max(plinkoCurrentBallIndex, plinkoBalls.length - plinkoQueue.length));
    title.textContent = plinkoStageMode ? `Top ${plinkoPrizeCount} nhận giải` : `Còn ${remaining}s • Bi ${current}/${plinkoBalls.length}`;
  }
  wireLeaderboardTracking(displayOrder);
  return displayOrder;
}

function wireLeaderboardTracking(sorted) {
  const list = document.getElementById("leaderboard-list");
  if (!list) return;
  [...list.children].forEach((item, index) => {
    const ball = sorted[index];
    if (!ball) return;
    item.onmouseenter = () => pingBall(ball);
    item.onclick = () => pingBall(ball, 2600);
  });
}

function pingBall(ball, duration = 1600) {
  const now = performance.now();
  ball.pingUntil = now + duration;
  plinkoFocusBall = ball;
  updateScoreSprite(ball);
}

function getMaxCollectibles() {
  return isMobileLayout() ? PLINKO_CONFIG.collectibles.maxMobile : PLINKO_CONFIG.collectibles.maxDesktop;
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

function createCollectible(type, now) {
  if (!plinkoScene) return;
  const cfg = PLINKO_CONFIG.board;
  const meta = COLLECTIBLE_TYPES[type] || COLLECTIBLE_TYPES.coin;
  const group = new THREE.Group();
  const radius = PLINKO_CONFIG.collectibles.radius * (type === "coin" ? 0.82 : 1);
  const body = new THREE.Mesh(
    type.includes("star") ? new THREE.OctahedronGeometry(radius, 0) : new THREE.SphereGeometry(radius, 14, 10),
    makeMaterial(meta.color, { emissive: meta.emissive, emissiveIntensity: 0.8, roughness: 0.32, metalness: 0.18 })
  );
  group.add(body);
  const label = createLabelSprite(meta.icon, meta.color, 180, 140, 0.7, 0.55);
  label.position.set(0, radius + 0.28, 0.05);
  group.add(label);
  const x = randomBetween(-cfg.width * 0.42, cfg.width * 0.42);
  const y = randomBetween(cfg.slotY + 2.2, cfg.topY - 1.8);
  group.position.set(x, y, 0.8);
  plinkoScene.add(group);
  plinkoCollectibles.push({ type, x, y, radius, group, bornAt: now, expiresAt: now + PLINKO_CONFIG.collectibles.lifetimeMs, taken: false, spin: randomBetween(-0.04, 0.04) });
}

function spawnCollectibles(now) {
  const max = getMaxCollectibles();
  plinkoCollectibles = plinkoCollectibles.filter((item) => {
    if (!item.taken && now < item.expiresAt) return true;
    plinkoScene?.remove(item.group);
    disposeObject(item.group);
    return false;
  });
  if (!plinkoBalls.some((ball) => ball.active && !ball.completed) || plinkoCollectibles.length >= max || now < plinkoNextCollectibleAt) return;
  createCollectible(weightedCollectibleType(), now);
  plinkoNextCollectibleAt = now + randomBetween(PLINKO_CONFIG.collectibles.spawnMinMs, PLINKO_CONFIG.collectibles.spawnMaxMs);
}

function createBlackHole(now) {
  if (!plinkoScene) return;
  const cfg = PLINKO_CONFIG.board;
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(PLINKO_CONFIG.traps.blackHoleRadius * 0.62, 0.08, 10, 40),
    new THREE.MeshBasicMaterial({ color: "#a855f7", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(PLINKO_CONFIG.traps.blackHoleRadius * 0.34, 20, 14),
    new THREE.MeshBasicMaterial({ color: "#020617", transparent: true, opacity: 0.95 })
  );
  group.add(ring, core);
  const x = randomBetween(-cfg.width * 0.36, cfg.width * 0.36);
  const y = randomBetween(cfg.slotY + 4, cfg.topY - 5);
  group.position.set(x, y, 0.95);
  plinkoScene.add(group);
  plinkoBlackHoles.push({
    x,
    y,
    radius: PLINKO_CONFIG.traps.blackHoleRadius,
    group,
    bornAt: now,
    expiresAt: now + PLINKO_CONFIG.traps.blackHoleLifetimeMs
  });
}

function spawnBlackHoles(now) {
  const max = isMobileLayout() ? PLINKO_CONFIG.traps.blackHoleMaxMobile : PLINKO_CONFIG.traps.blackHoleMaxDesktop;
  plinkoBlackHoles = plinkoBlackHoles.filter((hole) => {
    if (now < hole.expiresAt) return true;
    plinkoScene?.remove(hole.group);
    disposeObject(hole.group);
    return false;
  });
  if (!plinkoBalls.some((ball) => ball.active && !ball.completed) || plinkoBlackHoles.length >= max || now < plinkoNextBlackHoleAt) return;
  createBlackHole(now);
  plinkoNextBlackHoleAt = now + randomBetween(PLINKO_CONFIG.traps.blackHoleSpawnMinMs, PLINKO_CONFIG.traps.blackHoleSpawnMaxMs);
}

function createParticleBurst(x, y, color, count = 8) {
  if (!plinkoScene) return;
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(randomBetween(0.04, 0.1), 8, 6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    mesh.position.set(x, y, randomBetween(0.8, 1.4));
    plinkoScene.add(mesh);
    plinkoParticles.push({
      mesh,
      vx: randomBetween(-0.05, 0.05),
      vy: randomBetween(0.015, 0.1),
      vz: randomBetween(-0.012, 0.024),
      life: randomBetween(24, 42),
      maxLife: 42
    });
  }
}

function createFloatingScoreText(text, x, y, color) {
  if (!plinkoScene) return;
  const sprite = createLabelSprite(text, color, 620, 150, 4.2, 1.05);
  sprite.position.set(x, y + 1.55, 1.25);
  plinkoScene.add(sprite);
  plinkoParticles.push({
    mesh: sprite,
    vx: 0,
    vy: 0.12,
    vz: 0.01,
    life: 58,
    maxLife: 58,
    floatText: true
  });
}

function triggerLeaderboardFlyIn(ball, now) {
  ball.leaderboardFlyUntil = now + 1600;
  syncPlinkoLeaderboard(true);
  const container = document.getElementById("webgl-container");
  const list = document.getElementById("leaderboard-list");
  if (!container || !list || !plinkoCamera || !ball.group) return;
  const source = ball.group.position.clone().project(plinkoCamera);
  const canvasRect = container.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const startX = canvasRect.left + ((source.x + 1) / 2) * canvasRect.width;
  const startY = canvasRect.top + ((-source.y + 1) / 2) * canvasRect.height;
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

function updateParticles(dt) {
  for (let i = plinkoParticles.length - 1; i >= 0; i--) {
    const particle = plinkoParticles[i];
    particle.mesh.position.x += particle.vx * dt;
    particle.mesh.position.y += particle.vy * dt;
    particle.mesh.position.z += particle.vz * dt;
    particle.vy -= 0.002 * dt;
    particle.life -= dt;
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    if (particle.mesh.material) particle.mesh.material.opacity = alpha * 0.88;
    particle.mesh.scale.setScalar(0.65 + alpha * 0.7);
    if (particle.life <= 0) {
      plinkoScene.remove(particle.mesh);
      disposeObject(particle.mesh);
      plinkoParticles.splice(i, 1);
    }
  }
}

function applyCollectible(ball, item, now) {
  if (item.taken) return;
  item.taken = true;
  const points = PLINKO_CONFIG.collectibles.points[item.type] || 0;
  if (points) {
    addScore(ball, points, COLLECTIBLE_TYPES[item.type]?.label || "nhặt thưởng", now, COLLECTIBLE_TYPES[item.type]?.color || "#facc15");
    plinkoLegacy?.playTickSound?.(500 + points * 0.25, 0.045);
  } else if (item.type === "tiny") {
    ball.scaleMode = "tiny";
    ball.scaleUntil = now + PLINKO_CONFIG.buffs.tinyMs;
    plinkoLegacy?.updateCommentaryText?.(`💠 ${ball.name} hóa Tí Hon, dễ lọt khe hơn!`);
  } else if (item.type === "magnet") {
    ball.magnetUntil = now + PLINKO_CONFIG.buffs.magnetMs;
    plinkoLegacy?.updateCommentaryText?.(`🧲 ${ball.name} bật Nam Châm hút đồng xu và sao.`);
  } else if (item.type === "shield") {
    ball.shieldUntil = now + PLINKO_CONFIG.buffs.shieldMs;
    ball.shieldCharges = 1;
    plinkoLegacy?.updateCommentaryText?.(`🛡️ ${ball.name} có Linh Thuẫn chặn một tai họa.`);
  } else if (item.type === "grow") {
    if (applyPenalty(ball, 0, "Phình To", now)) {
      ball.scaleMode = "grow";
      ball.scaleUntil = now + PLINKO_CONFIG.buffs.growMs;
      plinkoLegacy?.updateCommentaryText?.(`🔴 ${ball.name} bị Phình To, dễ kẹt hơn.`);
    }
  } else if (item.type === "sticky") {
    if (applyPenalty(ball, 0, "Dính Kẹt", now)) {
      ball.holdUntil = now + PLINKO_CONFIG.buffs.stickyMs;
      ball.holdTarget = { x: ball.x, y: ball.y };
      ball.slowTimer = 70;
      plinkoLegacy?.updateCommentaryText?.(`🟣 ${ball.name} bị Dính Kẹt 0.7 giây.`);
    }
  } else if (item.type === "kick") {
    if (applyPenalty(ball, PLINKO_CONFIG.scoring.kickPenalty, "Đá Bay", now)) {
      ball.vy = PLINKO_CONFIG.physics.kickVelocityY;
      ball.vx += randomBetween(-PLINKO_CONFIG.physics.kickVelocityX, PLINKO_CONFIG.physics.kickVelocityX);
      plinkoLegacy?.updateCommentaryText?.(`🧨 ${ball.name} bị đá bay lên trời, có thể ăn lại mốc khi rơi xuống.`);
    }
  }
  createParticleBurst(item.x, item.y, COLLECTIBLE_TYPES[item.type]?.color || "#facc15", 8);
  plinkoScene?.remove(item.group);
  disposeObject(item.group);
  updateScoreSprite(ball);
}

function updateCollectibles(dt, now) {
  plinkoCollectibles.forEach((item) => {
    item.group.rotation.y += (0.035 + item.spin) * dt;
    item.group.position.y = item.y + Math.sin(now * 0.004 + item.x) * 0.08;
  });
  plinkoBalls.filter((ball) => ball.active && !ball.completed).forEach((ball) => {
    const radius = getBallRadius(ball, now);
    plinkoCollectibles.forEach((item) => {
      if (item.taken) return;
      if (ball.magnetUntil > now && PLINKO_CONFIG.collectibles.points[item.type]) {
        const mdx = ball.x - item.x;
        const mdy = ball.y - item.y;
        const md = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
        if (md < PLINKO_CONFIG.collectibles.magnetRadius) {
          item.x += (mdx / md) * 0.12 * dt;
          item.y += (mdy / md) * 0.12 * dt;
          item.group.position.x = item.x;
        }
      }
      const dx = ball.x - item.x;
      const dy = ball.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < radius + item.radius) applyCollectible(ball, item, now);
    });
  });
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
  return {
    x: bumper.x + clampedX * cos,
    y: bumper.y + clampedX * sin
  };
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
  createParticleBurst(point.x, point.y, "#f8fafc", 4);
  return true;
}

function handleBlackHole(ball, now) {
  if (now < ball.blackHoleCooldownUntil || ball.holdUntil > now) return false;
  const hole = plinkoBlackHoles.find((item) => {
    const dx = ball.x - item.x;
    const dy = ball.y - item.y;
    return Math.sqrt(dx * dx + dy * dy) < item.radius + getBallRadius(ball, now);
  });
  if (!hole) return false;
  ball.holdUntil = now + randomBetween(PLINKO_CONFIG.traps.blackHoleHoldMinMs, PLINKO_CONFIG.traps.blackHoleHoldMaxMs);
  ball.blackHoleCooldownUntil = now + PLINKO_CONFIG.traps.blackHoleCooldownMs;
  ball.holdTarget = { x: hole.x, y: hole.y };
  ball.vx *= 0.1;
  ball.vy *= 0.1;
  createParticleBurst(hole.x, hole.y, "#a855f7", 10);
  plinkoLegacy?.updateCommentaryText?.(`🕳️ Hố đen giữ ${ball.name} lại một nhịp.`);
  return true;
}

function getSlotIndexForX(x) {
  const cfg = PLINKO_CONFIG.board;
  const slotWidth = cfg.width / PLINKO_CONFIG.slots.length;
  return clamp(Math.floor((x + cfg.width / 2) / slotWidth), 0, PLINKO_CONFIG.slots.length - 1);
}

function landBall(ball, now) {
  if (ball.landed) return;
  const slotIndex = getSlotIndexForX(ball.x);
  const slot = plinkoSlots[slotIndex];
  ball.grossScore += slot.score;
  ball.landed = true;
  ball.slotIndex = slotIndex;
  ball.landedOrder = ++plinkoLandingSequence;
  ball.leaderboardFlyUntil = now + 1600;
  ball.x = lerp(ball.x, slot.x, 0.78);
  ball.y = PLINKO_CONFIG.board.slotY;
  ball.vx = 0;
  ball.vy = 0;
  slot.pulse = slot.jackpot ? 2.8 : 2.1;
  syncBallScore(ball, now);
  updateScoreSprite(ball);
  createParticleBurst(slot.x, PLINKO_CONFIG.board.slotY + 0.55, slot.color, slot.jackpot ? 34 : 20);
  createFloatingScoreText(`+${slot.score}`, slot.x, PLINKO_CONFIG.board.slotY + 0.7, slot.color);
  triggerLeaderboardFlyIn(ball, now);
  if (slot.jackpot) {
    plinkoLegacy?.playBoostSound?.();
    plinkoLegacy?.updateCommentaryText?.(`🏆 ${ball.name} rơi vào JACKPOT: +${slot.score} điểm!`);
  } else {
    plinkoLegacy?.playTickSound?.(420 + slot.score * 0.04, 0.05);
  }
  markActiveBallDone(ball, now);
}

function checkMilestones(ball, now) {
  const progress = getBoardProgress(ball);
  PLINKO_CONFIG.milestones.forEach((milestone, index) => {
    const state = ball.milestones[index];
    if (state.armed && ball.lastProgress < milestone.progress && progress >= milestone.progress) {
      state.armed = false;
      addScore(ball, milestone.score, `qua mốc ${milestone.label}`, now, "#fef08a");
      plinkoLegacy?.playBoostSound?.();
    }
    if (!state.armed && progress < milestone.progress - 0.055) state.armed = true;
  });
  ball.lastProgress = progress;
}

function handleOutOfBounds(ball, now) {
  const cfg = PLINKO_CONFIG.board;
  const outX = cfg.width / 2 + cfg.outPadding;
  const outTop = cfg.topY + 5;
  if (Math.abs(ball.x) <= outX && ball.y <= outTop) return false;
  if (now < ball.outCooldownUntil) return false;
  ball.outCooldownUntil = now + 1800;
  applyPenalty(ball, PLINKO_CONFIG.scoring.outPenalty, "rớt ra ngoài", now);
  const side = ball.x < 0 ? -1 : 1;
  ball.x = side * (cfg.width * 0.42);
  ball.y = clamp(ball.y, cfg.slotY + 6, cfg.topY - 1.8);
  ball.vx = -side * randomBetween(0.18, 0.28);
  ball.vy = randomBetween(-0.12, -0.04);
  createParticleBurst(ball.x, ball.y, "#38bdf8", 12);
  return true;
}

function updateBallPhysics(ball, dt, now) {
  if (!ball || !ball.active || ball.completed || ball.landed || plinkoStageMode) return;

  if (ball.holdUntil && now < ball.holdUntil) {
    const target = ball.holdTarget || { x: ball.x, y: ball.y };
    ball.x = lerp(ball.x, target.x, 0.14);
    ball.y = lerp(ball.y, target.y, 0.14);
    if (ball.group) ball.group.rotation.z += 0.035 * dt;
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

  const innerMin = -cfg.width / 2 + cfg.wallPadding;
  const innerMax = cfg.width / 2 - cfg.wallPadding;
  if (ball.x < innerMin) ball.vx += 0.018 * dt;
  if (ball.x > innerMax) ball.vx -= 0.018 * dt;

  for (const peg of plinkoPegs) {
    if (Math.abs(ball.y - peg.y) > 1.2 || Math.abs(ball.x - peg.x) > 1.2) continue;
    if (handlePegCollision(ball, peg, dt, now)) break;
  }
  for (const bumper of plinkoBumpers) {
    if (Math.abs(ball.y - bumper.y) > 1.35 || Math.abs(ball.x - bumper.x) > bumper.length / 2 + 1.55) continue;
    if (handleBumperCollision(ball, bumper, dt, now)) break;
  }

  handleBlackHole(ball, now);
  handleOutOfBounds(ball, now);
  checkMilestones(ball, now);

  if (ball.y <= cfg.slotY) {
    landBall(ball, now);
    return;
  }

  syncBallScore(ball, now);
}

function updateBallVisuals(dt, now) {
  const sorted = getSortedPlinkoBalls();
  const topFive = new Set(sorted.slice(0, 5).map((ball) => ball.index));
  plinkoBalls.forEach((ball) => {
    if (ball.group && !plinkoStageMode && !ball.visibleOnBoard) {
      ball.group.visible = false;
    }
    const scale = getBallScale(ball, now);
    const pingScale = now < ball.pingUntil ? 1.26 : 1;
    if (ball.group) {
      const targetScale = plinkoStageMode
        ? ball.group.scale.x
        : scale * pingScale;
      if (!plinkoStageMode) ball.group.visible = ball.visibleOnBoard;
      ball.group.position.set(ball.x, ball.y, 0.74 + ball.index * 0.004);
      ball.group.rotation.z += ball.vx * 0.18 * dt;
      if (!plinkoStageMode) ball.group.scale.setScalar(lerp(ball.group.scale.x, targetScale, 0.16));
    }
    if (ball.body?.material) {
      const glowLevel = topFive.has(ball.index)
        ? Math.floor(clamp(ball.score, 0, PLINKO_CONFIG.scoring.glowMaxScore) / PLINKO_CONFIG.scoring.glowStep)
        : 0;
      ball.body.material.emissiveIntensity = 0.35 + glowLevel * 0.045 + (now < ball.pingUntil ? 0.5 : 0);
    }
    if (ball.glow?.material) {
      const glowLevel = topFive.has(ball.index)
        ? Math.floor(clamp(ball.score, 0, PLINKO_CONFIG.scoring.glowMaxScore) / PLINKO_CONFIG.scoring.glowStep)
        : 0;
      ball.glow.material.opacity = clamp(0.12 + glowLevel * 0.018 + (now < ball.pingUntil ? 0.22 : 0), 0.08, 0.58);
    }
    if (now - ball.lastSpriteUpdateAt > 260) {
      ball.lastSpriteUpdateAt = now;
      updateScoreSprite(ball);
    }
  });
}

function updateBoardPulses(dt, now) {
  plinkoPegs.forEach((peg) => {
    peg.pulse = Math.max(0, peg.pulse - 0.08 * dt);
    peg.mesh.scale.setScalar(1 + peg.pulse * 0.42);
  });
  plinkoBumpers.forEach((bumper) => {
    bumper.pulse = Math.max(0, bumper.pulse - 0.08 * dt);
    bumper.mesh.scale.y = 1 + bumper.pulse * 0.7;
  });
  plinkoSlots.forEach((slot) => {
    slot.pulse = Math.max(0, slot.pulse - 0.052 * dt);
    slot.group.scale.x = lerp(slot.group.scale.x, 1 + slot.pulse * 0.16, 0.14);
    slot.group.scale.y = lerp(slot.group.scale.y, 1 + slot.pulse * 0.28, 0.14);
  });
  plinkoBlackHoles.forEach((hole) => {
    hole.group.rotation.z += 0.035 * dt;
    hole.group.scale.setScalar(1 + Math.sin(now * 0.005 + hole.x) * 0.05);
  });
}

function updatePlinkoCamera(now) {
  if (!plinkoCamera) return;
  if (plinkoStageMode) {
    const podiumWidth = plinkoPrizeCount >= 4 ? 23 : 20;
    const fovRad = (PLINKO_CONFIG.renderer.fov * Math.PI) / 180;
    const fitWidthZ = podiumWidth / (2 * Math.tan(fovRad / 2) * Math.max(plinkoCamera.aspect, 0.34));
    const targetZ = Math.max(plinkoBaseCameraZ, fitWidthZ + 8);
    plinkoCamera.position.x = lerp(plinkoCamera.position.x, 0, 0.065);
    plinkoCamera.position.y = lerp(plinkoCamera.position.y, -3.15, 0.065);
    plinkoCamera.position.z = lerp(plinkoCamera.position.z, targetZ, 0.065);
    plinkoCamera.lookAt(0, -3.35, 0.8);
    return;
  }
  const activeFocus = plinkoFocusBall && now < plinkoFocusBall.pingUntil + 900 ? plinkoFocusBall : null;
  const leader = getSortedPlinkoBalls()[0];
  const focus = activeFocus || plinkoActiveBall || leader;
  const targetX = activeFocus ? clamp(focus.x * 0.22, -4, 4) : 0;
  const targetY = activeFocus ? clamp(focus.y * 0.12, -2.8, 2.8) : PLINKO_CONFIG.renderer.cameraY;
  const targetZ = plinkoBaseCameraZ - (activeFocus ? 4.5 : 0);
  plinkoCamera.position.x = lerp(plinkoCamera.position.x, targetX, 0.04);
  plinkoCamera.position.y = lerp(plinkoCamera.position.y, targetY, 0.04);
  plinkoCamera.position.z = lerp(plinkoCamera.position.z, targetZ, 0.045);
  plinkoCamera.lookAt(targetX * 0.35, targetY * 0.35 - 0.45, 0);
}

function createPodiumLabel(lines, color, width = 4.8) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 270;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(2, 6, 23, 0.86)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  drawRoundedRect(ctx, 12, 14, 616, 236, 28);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff7cc";
  ctx.font = "900 38px Inter, sans-serif";
  ctx.fillText(lines[0], 320, 50);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "900 36px Inter, sans-serif";
  ctx.fillText(lines[1], 320, 106);
  ctx.fillStyle = "#fff7cc";
  ctx.font = "900 32px Inter, sans-serif";
  ctx.fillText(lines[2], 320, 154);
  ctx.fillStyle = "#bfdbfe";
  ctx.font = "800 22px Inter, sans-serif";
  ctx.fillText(lines[3] || "", 320, 204);
  return createCanvasSprite(canvas, width, width * 0.422).sprite;
}

function buildPodium(sorted) {
  if (plinkoPodiumGroup) {
    plinkoScene.remove(plinkoPodiumGroup);
    disposeObject(plinkoPodiumGroup);
  }
  plinkoPodiumGroup = new THREE.Group();
  plinkoScene.add(plinkoPodiumGroup);
  const positions = getPodiumPositions(plinkoPrizeCount);
  positions.forEach((pos) => {
    const ball = sorted[pos.rank - 1];
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(pos.width, pos.h, 2.2),
      makeMaterial(pos.color, { emissive: pos.color, emissiveIntensity: 0.22, roughness: 0.42 })
    );
    block.position.set(pos.x, pos.y - pos.h / 2 - 1.4, 1.2);
    block.castShadow = true;
    block.receiveShadow = true;
    plinkoPodiumGroup.add(block);
    const label = createPodiumLabel([
      `Hạng ${pos.rank}`,
      ball ? shortName(ball.name, 13) : "Đang chờ",
      ball ? `${ball.score} điểm` : "",
      getPrizeText(pos.rank)
    ], pos.color, pos.width);
    label.position.set(pos.x, pos.y - 0.24, 2.05);
    plinkoPodiumGroup.add(label);
    if (ball) {
      if (ball.group) ball.group.visible = true;
      ball.stageTarget = { x: pos.x, y: pos.y + pos.h + 1.18, z: 1.72, scale: pos.rank === 1 ? 1.72 : 1.48 };
      ball.pingUntil = performance.now() + 999999;
    }
  });
}

function updateStageAnimation(dt) {
  plinkoBalls.forEach((ball) => {
    if (!ball.stageTarget || !ball.group) {
      if (ball.group) ball.group.scale.setScalar(lerp(ball.group.scale.x, 0.55, 0.04));
      return;
    }
    ball.group.position.x = lerp(ball.group.position.x, ball.stageTarget.x, 0.035 * dt);
    ball.group.position.y = lerp(ball.group.position.y, ball.stageTarget.y, 0.035 * dt);
    ball.group.position.z = lerp(ball.group.position.z, ball.stageTarget.z, 0.035 * dt);
    ball.x = ball.group.position.x;
    ball.y = ball.group.position.y;
    ball.group.scale.setScalar(lerp(ball.group.scale.x, ball.stageTarget.scale, 0.035 * dt));
    ball.group.rotation.y += 0.018 * dt;
  });
}

function finishPlinkoGame(now = performance.now(), reason = "time") {
  if (plinkoFinishTriggered) return;
  const finishNow = Math.min(now, plinkoRoundEndAt || now);
  plinkoFinishTriggered = true;
  plinkoStageMode = true;
  plinkoFocusBall = null;
  plinkoBalls.forEach((ball) => {
    syncBallScore(ball, finishNow);
    ball.active = false;
    ball.completed = true;
    ball.vx = 0;
    ball.vy = 0;
    ball.finished = true;
    ball.holdUntil = 0;
    ball.holdTarget = null;
    if (ball.group) ball.group.visible = false;
    ball.visibleOnBoard = false;
    updateScoreSprite(ball);
  });
  plinkoActiveBall = null;
  plinkoQueue = [];
  const sorted = syncPlinkoLeaderboard(true);
  buildPodium(sorted);
  plinkoLegacy?.stopRaceTimer?.(true);
  plinkoLegacy?.playVictorySound?.();
  plinkoLegacy?.showPostGameActions?.(sorted, { camera: false });
  plinkoLegacy?.updateCommentaryText?.(
    reason === "all-balls-complete"
      ? `🏆 Tất cả linh ngọc đã rơi xong! Top ${plinkoPrizeCount} đang bay lên bục nhận giải.`
      : `🏆 Hết giờ! Top ${plinkoPrizeCount} linh ngọc đang bay lên bục nhận giải.`
  );
}

function animatePlinko(now = performance.now()) {
  if (!plinkoRunning) return;
  const dt = clamp((now - (plinkoLastFrameMs || now)) / 16.67, 0.45, 2.25);
  plinkoLastFrameMs = now;
  plinkoLegacy?.updateRaceTimerDisplay?.();

  if (!plinkoStageMode && now >= plinkoRoundEndAt) finishPlinkoGame(now, "time");

  if (plinkoStageMode) {
    updateStageAnimation(dt);
  } else {
    while (plinkoQueue.length > 0 && now >= plinkoNextBallAt && now < plinkoRoundEndAt) {
      startNextQueuedBall(plinkoNextBallAt || now);
    }
    spawnCollectibles(now);
    spawnBlackHoles(now);
    plinkoBalls.forEach((ball) => {
      if (ball.active && !ball.completed) updateBallPhysics(ball, dt, now);
      if (ball.active && ball.completed && now >= ball.completedAt) completeBall(ball, now, true);
    });
    updateCollectibles(dt, now);
    const allBallsComplete = plinkoQueue.length === 0
      && plinkoBalls.length > 0
      && plinkoBalls.every((ball) => ball.completed && !ball.active);
    if (allBallsComplete) finishPlinkoGame(now, "all-balls-complete");
  }

  updateBallVisuals(dt, now);
  updateBoardPulses(dt, now);
  updateParticles(dt);
  updatePlinkoCamera(now);
  syncPlinkoLeaderboard(plinkoStageMode);
  plinkoRenderer?.render(plinkoScene, plinkoCamera);
  plinkoLoopId = requestAnimationFrame(animatePlinko);
}

function runPlinkoCountdown() {
  const overlay = document.getElementById("countdown-overlay");
  const number = document.getElementById("countdown-number");
  if (!overlay || !number) {
    plinkoStartMs = performance.now();
    plinkoLastFrameMs = plinkoStartMs;
    const dropWindowMs = Math.max(0, plinkoBalls.length - 1) * PLINKO_CONFIG.round.dropStaggerMs;
    plinkoRoundEndAt = plinkoStartMs + plinkoDurationMs + dropWindowMs;
    plinkoNextBallAt = plinkoStartMs;
    plinkoLoopId = requestAnimationFrame(animatePlinko);
    plinkoLegacy?.startRaceTimer?.(Math.ceil((plinkoRoundEndAt - plinkoStartMs) / 1000));
    startNextQueuedBall(plinkoStartMs);
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
  plinkoLegacy?.playTickSound?.(620, 0.05);
  plinkoCountdownTimer = setInterval(() => {
    sec -= 1;
    if (sec > 0) {
      showValue(sec);
      plinkoLegacy?.playTickSound?.(620 + sec * 80, 0.05);
      return;
    }
    clearInterval(plinkoCountdownTimer);
    plinkoCountdownTimer = null;
    showValue("THẢ!");
    plinkoLegacy?.playHornSound?.();
    setTimeout(() => {
      if (!plinkoRunning) return;
      number.classList.remove("show");
      overlay.style.display = "none";
      plinkoStartMs = performance.now();
      plinkoLastFrameMs = plinkoStartMs;
      const dropWindowMs = Math.max(0, plinkoBalls.length - 1) * PLINKO_CONFIG.round.dropStaggerMs;
      plinkoRoundEndAt = plinkoStartMs + plinkoDurationMs + dropWindowMs;
      plinkoNextBallAt = plinkoStartMs;
      plinkoNextCollectibleAt = plinkoStartMs + 450;
      plinkoNextBlackHoleAt = plinkoStartMs + 2400;
      plinkoLoopId = requestAnimationFrame(animatePlinko);
      plinkoLegacy?.startRaceTimer?.(Math.ceil((plinkoRoundEndAt - plinkoStartMs) / 1000));
      startNextQueuedBall(plinkoStartMs);
    }, 640);
  }, 900);
}

function initPlinkoScene(names) {
  const container = document.getElementById("webgl-container");
  const canvas = document.getElementById("webgl-canvas");
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  plinkoScene = new THREE.Scene();
  plinkoScene.background = new THREE.Color("#020817");
  plinkoScene.fog = new THREE.FogExp2("#020817", 0.0095);
  plinkoCamera = new THREE.PerspectiveCamera(PLINKO_CONFIG.renderer.fov, width / height, 0.1, 800);
  plinkoBaseCameraZ = getCameraZForAspect(width / height);
  plinkoCamera.position.set(0, PLINKO_CONFIG.renderer.cameraY, plinkoBaseCameraZ);

  plinkoRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  plinkoRenderer.setSize(width, height);
  plinkoRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  plinkoRenderer.shadowMap.enabled = true;
  plinkoRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.ACESFilmicToneMapping) plinkoRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  plinkoRenderer.toneMappingExposure = 1.25;
  if ("outputColorSpace" in plinkoRenderer && THREE.SRGBColorSpace) {
    plinkoRenderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ("outputEncoding" in plinkoRenderer && THREE.sRGBEncoding) {
    plinkoRenderer.outputEncoding = THREE.sRGBEncoding;
  }

  plinkoScene.add(new THREE.AmbientLight("#dbeafe", 0.48));
  const key = new THREE.DirectionalLight("#fff7cc", 1.18);
  key.position.set(12, 20, 24);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 110;
  key.shadow.camera.top = 34;
  key.shadow.camera.bottom = -34;
  key.shadow.camera.left = -34;
  key.shadow.camera.right = 34;
  plinkoScene.add(key);
  const cyan = new THREE.PointLight("#38bdf8", 1.05, 80);
  cyan.position.set(-12, 2, 17);
  plinkoScene.add(cyan);
  const gold = new THREE.PointLight("#facc15", 0.92, 78);
  gold.position.set(10, 10, 14);
  plinkoScene.add(gold);

  buildBoard();
  buildBalls(names);
  plinkoCamera.lookAt(0, -0.45, 0);
  plinkoResizeHandler = resizePlinkoScene;
  window.addEventListener("resize", plinkoResizeHandler);
  resizePlinkoScene();
  runPlinkoCountdown();
}

export async function startPlinko3DGame(context, names) {
  cleanupPlinko3DGame();
  cleanupPlinkoFallback2D();
  plinkoLegacy = context?.legacy || window.__minigamesLegacyApi || {};
  plinkoLegacy?.initAudioContext?.();
  plinkoLegacy?.cleanupWebGLScene?.();
  plinkoDurationMs = getDurationSeconds() * 1000;
  plinkoPrizeCount = getSelectedPrizeCount();
  plinkoFinishTriggered = false;
  plinkoStageMode = false;
  plinkoRunning = true;
  setupPlinkoDom(names);
  if (typeof window.mngMusicSetMode === "function") window.mngMusicSetMode("playing");
  try {
    await (plinkoLegacy.loadThreeJSDynamic ? plinkoLegacy.loadThreeJSDynamic() : Promise.resolve());
    if (!window.THREE) throw new Error("THREE is not available");
    initPlinkoScene(names);
  } catch (err) {
    console.warn("Lỗi tải Three.js Plinko, chuyển sang 2D dự phòng:", err);
    cleanupPlinko3DGame();
    startPlinkoFallback2D(context, names);
  }
}

export function cleanupPlinko3DGame() {
  plinkoRunning = false;
  if (plinkoLoopId) {
    cancelAnimationFrame(plinkoLoopId);
    plinkoLoopId = null;
  }
  if (plinkoCountdownTimer) {
    clearInterval(plinkoCountdownTimer);
    plinkoCountdownTimer = null;
  }
  if (plinkoResizeHandler) {
    window.removeEventListener("resize", plinkoResizeHandler);
    plinkoResizeHandler = null;
  }
  if (plinkoScene) {
    while (plinkoScene.children.length > 0) {
      const child = plinkoScene.children[0];
      plinkoScene.remove(child);
      disposeObject(child);
    }
  }
  if (plinkoRenderer) plinkoRenderer.dispose();
  document.getElementById("webgl-container")?.classList.remove("plinko-3d-active");
  const derbyLayer = document.getElementById("derby-camera-layer");
  if (derbyLayer) derbyLayer.style.display = "";

  plinkoScene = null;
  plinkoCamera = null;
  plinkoRenderer = null;
  plinkoGroup = null;
  plinkoLegacy = null;
  plinkoBalls = [];
  plinkoPegs = [];
  plinkoSlots = [];
  plinkoBumpers = [];
  plinkoBlackHoles = [];
  plinkoCollectibles = [];
  plinkoParticles = [];
  plinkoPodiumGroup = null;
  plinkoFocusBall = null;
  plinkoLeaderboardSyncAt = 0;
  plinkoQueue = [];
  plinkoActiveBall = null;
  plinkoCurrentBallIndex = 0;
  plinkoRoundEndAt = 0;
  plinkoBallStartedAt = 0;
  plinkoNextBallAt = 0;
  plinkoPrizeCount = 3;
}
