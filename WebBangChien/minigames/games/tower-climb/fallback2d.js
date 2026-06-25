let fallbackLoopId = null;
let fallbackRunning = false;
let fallbackRacers = [];
let fallbackStartMs = 0;
const DEFAULT_GAME_DURATION_SECONDS = 60;
let fallbackDurationSeconds = DEFAULT_GAME_DURATION_SECONDS;
let fallbackDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
let fallbackFinishedCount = 0;
let fallbackLegacy = null;
let fallbackParticles = [];
const FALLBACK_BASELINE_DURATION_SECONDS = 35;
const FALLBACK_BASE_STEP_COUNT = 30;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
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

function getDurationSeconds() {
  const value = parseInt(document.getElementById("race-duration-select")?.value || String(DEFAULT_GAME_DURATION_SECONDS), 10);
  return Number.isFinite(value) ? value : DEFAULT_GAME_DURATION_SECONDS;
}

function getFallbackStepCount() {
  const scale = Math.max(0.1, fallbackDurationSeconds / FALLBACK_BASELINE_DURATION_SECONDS);
  return Math.max(24, Math.round(FALLBACK_BASE_STEP_COUNT * scale));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomFallbackSteps(min, max = min) {
  return randomRange(Math.min(min, max), Math.max(min, max));
}

function stepsToFallbackEffectMs(racer, steps) {
  return Math.max(0, (racer?.plannedFinishMs || fallbackDurationMs) * (steps / Math.max(1, getFallbackStepCount())));
}

function getFallbackPlannedFinishMs() {
  const baselineMs = FALLBACK_BASELINE_DURATION_SECONDS * 1000;
  const finishEarlyMs = randomRange(1800, 5200);
  const scaledEarlyMs = Math.min(finishEarlyMs, fallbackDurationMs * 0.16, baselineMs * 0.15);
  return Math.max(fallbackDurationMs * 0.88, fallbackDurationMs - scaledEarlyMs);
}

function getFallbackProgress(racer, now) {
  const elapsed = now - fallbackStartMs;
  const adjusted = elapsed + (racer.timeBonusMs || 0) - (racer.timePenaltyMs || 0);
  return clamp(adjusted / Math.max(1, racer.plannedFinishMs), 0, 1);
}

function buildFallbackRacers(names) {
  fallbackRacers = names.map((name, index) => {
    const skins = fallbackLegacy?.MYTHICAL_BEAST_SKINS || [];
    const skin = skins[index % Math.max(1, skins.length)] || {
      name: "Linh Hồ",
      color: "#f97316",
      emoji: "🦊"
    };
    return {
      name,
      skinName: skin.name,
      color: skin.color,
      emoji: "🦊",
      plannedFinishMs: getFallbackPlannedFinishMs(),
      timePenaltyMs: 0,
      timeBonusMs: 0,
      boostTimer: 0,
      slowTimer: 0,
      finished: false,
      rank: null,
      progress: 0,
      visualProgress: 0,
      lastStepIndex: 0,
      landingPulse: 0,
      stridePhase: index * 0.5,
      lastTrailAt: 0,
      rawZ: 120
    };
  });
}

function triggerFallbackEvent(now) {
  if (Math.random() > 0.025) return;
  const active = fallbackRacers.filter((racer) => !racer.finished);
  if (!active.length) return;

  const racer = active[Math.floor(Math.random() * active.length)];
  const roll = Math.random();
  if (roll < 0.45) {
    racer.timeBonusMs += stepsToFallbackEffectMs(racer, randomFallbackSteps(3, 4));
    racer.boostTimer = 80;
    fallbackLegacy?.playBoostSound?.();
    fallbackLegacy?.updateCommentaryText?.(`💎 [${racer.name}] nhặt được linh ngọc và bứt tốc trên tháp!`);
  } else if (roll < 0.78) {
    racer.timePenaltyMs += stepsToFallbackEffectMs(racer, randomFallbackSteps(3, 4));
    racer.slowTimer = 80;
    fallbackLegacy?.playLightningSound?.();
    fallbackLegacy?.updateCommentaryText?.(`🪤 Bẫy sập làm [${racer.name}] hụt nhịp leo!`);
  } else {
    racer.timePenaltyMs += stepsToFallbackEffectMs(racer, randomFallbackSteps(2, 2.8));
    racer.slowTimer = 55;
    fallbackLegacy?.playTickSound?.(360, 0.05);
    fallbackLegacy?.updateCommentaryText?.(`💨 Gió mạnh đẩy [${racer.name}] lùi một nhịp!`);
  }
}

function getFallbackTowerMetrics(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  return {
    width,
    height,
    cx: width / 2,
    top: 54,
    bottom: height - 58,
    radius: Math.min(210, width * 0.34)
  };
}

function getFallbackStepPoint(metrics, stepIndex) {
  const stepCount = getFallbackStepCount();
  const t = clamp(stepIndex / stepCount, 0, 1);
  return {
    x: metrics.cx + Math.sin(t * Math.PI * 8.2) * metrics.radius,
    y: metrics.bottom - (metrics.bottom - metrics.top) * t,
    angle: Math.cos(t * Math.PI * 8.2) * 0.36
  };
}

function getFallbackRacerPoint(metrics, racer) {
  const stepCount = getFallbackStepCount();
  const visualStep = clamp(racer.visualProgress || 0, 0, 1) * stepCount;
  const baseStep = Math.min(stepCount, Math.floor(visualStep));
  const nextStep = Math.min(stepCount, baseStep + 1);
  const localT = baseStep >= stepCount ? 1 : visualStep - baseStep;
  const eased = smoothStep(localT);
  const from = getFallbackStepPoint(metrics, baseStep);
  const to = getFallbackStepPoint(metrics, nextStep);
  const hop = Math.sin(eased * Math.PI);
  return {
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased) - hop * (racer.boostTimer > 0 ? 26 : racer.slowTimer > 0 ? 13 : 20),
    angle: lerp(from.angle, to.angle, eased),
    hop,
    stepIndex: baseStep,
    localT
  };
}

function createFallbackDust(x, y, color, count = 5) {
  for (let i = 0; i < count; i++) {
    fallbackParticles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 2.4,
      vy: -0.7 - Math.random() * 1.4,
      life: 24 + Math.random() * 12,
      maxLife: 36,
      color,
      size: 2 + Math.random() * 3
    });
  }
}

function updateFallbackParticles(ctx) {
  for (let i = fallbackParticles.length - 1; i >= 0; i--) {
    const particle = fallbackParticles[i];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.07;
    particle.life -= 1;
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 8 * alpha;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.6 + alpha), 0, Math.PI * 2);
    ctx.fill();
    if (particle.life <= 0) fallbackParticles.splice(i, 1);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawFallbackTower(ctx, canvas) {
  const metrics = getFallbackTowerMetrics(canvas);
  const { width: w, height: h, cx, top, bottom, radius } = metrics;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#03120d");
  bg.addColorStop(0.54, "#061b12");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(251,191,36,0.08)";
  ctx.beginPath();
  ctx.arc(cx, top + 24, Math.min(190, w * 0.28), 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "rgba(251,191,36,0.55)");
  grad.addColorStop(1, "rgba(16,185,129,0.28)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, bottom);
  ctx.lineTo(cx, top);
  ctx.stroke();

  const stepCount = getFallbackStepCount();
  for (let i = 0; i <= stepCount; i++) {
    const point = getFallbackStepPoint(metrics, i);
    const isLantern = i % 5 === 0;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.fillStyle = isLantern ? "rgba(251,191,36,0.92)" : "rgba(20,184,166,0.82)";
    ctx.strokeStyle = isLantern ? "rgba(254,243,199,0.86)" : "rgba(167,243,208,0.58)";
    ctx.lineWidth = 2;
    ctx.shadowColor = isLantern ? "#fbbf24" : "#10b981";
    ctx.shadowBlur = isLantern ? 14 : 8;
    ctx.beginPath();
    drawRoundedRect(ctx, -42, -6, 84, 12, 8);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 28px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🏆", cx, top - 12);
}

function animateFallbackTower() {
  if (!fallbackRunning) return;

  const canvas = document.getElementById("fallback-canvas");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  const container = document.getElementById("webgl-container");
  canvas.width = Math.max(1, container?.clientWidth || canvas.clientWidth || 960);
  canvas.height = Math.max(1, container?.clientHeight || canvas.clientHeight || 540);

  const now = performance.now();
  drawFallbackTower(ctx, canvas);
  triggerFallbackEvent(now);
  const metrics = getFallbackTowerMetrics(canvas);

  fallbackRacers.forEach((racer, index) => {
    if (!racer.finished) {
      racer.progress = getFallbackProgress(racer, now);
      racer.rawZ = 120 - racer.progress * 110;
      if (racer.progress >= 1) {
        racer.finished = true;
        racer.rank = ++fallbackFinishedCount;
        racer.progress = 1;
        racer.visualProgress = 1;
        racer.rawZ = 10;
        fallbackLegacy?.playTickSound?.(780, 0.08);
      }
    }

    racer.boostTimer = Math.max(0, (racer.boostTimer || 0) - 1);
    racer.slowTimer = Math.max(0, (racer.slowTimer || 0) - 1);

    const targetProgress = Math.max(racer.progress || 0, racer.visualProgress || 0);
    racer.visualProgress = racer.finished
      ? 1
      : clamp((racer.visualProgress || 0) + (targetProgress - (racer.visualProgress || 0)) * 0.22, 0, 1);

    const point = getFallbackRacerPoint(metrics, racer);
    const stepIndex = Math.floor((racer.visualProgress || 0) * getFallbackStepCount());
    if (stepIndex > (racer.lastStepIndex || 0)) {
      racer.landingPulse = 1;
      createFallbackDust(point.x, point.y + 9, racer.boostTimer > 0 ? "#fbbf24" : racer.color, racer.boostTimer > 0 ? 8 : 5);
    }
    racer.lastStepIndex = Math.max(racer.lastStepIndex || 0, stepIndex);
    racer.landingPulse *= 0.82;
    racer.stridePhase = (racer.stridePhase || 0) + (racer.boostTimer > 0 ? 0.28 : racer.slowTimer > 0 ? 0.1 : 0.18);

    if (racer.boostTimer > 0 && now - (racer.lastTrailAt || 0) > 90) {
      createFallbackDust(point.x, point.y + 10, "#fbbf24", 3);
      racer.lastTrailAt = now;
    }

    const color = racer.boostTimer > 0 ? "#fbbf24" : racer.slowTimer > 0 ? "#60a5fa" : racer.color;
    const squashX = 1 + (racer.landingPulse || 0) * 0.18;
    const squashY = 1 + point.hop * 0.12 - (racer.landingPulse || 0) * 0.16;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle * 0.65 + Math.sin(racer.stridePhase) * 0.08);
    ctx.scale(squashX, squashY);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(0, 3, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.font = `${racer.boostTimer > 0 ? 18 : 16}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(racer.emoji || "🦊", 0, 7);
    if (index < 8) {
      ctx.font = "700 10px Inter, sans-serif";
      ctx.fillStyle = "rgba(255, 248, 214, 0.86)";
      ctx.fillText(String(racer.name || "").slice(0, 8), 0, -18);
    }
    ctx.restore();
  });

  updateFallbackParticles(ctx);

  const sorted = [...fallbackRacers].sort((a, b) => {
    if (a.finished && b.finished) return a.rank - b.rank;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
  fallbackLegacy?.updateLeaderboardUI?.(sorted);

  const allDone = fallbackRacers.every((racer) => racer.finished)
    || now - fallbackStartMs > fallbackDurationMs + 4500;

  if (allDone) {
    fallbackRacers.forEach((racer) => {
      if (!racer.finished) {
        racer.finished = true;
        racer.rank = ++fallbackFinishedCount;
        racer.progress = 1;
        racer.visualProgress = 1;
        racer.rawZ = 10;
      }
    });
    fallbackRunning = false;
    fallbackLegacy?.stopRaceTimer?.(true);
    fallbackLegacy?.playVictorySound?.();
    fallbackLegacy?.showPostGameActions?.([...fallbackRacers].sort((a, b) => a.rank - b.rank), { camera: false });
    fallbackLegacy?.displayVictoryResults?.([...fallbackRacers].sort((a, b) => a.rank - b.rank));
    return;
  }

  fallbackLoopId = requestAnimationFrame(animateFallbackTower);
}

export function startTowerClimbFallback2D(context, names) {
  cleanupTowerClimbFallback2D();
  fallbackLegacy = context?.legacy || window.__minigamesLegacyApi || {};
  fallbackDurationSeconds = getDurationSeconds();
  fallbackDurationMs = fallbackDurationSeconds * 1000;
  fallbackFinishedCount = 0;
  fallbackRunning = true;
  fallbackStartMs = performance.now();

  document.getElementById("lobby-view").style.display = "none";
  document.getElementById("arena-view").style.display = "flex";
  document.getElementById("webgl-canvas").style.display = "none";
  document.getElementById("fallback-canvas").style.display = "block";
  document.querySelector(".arena-logo").textContent = "Tháp";
  document.querySelector("#arena-sidebar .sidebar-title span").textContent = "Cao Thủ Leo Tháp";
  document.getElementById("racer-progress-title").textContent = `Hoàn thành: 0 / ${names.length}`;

  fallbackLegacy?.updateCommentaryText?.("Động cơ 3D lỗi, chuyển sang bản leo tháp 2D dự phòng.");
  buildFallbackRacers(names);
  fallbackLegacy?.startRaceTimer?.(fallbackDurationSeconds);
  animateFallbackTower();
}

export function cleanupTowerClimbFallback2D() {
  fallbackRunning = false;
  if (fallbackLoopId) {
    cancelAnimationFrame(fallbackLoopId);
    fallbackLoopId = null;
  }
  fallbackRacers = [];
  fallbackParticles = [];
  fallbackDurationSeconds = DEFAULT_GAME_DURATION_SECONDS;
  fallbackDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
  fallbackLegacy = null;
}
