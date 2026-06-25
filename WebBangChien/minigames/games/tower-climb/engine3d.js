import { TOWER_CONFIG } from "./config.js";
import { startTowerClimbFallback2D, cleanupTowerClimbFallback2D } from "./fallback2d.js";
import {
  createBeastWolfModel,
  getBeastSurfaceOffset,
  updateBeastIdlePose
} from "../../core/beast-model.js";

const TRACK_LENGTH_FOR_SHARED_LEADERBOARD = 120;
const FINISH_Z_FOR_SHARED_LEADERBOARD = 10;
const DEFAULT_GAME_DURATION_SECONDS = 60;

let towerScene = null;
let towerCamera = null;
let towerRenderer = null;
let towerLoopId = null;
let towerRunning = false;
let towerLegacy = null;
let towerRacers = [];
let towerPlatforms = [];
let towerParticles = [];
let towerPodiums = [];
let towerCinematicStarted = false;
let towerCinematicStartTime = 0;
let towerCinematicPhase = 0;
let towerCopyButtonShown = false;
let towerStartMs = 0;
let towerDurationSeconds = DEFAULT_GAME_DURATION_SECONDS;
let towerDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
let towerFinishedCount = 0;
let towerPrizeCount = 3;
let towerNextEventAt = 0;
let towerResizeHandler = null;
let towerCameraAngleOffset = Math.random() * Math.PI * 2;
let cinematicCameraFrom = null;

// Camera spring system
let cameraVelocity = { x: 0, y: 0, z: 0 };
let cameraLaggedTarget = { x: 0, y: 0, z: 0 };
let lastCameraUpdateTime = 0;
let currentFov = 60;
let targetFov = 60;
let lastPackY = 0;
let lastFocusY = 0;

// Post-processing
let towerComposer = null;

// Ambient dust system
let ambientDust = null;

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

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function easeOutCubic(value) {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutSine(value) {
  const t = clamp(value, 0, 1);
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function lerpAngle(current, target, amount) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

function getDurationSeconds() {
  const value = parseInt(document.getElementById("race-duration-select")?.value || String(DEFAULT_GAME_DURATION_SECONDS), 10);
  return Number.isFinite(value) ? value : DEFAULT_GAME_DURATION_SECONDS;
}

function getSelectedPrizeCount() {
  const value = parseInt(document.getElementById("prize-count-select")?.value || "3", 10);
  return clamp(Number.isFinite(value) ? value : 3, 1, 5);
}

function getBaselineDurationSeconds() {
  return Math.max(1, num(TOWER_CONFIG.baselineDurationSeconds, 35));
}

function getTowerDurationScale() {
  return Math.max(0.1, towerDurationSeconds / getBaselineDurationSeconds());
}

function getTowerTotalSteps() {
  const baselineSteps = Math.max(24, Math.round(TOWER_CONFIG.towerHeight / TOWER_CONFIG.stepHeight));
  return Math.max(24, Math.round(baselineSteps * getTowerDurationScale()));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomSteps(range, fallbackMin, fallbackMax = fallbackMin) {
  const min = num(range?.min, fallbackMin);
  const max = num(range?.max, fallbackMax);
  return randomRange(Math.min(min, max), Math.max(min, max));
}

function stepsToEffectMs(racer, steps) {
  return Math.max(0, (racer?.plannedFinishMs || towerDurationMs) * (steps / Math.max(1, getTowerTotalSteps())));
}

function getPlannedFinishMs() {
  const baselineMs = getBaselineDurationSeconds() * 1000;
  const finishEarlyMs = randomRange(1800, 5200);
  const scaledEarlyMs = Math.min(finishEarlyMs, towerDurationMs * 0.16, baselineMs * 0.15);
  return Math.max(towerDurationMs * 0.88, towerDurationMs - scaledEarlyMs);
}

function getRacerGroundOffset() {
  return num(TOWER_CONFIG.motion?.groundOffset, 0.62);
}

function getTowerApexSurfaceY() {
  return getTowerTotalSteps() * TOWER_CONFIG.stepHeight + 0.3 + 0.2;
}

function getRacerAwardSurfaceOffset(racer) {
  return getBeastSurfaceOffset(racer?.fox, 0.02);
}

function getPodiumSurfaceY(podium) {
  return podium.position.y + podium.userData.height / 2;
}

function getPodiumCameraFacingOffset(podium) {
  const fallback = { x: 1, z: 0 };
  const source = towerCamera?.position || fallback;
  const dx = source.x - podium.position.x;
  const dz = source.z - podium.position.z;
  const length = Math.hypot(dx, dz);
  const radius = num(podium.userData.radius, 1);
  const offset = radius * 0.52;

  if (length < 0.001) {
    return { x: fallback.x * offset, z: fallback.z * offset };
  }

  return {
    x: (dx / length) * offset,
    z: (dz / length) * offset
  };
}

function getPodiumAwardTarget(racer, podium) {
  const facingOffset = getPodiumCameraFacingOffset(podium);
  return {
    x: podium.position.x + facingOffset.x,
    y: getPodiumSurfaceY(podium) + getRacerAwardSurfaceOffset(racer) + 0.12,
    z: podium.position.z + facingOffset.z
  };
}

function getSafeOverflowSpot(racer) {
  const extraIndex = Math.max(0, (racer?.rank || towerPrizeCount + 1) - towerPrizeCount - 1);
  const ring = Math.floor(extraIndex / 12);
  const indexInRing = extraIndex % 12;
  const angleOffset = ring * 0.33;
  const angle = -Math.PI / 2 + angleOffset + indexInRing * ((Math.PI * 2) / 12);
  const safeRadius = Math.min(4.35, Math.max(2.2, TOWER_CONFIG.towerRadius - 3.8));
  const radius = ring % 2 === 0 ? safeRadius : safeRadius - 0.85;
  const clampedRadius = clamp(radius, 2.35, safeRadius);
  return {
    x: Math.cos(angle) * clampedRadius,
    y: getTowerApexSurfaceY() + getRacerAwardSurfaceOffset(racer),
    z: Math.sin(angle) * clampedRadius
  };
}

function getTowerAwardTarget(racer) {
  if (racer?.targetPodium) return getPodiumAwardTarget(racer, racer.targetPodium);
  if (racer?.overflowSpot) return racer.overflowSpot;
  return null;
}

function getYawToward(from, to) {
  if (!from || !to) return 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(dx, dz) + Math.PI;
}

function getTowerAwardFaceYaw(racer) {
  const source = racer?.group?.position;
  if (!source) return 0;
  if (towerCamera) return getYawToward(source, towerCamera.position);
  return getYawToward(source, { x: 8, y: source.y + 2, z: -8 });
}

function getHelixPosition(progress) {
  const totalSteps = getTowerTotalSteps();
  const currentStep = clamp(progress, 0, 1) * totalSteps;
  const angle = currentStep * ((Math.PI * 2) / TOWER_CONFIG.stepsPerRevolution);
  return {
    x: TOWER_CONFIG.towerRadius * Math.cos(angle),
    y: currentStep * TOWER_CONFIG.stepHeight,
    z: TOWER_CONFIG.towerRadius * Math.sin(angle),
    angle,
    step: currentStep
  };
}

function getTowerAirJumpPosition(activeAirJump, now, laneOffset = 0) {
  const t = clamp((now - activeAirJump.startTime) / Math.max(1, activeAirJump.duration), 0, 1);
  const eased = easeInOutSine(t);
  const from = getHelixPosition(activeAirJump.startProgress);
  const to = getHelixPosition(activeAirJump.endProgress);
  const x = lerp(from.x, to.x, eased);
  const z = lerp(from.z, to.z, eased);
  const radial = new THREE.Vector3(x, 0, z);
  if (radial.lengthSq() > 0.0001) radial.normalize();

  return {
    x: x + radial.x * laneOffset,
    y: lerp(from.y, to.y, eased)
      + getRacerGroundOffset()
      + Math.sin(t * Math.PI) * activeAirJump.height,
    z: z + radial.z * laneOffset,
    angle: lerp(from.angle, to.angle, eased),
    hop: Math.sin(t * Math.PI),
    from,
    to,
    t
  };
}

function getRacerProgress(racer, now) {
  const elapsed = now - towerStartMs;
  const adjusted = elapsed + (racer.timeBonusMs || 0) - (racer.timePenaltyMs || 0);
  return clamp(adjusted / Math.max(1, racer.plannedFinishMs), 0, 1);
}

function setSharedLeaderboardProgress(racer, progress) {
  racer.rawZ = TRACK_LENGTH_FOR_SHARED_LEADERBOARD
    - progress * (TRACK_LENGTH_FOR_SHARED_LEADERBOARD - FINISH_Z_FOR_SHARED_LEADERBOARD);
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

function setupTowerDom(names) {
  document.getElementById("lobby-view").style.display = "none";
  document.getElementById("arena-view").style.display = "flex";
  document.getElementById("webgl-canvas").style.display = "block";
  document.getElementById("fallback-canvas").style.display = "none";
  document.getElementById("derby-label-overlay").innerHTML = "";
  document.getElementById("derby-camera-layer").style.display = "none";
  document.getElementById("webgl-container").classList.add("tower-climb-active");
  document.querySelector(".arena-logo").textContent = "Tháp";
  document.querySelector("#arena-sidebar .sidebar-title span").textContent = "Cao Thủ Leo Tháp";
  document.getElementById("racer-progress-title").textContent = `Hoàn thành: 0 / ${names.length}`;
  towerLegacy?.updateCommentaryText?.("Đang triệu hồi tháp xoắn và các linh hồ leo tháp...");
}

function createNameSprite(text, color = "#fbbf24") {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 12, 368, 72, 18);
  ctx.fill();
  ctx.stroke();
  ctx.font = "bold 28px Inter, sans-serif";
  ctx.fillStyle = "#fff7cc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const safeText = String(text || "Linh Hồ").slice(0, 14);
  ctx.fillText(safeText, 192, 50);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.6, 1.2, 1);
  sprite.position.y = 1.4;
  return sprite;
}

function createTowerFoxModel(color) {
  return createBeastWolfModel(THREE, color, {
    name: "tower-wolf",
    scale: 0.78,
    groundClearance: 0.02
  });
}

function createSkyGradient() {
  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition).y;
      vec3 topColor = vec3(0.04, 0.0, 0.125);     // #0a0020
      vec3 midColor = vec3(0.1, 0.04, 0.24);      // #1a0a3e
      vec3 bottomColor = vec3(0.18, 0.1, 0.3);    // #2d1b4e

      vec3 color = mix(bottomColor, midColor, smoothstep(-0.5, 0.0, h));
      color = mix(color, topColor, smoothstep(0.0, 0.5, h));

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const skyGeo = new THREE.SphereGeometry(200, 32, 15);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.BackSide
  });

  const sky = new THREE.Mesh(skyGeo, skyMat);
  towerScene.add(sky);
  return sky;
}

function createStars() {
  const starCount = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const phases = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 150;

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)); // Chỉ hiện trên trời
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    sizes[i] = 0.4 + Math.random() * 0.6;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
  });

  const stars = new THREE.Points(geometry, material);
  stars.userData.isStars = true;
  towerScene.add(stars);
  return stars;
}

function createAmbientDust() {
  const dustCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(dustCount * 3);
  const velocities = [];

  const height = getTowerTotalSteps() * TOWER_CONFIG.stepHeight;

  for (let i = 0; i < dustCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 15;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * height;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    velocities.push(Math.random() * 0.01 + 0.005); // Upward velocity
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xaaffaa,
    size: 0.15,
    transparent: true,
    opacity: 0.3,
    sizeAttenuation: true
  });

  const dust = new THREE.Points(geometry, material);
  towerScene.add(dust);

  return { mesh: dust, velocities, height };
}

function createRankSprite(rank) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  }));
  sprite.scale.set(0.82, 0.82, 1);
  return sprite;
}

function createPodium(rank, x, y, z, color, height, radius) {
  const group = new THREE.Group();

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.15, height, 32),
    new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      metalness: rank === 1 ? 0.9 : rank === 2 ? 0.8 : 0.7,
      roughness: 0.2
    })
  );
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  group.add(cylinder);

  // Rank number sprite
  const label = createRankSprite(rank);
  label.position.set(0, Math.max(0.12, height * 0.12), radius + 0.08);
  group.add(label);

  group.position.set(x, y, z);
  group.userData.rank = rank;
  group.userData.occupied = false;
  group.userData.height = height;
  group.userData.radius = radius;
  towerScene.add(group);

  return group;
}

function getPodiumVisualOrder(count) {
  return {
    1: [1],
    2: [2, 1],
    3: [2, 1, 3],
    4: [4, 2, 1, 3],
    5: [4, 2, 1, 3, 5]
  }[count] || [4, 2, 1, 3, 5];
}

function buildPodiums() {
  const totalSteps = getTowerTotalSteps();
  const apexHeight = totalSteps * TOWER_CONFIG.stepHeight + 0.3;
  const podiums = [];
  const visualOrder = getPodiumVisualOrder(towerPrizeCount);
  const spacing = towerPrizeCount <= 3 ? 3.15 : 2.55;
  const rankStyles = {
    1: { color: 0xfbbf24, height: 1.8, radius: 1.2 },
    2: { color: 0xe2e8f0, height: 1.35, radius: 1.0 },
    3: { color: 0xfb923c, height: 1.05, radius: 0.95 },
    4: { color: 0x60a5fa, height: 0.82, radius: 0.86 },
    5: { color: 0xa78bfa, height: 0.68, radius: 0.82 }
  };

  visualOrder.forEach((rank, visualIndex) => {
    const style = rankStyles[rank];
    const x = (visualIndex - (visualOrder.length - 1) / 2) * spacing;
    const podium = createPodium(
      rank,
      x,
      apexHeight + 0.35 + style.height / 2,
      0,
      style.color,
      style.height,
      style.radius
    );
    podiums[rank - 1] = podium;
  });

  return podiums;
}

function createDrone(color) {
  const drone = new THREE.Group();

  // Body — octahedron
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3, 0),
    new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 })
  );
  drone.add(body);

  // 4 propellers
  const propellers = [];
  [-0.4, 0.4].forEach(x => {
    [-0.4, 0.4].forEach(z => {
      const prop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16),
        new THREE.MeshBasicMaterial({ color })
      );
      prop.position.set(x, 0, z);
      prop.rotation.x = Math.PI / 2;
      prop.userData.isPropeller = true;
      drone.add(prop);
      propellers.push(prop);
    });
  });

  drone.userData.propellers = propellers;
  return drone;
}

function attachDroneToRacer(racer) {
  const drone = createDrone(racer.color);
  drone.position.y = 1.2;
  racer.group.add(drone);
  racer.drone = drone;
}

function animateDronePropellers(drone, speed = 0.2) {
  if (!drone?.userData?.propellers) return;
  drone.userData.propellers.forEach(p => {
    p.rotation.z += speed;
  });
}

function updateRacerFly(racer, now) {
  if (!racer.flyState || racer.flyState === 'landed') return;

  const elapsed = now - racer.flyStartTime;

  if (racer.flyState === 'ascending') {
    const target = getTowerAwardTarget(racer);
    if (!target) return;

    const start = racer.flyStartPosition || racer.group.position;
    const duration = 1800;
    const t = clamp(elapsed / duration, 0, 1);
    const eased = easeInOutSine(t);
    const arc = Math.sin(t * Math.PI) * 2.35;

    racer.group.position.set(
      lerp(start.x, target.x, eased),
      lerp(start.y, target.y, eased) + arc,
      lerp(start.z, target.z, eased)
    );

    // Spin drone propellers fast
    animateDronePropellers(racer.drone, 0.3);

    if (t >= 0.98) {
      racer.group.position.set(target.x, target.y, target.z);
      racer.flyState = 'landing';
      racer.flyStartTime = now;
    }
  } else if (racer.flyState === 'landing') {
    const duration = 800;
    const t = clamp(elapsed / duration, 0, 1);
    const target = getTowerAwardTarget(racer);
    if (target) racer.group.position.set(target.x, target.y, target.z);

    animateDronePropellers(racer.drone, 0.2);

    if (t >= 0.98) {
      racer.flyState = 'landed';
      // Remove drone
      if (racer.drone) {
        racer.group.remove(racer.drone);
        racer.drone = null;
      }
      // Play confetti
      createParticleBurst(racer.group.position.clone(), racer.color, 40, 0.18);
    }
  }
}

function startTowerCinematic(now) {
  if (towerCinematicStarted) return;
  towerCinematicStarted = true;
  towerCinematicStartTime = now;
  towerCinematicPhase = 0;
  cinematicCameraFrom = towerCamera
    ? {
        x: towerCamera.position.x,
        y: towerCamera.position.y,
        z: towerCamera.position.z
      }
    : null;
  cameraVelocity = { x: 0, y: 0, z: 0 };
  if (towerCamera) {
    cameraLaggedTarget = {
      x: towerCamera.position.x,
      y: towerCamera.position.y,
      z: towerCamera.position.z
    };
  }
  lastCameraUpdateTime = 0;
  towerLegacy?.stopRaceTimer?.(true);
  towerLegacy?.playVictorySound?.();
  towerCopyButtonShown = true;
  showCopyButton();
}

function updateCinematicCamera(now) {
  if (!towerCinematicStarted || !towerCamera) return;

  const totalSteps = getTowerTotalSteps();
  const apexHeight = totalSteps * TOWER_CONFIG.stepHeight + 0.3;
  const elapsed = now - towerCinematicStartTime;

  if (elapsed < 3000) {
    // Phase 0: Pan to podiums
    towerCinematicPhase = 0;
    const t = easeOutCubic(elapsed / 3000);
    const targetX = 8;
    const targetY = apexHeight + 2.5;
    const targetZ = 0;
    const from = cinematicCameraFrom || { x: towerCamera.position.x, y: towerCamera.position.y, z: towerCamera.position.z };
    towerCamera.position.x = lerp(from.x, targetX, t);
    towerCamera.position.y = lerp(from.y, targetY, t);
    towerCamera.position.z = lerp(from.z, targetZ, t);
    towerCamera.lookAt(0, apexHeight + 1.5, 0);
  } else if (elapsed < 12000) {
    // Phase 1: Orbit
    towerCinematicPhase = 1;
    const orbitAngle = (elapsed - 3000) * 0.0002;
    const radius = 9;
    towerCamera.position.x = Math.cos(orbitAngle) * radius;
    towerCamera.position.y = apexHeight + 3;
    towerCamera.position.z = Math.sin(orbitAngle) * radius;
    towerCamera.lookAt(0, apexHeight + 1.5, 0);
  } else {
    // Phase 2: Idle
    towerCinematicPhase = 2;
    if (!towerCopyButtonShown) {
      towerCopyButtonShown = true;
      showCopyButton();
    }
  }
}

function showCopyButton() {
  const btn = document.getElementById('tower-cinematic-ui');
  if (btn) btn.style.display = 'none';
  towerLegacy?.showPostGameActions?.(getSortedTowerRacers(), { camera: false });
}

function createMistPool() {
  const geometry = new THREE.CylinderGeometry(18, 22, 0.8, 48);
  const material = new THREE.MeshBasicMaterial({
    color: '#88ffaa',
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mist = new THREE.Mesh(geometry, material);
  mist.position.y = 0.4;
  mist.userData.isMist = true;
  towerScene.add(mist);
  return mist;
}

function updateAmbientDust() {
  if (!ambientDust?.mesh) return;
  const positions = ambientDust.mesh.geometry.attributes.position.array;
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 1] += ambientDust.velocities[i];

    // Wrap around when reaching top
    if (positions[i * 3 + 1] > ambientDust.height) {
      positions[i * 3 + 1] = 0;
    }
  }
  ambientDust.mesh.geometry.attributes.position.needsUpdate = true;
}

function updateStarsTwinkle(now) {
  towerScene.children.forEach(child => {
    if (child.userData?.isStars && child.geometry?.attributes?.phase) {
      const phases = child.geometry.attributes.phase.array;
      const sizes = child.geometry.attributes.size.array;
      const positions = child.geometry.attributes.position;

      // Simple twinkle by rotating the whole star field slightly
      child.rotation.y = now * 0.00001;
    }
  });
}

function buildTowerStructure() {
  const totalSteps = getTowerTotalSteps();
  const height = totalSteps * TOWER_CONFIG.stepHeight;

  // Pillar — kim loại bóng ánh tím
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(TOWER_CONFIG.pillarRadius, TOWER_CONFIG.pillarRadius * 1.18, height + 6, 32),
    new THREE.MeshPhysicalMaterial({ color: "#2a2a3e", emissive: "#0a0a1e", emissiveIntensity: 0.15, roughness: 0.3, metalness: 0.7 })
  );
  pillar.position.y = height / 2;
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  towerScene.add(pillar);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(TOWER_CONFIG.towerRadius + 4.5, TOWER_CONFIG.towerRadius + 5.3, 0.55, 72),
    new THREE.MeshPhysicalMaterial({ color: "#1a1a2e", emissive: "#0a0a18", emissiveIntensity: 0.1, roughness: 0.5, metalness: 0.4 })
  );
  base.position.y = -0.32;
  base.receiveShadow = true;
  towerScene.add(base);

  const baseRing = new THREE.Mesh(
    new THREE.TorusGeometry(TOWER_CONFIG.towerRadius + 4.45, 0.08, 8, 96),
    new THREE.MeshBasicMaterial({ color: "#fbbf24", transparent: true, opacity: 0.6 })
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = 0.03;
  towerScene.add(baseRing);

  const platformGeo = new THREE.BoxGeometry(
    TOWER_CONFIG.platformWidth,
    TOWER_CONFIG.platformHeight,
    TOWER_CONFIG.platformDepth
  );
  for (let i = 0; i <= totalSteps; i++) {
    const progress = i / totalSteps;
    const pos = getHelixPosition(progress);
    const isLantern = i % TOWER_CONFIG.lanternInterval === 0;
    const hue = isLantern ? "#fbbf24" : "#10b981";
    const platform = new THREE.Mesh(
      platformGeo.clone(),
      new THREE.MeshStandardMaterial({
        color: hue,
        emissive: hue,
        emissiveIntensity: isLantern ? 0.25 : 0.08,
        roughness: 0.5,
        metalness: 0.15
      })
    );
    platform.position.set(pos.x, pos.y, pos.z);
    platform.rotation.y = -pos.angle;
    platform.castShadow = true;
    platform.receiveShadow = true;
    platform.userData.baseColor = hue;
    platform.userData.baseEmissiveIntensity = isLantern ? 0.25 : 0.08;
    platform.userData.pulse = 0;
    platform.userData.stepIndex = i;
    towerPlatforms.push(platform);
    towerScene.add(platform);

    if (isLantern && i > 0) {
      const lantern = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 12),
        new THREE.MeshStandardMaterial({ color: "#f97316", emissive: "#f97316", emissiveIntensity: 1.0 })
      );
      lantern.position.set(pos.x * 1.08, pos.y + 0.55, pos.z * 1.08);
      towerScene.add(lantern);

      // PointLight nhỏ tại mỗi lantern tạo ánh sáng thật
      const lanternLight = new THREE.PointLight("#ffa040", 0.6, 8);
      lanternLight.position.set(pos.x * 1.08, pos.y + 0.55, pos.z * 1.08);
      towerScene.add(lanternLight);
    }
  }

  for (let i = 0; i < TOWER_CONFIG.vineCount; i++) {
    const angleOffset = (i / TOWER_CONFIG.vineCount) * Math.PI * 2;
    const points = [];
    for (let step = 0; step <= 42; step++) {
      const t = step / 42;
      const angle = angleOffset + t * Math.PI * 5;
      const radius = TOWER_CONFIG.pillarRadius + 0.16 + Math.sin(t * Math.PI * 3) * 0.08;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        t * height,
        Math.sin(angle) * radius
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const vine = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 42, 0.025, 6, false),
      new THREE.MeshStandardMaterial({ color: "#22c55e", emissive: "#003300", emissiveIntensity: 0.3, roughness: 0.8 })
    );
    towerScene.add(vine);
  }

  // === APEX PLATFORM — sân đỉnh tháp ===
  const apexHeight = height + 0.3;

  // Sân tròn rộng
  const apexFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(5.5, 6.0, 0.4, 48),
    new THREE.MeshPhysicalMaterial({ color: "#1e1b4b", emissive: "#312e81", emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.6 })
  );
  apexFloor.position.y = apexHeight;
  apexFloor.receiveShadow = true;
  towerScene.add(apexFloor);

  // Lan can vòng quanh sân
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: "#fbbf24", emissive: "#fbbf24", emissiveIntensity: 0.5 })
    );
    post.position.set(Math.cos(angle) * 5.2, apexHeight + 0.65, Math.sin(angle) * 5.2);
    towerScene.add(post);
  }

  // Trophy — vàng PBR với emissive glow
  const trophy = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshPhysicalMaterial({ color: "#fbbf24", emissive: "#ffaa00", emissiveIntensity: 0.9, roughness: 0.1, metalness: 1.0 })
  );
  trophy.position.y = apexHeight + 2.2;
  trophy.userData.isTowerTrophy = true;
  towerScene.add(trophy);

  // Crown ring quanh trophy
  const crownRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.06, 8, 72),
    new THREE.MeshBasicMaterial({ color: "#fbbf24", transparent: true, opacity: 0.8 })
  );
  crownRing.position.y = apexHeight + 1.2;
  crownRing.rotation.x = Math.PI / 2;
  towerScene.add(crownRing);

  // Ánh sáng tại đỉnh
  const apexLight = new THREE.PointLight("#fff5b4", 2.0, 20);
  apexLight.position.y = apexHeight + 3;
  towerScene.add(apexLight);

  // Phase 5 — Sky gradient shader
  createSkyGradient();
  createStars();

  // Phase 4 — Ambient dust system
  ambientDust = createAmbientDust();
  createMistPool();

  // Podium system
  towerPodiums = buildPodiums();
}

function buildTowerRacers(names) {
  const skins = towerLegacy?.MYTHICAL_BEAST_SKINS || [];
  towerRacers = names.map((name, index) => {
    const skin = skins[index % Math.max(1, skins.length)] || {
      name: "Linh Hồ",
      color: "#f97316",
      emoji: "🦊"
    };
    const group = new THREE.Group();
    const fox = createTowerFoxModel(skin.color);
    const label = createNameSprite(name, skin.color);
    const statusAura = new THREE.Mesh(
      new THREE.TorusGeometry(0.68, 0.025, 8, 36),
      new THREE.MeshBasicMaterial({
        color: skin.color,
        transparent: true,
        opacity: 0.18,
        depthWrite: false
      })
    );
    statusAura.rotation.x = Math.PI / 2;
    statusAura.position.y = 0.16;
    group.add(fox);
    group.add(statusAura);
    group.add(label);

    const startPos = getHelixPosition(0);
    const spread = (index - (names.length - 1) / 2) * 0.18;
    group.position.set(startPos.x + spread, startPos.y + getRacerGroundOffset(), startPos.z + spread);
    group.rotation.y = startPos.angle + Math.PI / 2;
    towerScene.add(group);

    return {
      name,
      skinName: skin.name,
      color: skin.color,
      emoji: "🦊",
      group,
      fox,
      label,
      statusAura,
      progress: 0,
      visualProgress: 0,
      lastStepIndex: 0,
      stridePhase: index * 0.45,
      landingPulse: 0,
      lastFrameMs: 0,
      lastTrailAt: 0,
      displayLaneOffset: ((index % 5) - 2) * 0.22,
      plannedFinishMs: getPlannedFinishMs(),
      timePenaltyMs: 0,
      timeBonusMs: 0,
      airJump: null,
      boostTimer: 0,
      slowTimer: 0,
      finished: false,
      rank: null,
      rawZ: TRACK_LENGTH_FOR_SHARED_LEADERBOARD,
      victoryTimer: 0,
      victoryPhase: 0
    };
  });
  towerRacers.forEach(r => initRacerTrail(r));
}

function completeTowerRacer(racer, now) {
  if (!racer || racer.finished) return;

  racer.progress = 1;
  racer.visualProgress = 1;
  racer.finished = true;
  racer.rank = ++towerFinishedCount;
  racer.finishTime = Date.now();
  racer.airJump = null;

  attachDroneToRacer(racer);

  if (racer.rank <= towerPrizeCount && towerPodiums[racer.rank - 1]) {
    racer.targetPodium = towerPodiums[racer.rank - 1];
    racer.targetPodium.userData.occupied = true;
  } else {
    racer.overflowSpot = getSafeOverflowSpot(racer);
  }

  racer.flyState = 'ascending';
  racer.flyStartTime = now;
  racer.flyStartPosition = racer.group.position.clone();
  racer.victoryTimer = 0;
  racer.victoryPhase = 0;
  racer.awardIdleAction = racer.fox?.userData?.awardIdleAction || "stand";
  racer.awardIdleSeed = Math.random() * Math.PI * 2;

  createParticleBurst(racer.group.position.clone(), "#fbbf24", 30, 0.15);
  towerLegacy?.playTickSound?.(760, 0.08);
  towerLegacy?.updateCommentaryText?.(`🏆 [${racer.name}] đã đặt chân lên đỉnh tháp! Hạng ${racer.rank}!`);
}

function createParticleBurst(position, color, count = 10, power = 0.08) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 });
  const geo = new THREE.SphereGeometry(0.055, 8, 8);
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo.clone(), mat.clone());
    mesh.position.copy(position);
    const angle = Math.random() * Math.PI * 2;
    mesh.userData.velocity = new THREE.Vector3(
      Math.cos(angle) * power * (0.6 + Math.random()),
      power * (0.5 + Math.random()),
      Math.sin(angle) * power * (0.6 + Math.random())
    );
    mesh.userData.life = 32 + Math.random() * 22;
    mesh.userData.maxLife = mesh.userData.life;
    towerParticles.push(mesh);
    towerScene.add(mesh);
  }
}

function getTowerPlatform(stepIndex) {
  if (!towerPlatforms.length) return null;
  const index = Math.max(0, Math.min(towerPlatforms.length - 1, Math.round(stepIndex)));
  return towerPlatforms[index] || null;
}

function pulseTowerPlatform(stepIndex, color = "#fbbf24", strength = 1) {
  const platform = getTowerPlatform(stepIndex);
  if (!platform?.material) return;
  platform.userData.pulse = Math.max(platform.userData.pulse || 0, strength);
  platform.userData.pulseColor = color;
}

function updateTowerPlatformPulses() {
  towerPlatforms.forEach((platform) => {
    if (!platform?.material) return;
    const pulse = Math.max(0, platform.userData.pulse || 0);
    if (pulse <= 0.01) {
      platform.userData.pulse = 0;
      platform.scale.y += (1 - platform.scale.y) * 0.2;
      platform.material.color.set(platform.userData.baseColor || "#10b981");
      platform.material.emissive?.set(platform.userData.baseColor || "#10b981");
      platform.material.emissiveIntensity = platform.userData.baseEmissiveIntensity ?? 0.1;
      return;
    }

    const pulseColor = platform.userData.pulseColor || "#fbbf24";
    platform.material.color.set(pulseColor);
    platform.material.emissive?.set(pulseColor);
    platform.material.emissiveIntensity = (platform.userData.baseEmissiveIntensity ?? 0.1) + pulse * 0.62;
    platform.scale.y = 1 + pulse * 0.62;
    platform.userData.pulse = pulse * 0.86;
  });
}

function createLandingDust(racer, stepIndex) {
  if (!racer?.group) return;
  const color = racer.boostTimer > 0 ? "#fbbf24" : racer.slowTimer > 0 ? "#93c5fd" : "#d9f99d";
  const count = racer.boostTimer > 0
    ? TOWER_CONFIG.motion.boostTrailCount
    : TOWER_CONFIG.motion.dustCount;
  const pos = racer.group.position.clone();
  pos.y += 0.08;
  createParticleBurst(pos, color, count, racer.boostTimer > 0 ? 0.075 : 0.045);
}

function startTowerAirJump(racer, now, color = "#fbbf24", strength = 1, maxSteps = null) {
  if (!racer || racer.finished) return;
  const startProgress = clamp(racer.visualProgress ?? racer.progress ?? 0, 0, 1);
  const maxJumpSteps = Math.max(1, num(maxSteps, TOWER_CONFIG.events.maxStackedJumpSteps || 6));
  const totalSteps = getTowerTotalSteps();
  const maxEndProgress = startProgress + maxJumpSteps / Math.max(1, totalSteps);
  const logicalEndProgress = Math.max(racer.progress ?? startProgress, maxEndProgress);
  const endProgress = clamp(logicalEndProgress, startProgress, Math.min(1, maxEndProgress));
  if (endProgress <= startProgress + 0.001) return;

  const progressDelta = endProgress - startProgress;
  const stepDelta = Math.min(maxJumpSteps, Math.max(1, progressDelta * totalSteps));
  const duration = clamp(430 + stepDelta * 88, 560, 980);
  const height = clamp(
    TOWER_CONFIG.stepHeight * (1.15 + stepDelta * 0.16) * strength,
    1.9,
    3.8
  );

  racer.airJump = {
    startTime: now,
    duration,
    startProgress,
    endProgress,
    height,
    color,
    landed: false
  };
  racer.visualProgress = startProgress;
  createParticleBurst(racer.group.position.clone(), color, Math.round(12 * strength), 0.08 * strength);
}

function initRacerTrail(racer) {
  const TRAIL_LEN = 24;
  const positions = new Float32Array(TRAIL_LEN * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color: racer.color,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  towerScene.add(line);
  racer.trail = { line, positions, history: [], maxLen: TRAIL_LEN };
}

function updateRacerTrail(racer) {
  if (!racer.trail || !racer.group) return;
  const t = racer.trail;
  const pos = racer.group.position;
  t.history.push(pos.x, pos.y + 0.3, pos.z);
  if (t.history.length > t.maxLen * 3) t.history.splice(0, 3);
  const len = t.history.length / 3;
  for (let i = 0; i < len; i++) {
    t.positions[i * 3]     = t.history[i * 3];
    t.positions[i * 3 + 1] = t.history[i * 3 + 1];
    t.positions[i * 3 + 2] = t.history[i * 3 + 2];
  }
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.geometry.setDrawRange(0, len);

  // Color: gold on boost, blue on slow
  const isBoosting = racer.boostTimer > 0;
  const isSlowed   = racer.slowTimer > 0;
  t.line.material.color.set(isBoosting ? '#fbbf24' : isSlowed ? '#93c5fd' : racer.color);
  t.line.material.opacity = isBoosting ? 0.8 : 0.45;
}

function flashNearestPlatform(racer, color = "#ef4444") {
  const step = Math.round((racer.progress || 0) * getTowerTotalSteps());
  const platform = getTowerPlatform(step);
  if (!platform?.material) return;

  pulseTowerPlatform(step, color, 1.25);
  platform.material.color.set(color);
  platform.material.emissive?.set(color);
  platform.material.emissiveIntensity = 0.7;
  platform.scale.y = 1.8;
  setTimeout(() => {
    if (!platform.material) return;
    platform.material.color.set(platform.userData.baseColor || "#10b981");
    platform.material.emissive?.set(platform.userData.baseColor || "#10b981");
    platform.material.emissiveIntensity = 0.1;
    platform.scale.y = 1;
  }, 480);
}

function triggerTowerEvent(now) {
  if (now < towerNextEventAt) return;
  const delay = TOWER_CONFIG.events.minDelayMs
    + Math.random() * (TOWER_CONFIG.events.maxDelayMs - TOWER_CONFIG.events.minDelayMs);
  towerNextEventAt = now + delay;

  const active = towerRacers.filter((racer) => !racer.finished);
  if (!active.length) return;
  const racer = active[Math.floor(Math.random() * active.length)];
  const roll = Math.random();
  const pos = racer.group.position.clone();

  if (roll < 0.36) {
    const penaltySteps = randomSteps(TOWER_CONFIG.events.trapPenaltySteps, 3, 4);
    const penalty = stepsToEffectMs(racer, penaltySteps);
    racer.timePenaltyMs += penalty;
    racer.slowTimer = 105;
    flashNearestPlatform(racer, "#ef4444");
    createParticleBurst(pos, "#ef4444", 14, 0.09);
    towerLegacy?.playLightningSound?.();
    towerLegacy?.updateCommentaryText?.(`🪤 Bẫy sập đỏ rực! [${racer.name}] bị hụt nhịp trên tháp.`);
  } else if (roll < 0.62) {
    const penaltySteps = randomSteps(TOWER_CONFIG.events.windPenaltySteps, 2, 2.8);
    const penalty = stepsToEffectMs(racer, penaltySteps);
    racer.timePenaltyMs += penalty;
    racer.slowTimer = 75;
    createParticleBurst(pos, "#93c5fd", 11, 0.12);
    towerLegacy?.playTickSound?.(360, 0.05);
    towerLegacy?.updateCommentaryText?.(`💨 Gió núi cuốn qua! [${racer.name}] phải bám chặt lấy bậc tháp.`);
  } else if (roll < 0.9) {
    const bonusSteps = randomSteps(TOWER_CONFIG.events.boostBonusSteps, 3, 4);
    const bonus = stepsToEffectMs(racer, bonusSteps);
    racer.timeBonusMs += bonus;
    racer.progress = getRacerProgress(racer, now);
    racer.boostTimer = 110;
    startTowerAirJump(racer, now, "#10b981", 1, bonusSteps);
    createParticleBurst(pos, "#10b981", 16, 0.1);
    towerLegacy?.playBoostSound?.();
    towerLegacy?.updateCommentaryText?.(`💎 [${racer.name}] nhặt linh ngọc xanh và phóng lên thêm một đoạn!`);
  } else {
    const bonusSteps = randomSteps(TOWER_CONFIG.events.goldenBonusSteps, 5, 6);
    const bonus = stepsToEffectMs(racer, bonusSteps);
    racer.timeBonusMs += bonus;
    racer.progress = getRacerProgress(racer, now);
    racer.boostTimer = 145;
    startTowerAirJump(racer, now, "#fbbf24", 1.05, bonusSteps);
    flashNearestPlatform(racer, "#fbbf24");
    createParticleBurst(pos, "#fbbf24", 22, 0.13);
    towerLegacy?.playBoostSound?.();
    towerLegacy?.playTickSound?.(980, 0.08);
    towerLegacy?.updateCommentaryText?.(`🌟 Platform vàng xuất hiện! [${racer.name}] bật nhảy như hồ tiên!`);
  }
}

function updateParticles() {
  for (let i = towerParticles.length - 1; i >= 0; i--) {
    const particle = towerParticles[i];
    const velocity = particle.userData.velocity || new THREE.Vector3();
    particle.position.add(velocity);
    velocity.y -= 0.003;
    particle.userData.life -= 1;
    const ratio = Math.max(0, particle.userData.life / particle.userData.maxLife);
    particle.material.opacity = ratio * 0.88;
    particle.scale.setScalar(0.6 + ratio);
    if (particle.userData.life <= 0) {
      towerScene.remove(particle);
      disposeObject(particle);
      towerParticles.splice(i, 1);
    }
  }
}

function animateFox(racer, now) {
  const fox = racer.fox;
  if (!fox) return;

  // Victory celebration animation
  if (racer.finished && racer.victoryTimer > 0) {
    racer.victoryTimer--;
    racer.victoryPhase = (racer.victoryPhase || 0) + 0.08;
    const bounce = Math.abs(Math.sin(racer.victoryPhase * 2)) * 0.4;
    fox.position.y = bounce;
    fox.rotation.y = racer.victoryPhase * 2; // spin
    if (fox.userData.body) fox.userData.body.rotation.x = -Math.abs(Math.sin(racer.victoryPhase)) * 0.3;
    fox.scale.setScalar((fox.userData.baseScale || 0.78) * (1 + bounce * 0.2));
    return; // skip normal animation
  }

  const phase = racer.stridePhase || now * 0.014;
  const landing = clamp(racer.landingPulse || 0, 0, 1);
  const hop = Math.sin((racer.stepLocalT || 0) * Math.PI);
  const speedScale = racer.boostTimer > 0 ? 1.35 : racer.slowTimer > 0 ? 0.62 : 1;
  const runPulse = Math.sin(phase) * 0.34 * speedScale;
  const baseScale = fox.userData.baseScale || 0.78;

  fox.position.y = Math.sin(phase * 0.5) * 0.035 - landing * 0.05;
  fox.userData.legs?.forEach((leg, index) => {
    leg.rotation.x = (index % 2 === 0 ? 1 : -1) * runPulse;
    leg.position.y = 0.27 + Math.abs(Math.sin(phase + index * Math.PI * 0.5)) * 0.035;
  });
  if (fox.userData.body) fox.userData.body.rotation.x = -0.05 - hop * 0.12 + landing * 0.08;
  if (fox.userData.head) fox.userData.head.rotation.x = 0.08 + Math.sin(phase * 0.55) * 0.08 - hop * 0.05;
  if (fox.userData.tail) fox.userData.tail.rotation.x = -0.55 + Math.sin(phase * 0.7) * 0.22 + hop * 0.08;
  if (fox.userData.tailTip) fox.userData.tailTip.rotation.x = -0.55 + Math.sin(phase * 0.7) * 0.22 + hop * 0.08;
  fox.scale.set(
    baseScale * (1 + landing * 0.1),
    baseScale * (1 + hop * 0.07 - landing * 0.14),
    baseScale * (1 + landing * 0.08)
  );
}

function updateTowerAwardPose(racer, now) {
  if (!racer?.finished || !racer.group || !racer.fox) return;
  if (racer.flyState && racer.flyState !== "landed") {
    const yaw = getTowerAwardFaceYaw(racer);
    racer.group.rotation.y = lerpAngle(racer.group.rotation.y, yaw, 0.045);
    racer.group.rotation.x = 0;
    racer.group.rotation.z = 0;
    racer.group.scale.setScalar(1);
    return;
  }

  const target = getTowerAwardTarget(racer);
  if (target) racer.group.position.set(target.x, target.y, target.z);

  const yaw = getTowerAwardFaceYaw(racer);
  racer.group.rotation.y = lerpAngle(racer.group.rotation.y, yaw, towerCinematicStarted ? 0.065 : 0.045);
  racer.group.rotation.x = 0;
  racer.group.rotation.z = 0;
  racer.group.scale.setScalar(1);

  const nearby = towerRacers.find((other) => {
    if (other === racer || !other.finished || !other.group) return false;
    return other.group.position.distanceToSquared(racer.group.position) < 5.2;
  });
  const neighborSide = nearby && nearby.group.position.x < racer.group.position.x ? -1 : 1;
  updateBeastIdlePose(racer.fox, racer.awardIdleAction || "stand", now, {
    seed: racer.awardIdleSeed || racer.rank || 0,
    neighborSide,
    lockFacing: true
  });
}

function updateTowerCamera(now) {
  if (!towerCamera) return;

  // Calculate delta time
  const dt = lastCameraUpdateTime ? Math.min((now - lastCameraUpdateTime) / 16.67, 3) : 1;
  lastCameraUpdateTime = now;

  const active = towerRacers.filter((racer) => !racer.finished);
  const source = active.length ? active : towerRacers;
  const topPack = [...source]
    .sort((a, b) => (b.visualProgress || b.progress || 0) - (a.visualProgress || a.progress || 0))
    .slice(0, Math.min(6, source.length));
  const averageProgress = topPack.length
    ? topPack.reduce((sum, racer) => sum + (racer.visualProgress || racer.progress || 0), 0) / topPack.length
    : 0;
  const leadProgress = TOWER_CONFIG.camera.leadProgress || 0;
  const focusProgress = clamp(averageProgress + leadProgress, 0, 1);
  const focusY = focusProgress * getTowerTotalSteps() * TOWER_CONFIG.stepHeight;

  // Clamp max camera Y speed to avoid jitter on boost events
  const maxFocusYDelta = 2.5;
  const clampedFocusY = lastFocusY
    ? clamp(focusY, lastFocusY - maxFocusYDelta, lastFocusY + maxFocusYDelta)
    : focusY;
  lastFocusY = clampedFocusY;

  // Calculate pack speed for dynamic FOV
  const packSpeed = Math.abs(clampedFocusY - lastPackY) / Math.max(dt, 0.1);
  lastPackY = clampedFocusY;

  // Dynamic FOV
  if (TOWER_CONFIG.camera.dynamicFov?.enabled) {
    const fovConfig = TOWER_CONFIG.camera.dynamicFov;
    if (packSpeed > fovConfig.speedThreshold) {
      targetFov = lerp(fovConfig.min, fovConfig.max, Math.min(packSpeed / (fovConfig.speedThreshold * 3), 1));
    } else {
      targetFov = fovConfig.min;
    }
    currentFov += (targetFov - currentFov) * (fovConfig.smoothing || 0.1);
    towerCamera.fov = currentFov;
    towerCamera.updateProjectionMatrix();
  }

  // Orbital angle
  const angle = towerCameraAngleOffset + now * TOWER_CONFIG.camera.orbitSpeed;
  const radius = TOWER_CONFIG.camera.radius + Math.min(9, towerRacers.length * 0.08);

  // Target position with lag
  const lagMs = TOWER_CONFIG.camera.spring?.lagMs || 0;
  const lagFactor = lagMs > 0 ? Math.exp(-dt / (lagMs / 16.67)) : 0;

  const instantTargetX = Math.cos(angle) * radius;
  const instantTargetZ = Math.sin(angle) * radius;
  const instantTargetY = clampedFocusY + TOWER_CONFIG.camera.yOffset;

  cameraLaggedTarget.x = lerp(instantTargetX, cameraLaggedTarget.x, lagFactor);
  cameraLaggedTarget.y = lerp(instantTargetY, cameraLaggedTarget.y, lagFactor);
  cameraLaggedTarget.z = lerp(instantTargetZ, cameraLaggedTarget.z, lagFactor);

  // Spring damper system
  const spring = TOWER_CONFIG.camera.spring || { stiffness: 80, damping: 0.85 };
  const stiffness = spring.stiffness * 0.001; // Scale for frame rate
  const damping = spring.damping;

  // Apply spring force
  cameraVelocity.x += (cameraLaggedTarget.x - towerCamera.position.x) * stiffness * dt;
  cameraVelocity.y += (cameraLaggedTarget.y - towerCamera.position.y) * stiffness * dt;
  cameraVelocity.z += (cameraLaggedTarget.z - towerCamera.position.z) * stiffness * dt;

  // Apply damping
  cameraVelocity.x *= Math.pow(damping, dt);
  cameraVelocity.y *= Math.pow(damping, dt);
  cameraVelocity.z *= Math.pow(damping, dt);

  // Update position
  towerCamera.position.x += cameraVelocity.x * dt;
  towerCamera.position.y += cameraVelocity.y * dt;
  towerCamera.position.z += cameraVelocity.z * dt;

  // Look at focus point
  towerCamera.lookAt(0, clampedFocusY + TOWER_CONFIG.camera.lookYOffset, 0);
}

function updateTowerRacers(now) {
  const totalSteps = getTowerTotalSteps();
  const motion = TOWER_CONFIG.motion || {};
  towerRacers.forEach((racer) => {
    let justFinished = false;
    if (!racer.finished) {
      racer.progress = getRacerProgress(racer, now);
      if (racer.progress >= 1) {
        completeTowerRacer(racer, now);
        justFinished = true;
      }
    }

    racer.boostTimer = Math.max(0, (racer.boostTimer || 0) - 1);
    racer.slowTimer = Math.max(0, (racer.slowTimer || 0) - 1);
    setSharedLeaderboardProgress(racer, racer.progress || 0);

    const dt = racer.lastFrameMs ? clamp(now - racer.lastFrameMs, 0, 48) : 16;
    racer.lastFrameMs = now;

    let activeAirJump = racer.airJump;
    if (activeAirJump) {
      const t = clamp((now - activeAirJump.startTime) / Math.max(1, activeAirJump.duration), 0, 1);
      const eased = easeInOutSine(t);
      racer.visualProgress = clamp(
        lerp(activeAirJump.startProgress, activeAirJump.endProgress, eased),
        0,
        1
      );
      if (t >= 1) {
        racer.visualProgress = Math.max(racer.visualProgress || 0, activeAirJump.endProgress);
        racer.landingPulse = Math.max(racer.landingPulse || 0, 1.45);
        const landedStep = Math.round((racer.visualProgress || 0) * totalSteps);
        pulseTowerPlatform(landedStep, activeAirJump.color, 1.45);
        createParticleBurst(racer.group.position.clone(), activeAirJump.color, 18, 0.12);
        racer.airJump = null;
        activeAirJump = null;
      }
    } else if (racer.finished) {
      // Smooth visual progress to 1.0 even after finishing to prevent camera jitter
      const diff = 1 - (racer.visualProgress || 0);
      racer.visualProgress = clamp((racer.visualProgress || 0) + diff * 0.15, 0, 1);
    } else {
      const targetProgress = Math.max(racer.progress || 0, racer.visualProgress || 0);
      const diff = targetProgress - (racer.visualProgress || 0);
      const snap = motion.stepSnapStrength || 0.2;
      const maxStepProgress = (num(motion.maxVisualStepsPerSecond, 4.2) * (dt / 1000)) / Math.max(1, totalSteps);
      const smoothed = diff * snap;
      const capped = clamp(smoothed, 0, Math.max(maxStepProgress, 0.001));
      racer.visualProgress = clamp((racer.visualProgress || 0) + capped, 0, 1);
    }

    const visualStep = clamp(racer.visualProgress || 0, 0, 1) * totalSteps;
    const stepIndex = Math.min(totalSteps, Math.floor(visualStep + 0.001));
    if (!activeAirJump && !racer.flyState && stepIndex > (racer.lastStepIndex || 0)) {
      racer.landingPulse = 1;
      pulseTowerPlatform(stepIndex, racer.boostTimer > 0 ? "#fbbf24" : racer.color, racer.boostTimer > 0 ? 1.25 : 0.92);
      createLandingDust(racer, stepIndex);
    }
    racer.lastStepIndex = Math.max(racer.lastStepIndex || 0, stepIndex);
    racer.landingPulse *= 0.84;

    const laneOffset = racer.displayLaneOffset || 0;
    const baseStep = Math.min(totalSteps, Math.floor(visualStep));
    const nextStep = Math.min(totalSteps, baseStep + 1);
    let localT = baseStep >= totalSteps ? 1 : visualStep - baseStep;
    let from = getHelixPosition(baseStep / totalSteps);
    let to = getHelixPosition(nextStep / totalSteps);
    let hopArc = 0;
    let pos;

    if (activeAirJump) {
      pos = getTowerAirJumpPosition(activeAirJump, now, laneOffset);
      from = pos.from;
      to = pos.to;
      localT = pos.t;
      hopArc = pos.hop;
    } else {
      const smoothT = smoothStep(localT);
      // Slow ascent (peak at ~t=0.38), fast descent
      hopArc = Math.sin(Math.pow(smoothT, 0.55) * Math.PI);
      const hopScale = racer.boostTimer > 0 ? 1.22 : racer.slowTimer > 0 ? 0.72 : 1;
      const x = lerp(from.x, to.x, smoothT);
      const z = lerp(from.z, to.z, smoothT);
      const radial = new THREE.Vector3(x, 0, z);
      if (radial.lengthSq() > 0.0001) radial.normalize();
      pos = {
        x: x + radial.x * laneOffset,
        y: lerp(from.y, to.y, smoothT)
          + getRacerGroundOffset()
          + hopArc * (motion.hopHeight || 1.1) * hopScale
          + (racer.landingPulse || 0) * (motion.landingBounce || 0.22),
        z: z + radial.z * laneOffset,
        angle: lerp(from.angle, to.angle, smoothT)
      };
    }

    const group = racer.group;
    if (!racer.flyState || justFinished) {
      group.position.set(pos.x, pos.y, pos.z);
    }
    // Face the tangent direction of the helix (direction of movement)
    const tangentX = to.x - from.x;
    const tangentZ = to.z - from.z;
    const faceAngle = (tangentX !== 0 || tangentZ !== 0)
      ? Math.atan2(tangentX, tangentZ) + Math.PI  // +Math.PI để quay mặt về phía trước
      : pos.angle + Math.PI / 2;
    if (!racer.flyState || justFinished) {
      group.rotation.y = faceAngle;
      group.rotation.x = -hopArc * 0.12;
      group.rotation.z = racer.slowTimer > 0 ? Math.sin(now * 0.018 + stepIndex) * 0.1 : 0;
      group.scale.setScalar(racer.boostTimer > 0 ? 1.08 : racer.slowTimer > 0 ? 0.94 : 1);
    }

    if (racer.statusAura?.material) {
      const auraColor = racer.boostTimer > 0 ? "#fbbf24" : racer.slowTimer > 0 ? "#60a5fa" : racer.color;
      racer.statusAura.material.color.set(auraColor);
      racer.statusAura.material.opacity = racer.boostTimer > 0 ? 0.62 : racer.slowTimer > 0 ? 0.44 : 0.2;
      const auraScale = racer.boostTimer > 0 ? 1.35 + hopArc * 0.18 : racer.slowTimer > 0 ? 1.1 : 1;
      racer.statusAura.scale.setScalar(auraScale);
      racer.statusAura.rotation.z += racer.boostTimer > 0 ? 0.08 : 0.025;
    }

    const strideSpeed = motion.strideSpeed || 0.018;
    const statusSpeed = racer.boostTimer > 0 ? 1.35 : racer.slowTimer > 0 ? 0.58 : 1;
    racer.stridePhase = (racer.stridePhase || 0) + dt * strideSpeed * statusSpeed;
    racer.stepLocalT = localT;
    updateRacerTrail(racer);
    updateRacerFly(racer, now);
    if (racer.finished) {
      updateTowerAwardPose(racer, now);
    } else {
      animateFox(racer, now);
    }
  });

  // Chỉ hiện tên top 5 racers, ẩn phần còn lại
  const sorted5 = [...towerRacers]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.rank - b.rank;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return (b.visualProgress || 0) - (a.visualProgress || 0);
    })
    .slice(0, 5);

  towerRacers.forEach((racer) => {
    if (!racer.label) return;
    const rank = sorted5.indexOf(racer);
    if (rank === -1) {
      racer.label.material.opacity = 0;
      return;
    }
    // Top 1 to hơn, các vị trí sau nhỏ dần nhẹ
    racer.label.material.opacity = 1;
    racer.label.position.y = racer.finished ? (racer.rank <= towerPrizeCount ? 2.1 : 1.85) : 1.4;
    const s = rank === 0 ? 4.2 : 3.2;
    const h = rank === 0 ? 1.4 : 1.05;
    racer.label.scale.set(s, h, 1);
  });
}

function getSortedTowerRacers() {
  return [...towerRacers].sort((a, b) => {
    if (a.finished && b.finished) return a.rank - b.rank;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.progress || 0) - (a.progress || 0);
  });
}

function forceFinishRemaining() {
  towerRacers
    .filter((racer) => !racer.finished)
    .sort((a, b) => (b.progress || 0) - (a.progress || 0))
    .forEach((racer) => {
      completeTowerRacer(racer, performance.now());
      setSharedLeaderboardProgress(racer, 1);
    });
}

function animateTowerClimb(now = performance.now()) {
  if (!towerRunning) return;
  towerLegacy?.updateRaceTimerDisplay?.();
  updateTowerRacers(now);
  triggerTowerEvent(now);
  const overtime = now - towerStartMs > towerDurationMs + 4500;
  if (!towerCinematicStarted && (towerRacers.every((racer) => racer.finished) || overtime)) {
    if (overtime) forceFinishRemaining();
    startTowerCinematic(now);
  }

  updateParticles();
  updateTowerPlatformPulses();
  if (towerCinematicStarted) {
    updateCinematicCamera(now);
  } else {
    updateTowerCamera(now);
  }
  updateAmbientDust();
  updateStarsTwinkle(now);

  // Pulse mist slowly
  towerScene.children.forEach(c => {
    if (c.userData?.isMist) {
      c.material.opacity = 0.10 + 0.04 * Math.sin(now * 0.0006);
      c.rotation.y += 0.0008;
    }
  });

  towerScene.children.forEach((child) => {
    if (child.userData?.isTowerTrophy) {
      child.rotation.y += 0.018;
      child.position.y += Math.sin(now * 0.004) * 0.002;
    }
  });

  const sorted = getSortedTowerRacers();
  towerLegacy?.updateLeaderboardUI?.(sorted);

  towerRenderer?.render(towerScene, towerCamera);

  towerLoopId = requestAnimationFrame(animateTowerClimb);
}

function resizeTowerScene() {
  const container = document.getElementById("webgl-container");
  if (!container || !towerRenderer || !towerCamera) return;
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  towerRenderer.setSize(width, height);
  towerCamera.aspect = width / height;
  towerCamera.updateProjectionMatrix();
}

function runTowerCountdown() {
  const overlay = document.getElementById("countdown-overlay");
  const number = document.getElementById("countdown-number");
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
  towerLegacy?.playTickSound?.(620, 0.05);

  const timer = setInterval(() => {
    sec -= 1;
    if (sec > 0) {
      showValue(sec);
      towerLegacy?.playTickSound?.(620 + sec * 80, 0.05);
      return;
    }
    clearInterval(timer);
    showValue("LEO!");
    towerLegacy?.playHornSound?.();
    setTimeout(() => {
      number.classList.remove("show");
      overlay.style.display = "none";
      towerStartMs = performance.now();
      towerNextEventAt = towerStartMs + 900;
      towerLegacy?.startRaceTimer?.(towerDurationSeconds);
      towerLegacy?.updateCommentaryText?.("🏯 Tháp xoắn mở cổng! Các linh hồ bắt đầu leo!");
      towerLoopId = requestAnimationFrame(animateTowerClimb);
    }, 650);
  }, 900);
}

function initTowerScene(names) {
  const container = document.getElementById("webgl-container");
  const canvas = document.getElementById("webgl-canvas");
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);

  towerScene = new THREE.Scene();
  towerScene.background = new THREE.Color("#03120d");
  towerScene.fog = new THREE.FogExp2("#03120d", 0.0095);

  towerCamera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1200);
  towerCamera.position.set(0, 16, TOWER_CONFIG.camera.radius);
  cinematicCameraFrom = null;

  // Reset camera spring system
  cameraVelocity = { x: 0, y: 0, z: 0 };
  cameraLaggedTarget = {
    x: towerCamera.position.x,
    y: towerCamera.position.y,
    z: towerCamera.position.z
  };
  lastCameraUpdateTime = 0;
  currentFov = 60;
  targetFov = 60;
  lastPackY = 0;
  lastFocusY = 0;

  towerRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  towerRenderer.setSize(width, height);
  towerRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  towerRenderer.shadowMap.enabled = true;
  towerRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // ACES Filmic tonemapping tạo hiệu ứng cinematic, emissive vật thể sáng rực hơn
  towerRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  towerRenderer.toneMappingExposure = 1.4;
  towerRenderer.outputEncoding = THREE.sRGBEncoding;

  // Ambient — tím tối, tạo mood huyền bí
  const ambient = new THREE.AmbientLight("#1a0a2e", 0.4);
  towerScene.add(ambient);
  // Key light — ánh sáng ấm từ trên cao
  const key = new THREE.DirectionalLight("#fff5e0", 1.2);
  key.position.set(20, 60, 20);
  key.castShadow = true;
  key.shadow.mapSize.width = 2048;
  key.shadow.mapSize.height = 2048;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 200;
  key.shadow.camera.top = 60;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.left = -40;
  key.shadow.camera.right = 40;
  towerScene.add(key);
  // Rim light — viền sáng cam đỏ phía sau tạo chiều sâu
  const rim = new THREE.PointLight("#ff6b35", 0.8, 100);
  rim.position.set(0, 30, -15);
  towerScene.add(rim);
  // Fill light — cyan phía trước làm sáng mặt nhân vật
  const fill = new THREE.PointLight("#4ecdc4", 0.4, 80);
  fill.position.set(0, 20, 25);
  towerScene.add(fill);

  buildTowerStructure();
  buildTowerRacers(names);

  towerResizeHandler = resizeTowerScene;
  window.addEventListener("resize", towerResizeHandler);
  resizeTowerScene();
  runTowerCountdown();
}

export async function startTowerClimbGame(context, names) {
  cleanupTowerClimbGame();
  cleanupTowerClimbFallback2D();
  towerLegacy = context?.legacy || window.__minigamesLegacyApi || {};
  towerLegacy?.initAudioContext?.();
  towerLegacy?.cleanupWebGLScene?.();
  towerDurationSeconds = getDurationSeconds();
  towerDurationMs = towerDurationSeconds * 1000;
  towerPrizeCount = getSelectedPrizeCount();
  towerFinishedCount = 0;
  towerRunning = true;

  setupTowerDom(names);
  if (typeof window.mngMusicSetMode === "function") window.mngMusicSetMode("playing");

  try {
    await (towerLegacy.loadThreeJSDynamic ? towerLegacy.loadThreeJSDynamic() : Promise.resolve());
    initTowerScene(names);
  } catch (err) {
    console.warn("Lỗi tải Three.js Tower, chuyển sang 2D dự phòng:", err);
    cleanupTowerClimbGame();
    startTowerClimbFallback2D(context, names);
  }
}

export function cleanupTowerClimbGame() {
  towerRunning = false;
  if (towerLoopId) {
    cancelAnimationFrame(towerLoopId);
    towerLoopId = null;
  }
  if (towerResizeHandler) {
    window.removeEventListener("resize", towerResizeHandler);
    towerResizeHandler = null;
  }

  if (towerScene) {
    while (towerScene.children.length > 0) {
      const child = towerScene.children[0];
      towerScene.remove(child);
      disposeObject(child);
    }
  }
  if (towerRenderer) {
    towerRenderer.dispose();
  }

  document.getElementById("webgl-container")?.classList.remove("tower-climb-active");
  const derbyLayer = document.getElementById("derby-camera-layer");
  if (derbyLayer) derbyLayer.style.display = "";

  towerScene = null;
  towerCamera = null;
  towerRenderer = null;
  towerRacers = [];
  towerPlatforms = [];
  towerParticles = [];
  towerPodiums = [];
  towerCinematicStarted = false;
  towerCinematicStartTime = 0;
  towerCinematicPhase = 0;
  towerCopyButtonShown = false;
  cinematicCameraFrom = null;
  towerDurationSeconds = DEFAULT_GAME_DURATION_SECONDS;
  towerDurationMs = DEFAULT_GAME_DURATION_SECONDS * 1000;
  towerPrizeCount = 3;
  towerLegacy = null;

  // Hide cinematic UI
  const cinematicUi = document.getElementById('tower-cinematic-ui');
  if (cinematicUi) cinematicUi.style.display = 'none';
}
