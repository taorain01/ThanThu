# 🏆 Kế hoạch Podium System — Tower Climb

**Ngày tạo:** 2026-06-25  
**Mục tiêu:** Thay popup victory bằng podium 3D tại đỉnh tháp, drone kéo thú lên bục, camera cinematic

---

## Tổng quan

Thay vì popup kết quả, các thú về đích sẽ:
1. Được drone kéo bay thẳng lên bục podium (top 1-2-3)
2. Nếu hết bục → đứng vòng tròn ngẫu nhiên trên sân đỉnh
3. Khi thú cuối về → camera quay chậm cinematic + nút Copy xuất hiện

---

## Phase 1 — Podium Structure (Bục vinh danh)

### Vị trí & Kích thước

```
Apex platform (sân đỉnh): y = height + 0.3
└── Podium 1 (vàng):   y = apexHeight + 1.8,  radius = 0,    (center)
└── Podium 2 (bạc):    y = apexHeight + 1.2,  radius = 3.5,  angle = -π/4
└── Podium 3 (đồng):   y = apexHeight + 1.2,  radius = 3.5,  angle = +π/4
```

### Geometry

**Bục 1 (Top 1 — Vàng):**
- CylinderGeometry(1.2, 1.4, 1.8) — lớn nhất, cao nhất
- MeshPhysicalMaterial gold (color: #fbbf24, emissive: #ffaa00, metalness: 0.9)
- Text "1" phía trước (TextGeometry hoặc Sprite)

**Bục 2 (Top 2 — Bạc):**
- CylinderGeometry(1.0, 1.2, 1.2)
- MeshPhysicalMaterial silver (color: #e2e8f0, emissive: #cbd5e1, metalness: 0.8)
- Text "2"

**Bục 3 (Top 3 — Đồng):**
- CylinderGeometry(1.0, 1.2, 1.2)
- MeshPhysicalMaterial bronze (color: #fb923c, emissive: #ea580c, metalness: 0.7)
- Text "3"

### Code structure

```js
function buildPodiums() {
  const apexHeight = getTowerTotalSteps() * TOWER_CONFIG.stepHeight + 0.3;
  const podiums = [];

  // Podium 1 (center, tallest)
  const p1 = createPodium(1, 0, apexHeight + 1.8, 0, '#fbbf24', 1.8, 1.2);
  podiums.push(p1);

  // Podium 2 (left)
  const angle2 = -Math.PI / 4;
  const p2 = createPodium(2, Math.cos(angle2) * 3.5, apexHeight + 1.2, Math.sin(angle2) * 3.5, '#e2e8f0', 1.2, 1.0);
  podiums.push(p2);

  // Podium 3 (right)
  const angle3 = Math.PI / 4;
  const p3 = createPodium(3, Math.cos(angle3) * 3.5, apexHeight + 1.2, Math.sin(angle3) * 3.5, '#fb923c', 1.2, 1.0);
  podiums.push(p3);

  return podiums;
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
  label.position.y = height / 2 + 0.3;
  group.add(label);

  group.position.set(x, y, z);
  group.userData.rank = rank;
  group.userData.occupied = false;
  towerScene.add(group);
  
  return group;
}

function createRankSprite(rank) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), 64, 64);
  
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sprite.scale.set(0.8, 0.8, 1);
  return sprite;
}
```

---

## Phase 2 — Drone & Fly-to-Podium

### Drone Model

```js
function createDrone(color) {
  const drone = new THREE.Group();
  
  // Body — octahedron
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3, 0),
    new THREE.MeshStandardMaterial({ color: '#444', metalness: 0.8 })
  );
  drone.add(body);
  
  // 4 propellers
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
    });
  });
  
  drone.userData.propellers = drone.children.filter(c => c.userData.isPropeller);
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
```

### Fly to Podium Logic

Khi racer về đích:

```js
// In finish block (updateTowerRacers, when racer.progress >= 1)
if (racer.progress >= 1) {
  racer.progress = 1;
  racer.finished = true;
  racer.rank = ++towerFinishedCount;
  racer.finishTime = Date.now();
  
  // Attach drone
  attachDroneToRacer(racer);
  
  // Assign podium or overflow spot
  if (racer.rank <= 3) {
    racer.targetPodium = towerPodiums[racer.rank - 1];
    racer.targetPodium.userData.occupied = true;
  } else {
    // Overflow: random spot on apex circle
    const angle = Math.random() * Math.PI * 2;
    const r = 4.5 + Math.random() * 1.5;
    racer.overflowSpot = {
      x: Math.cos(angle) * r,
      y: apexHeight + 0.8,
      z: Math.sin(angle) * r
    };
  }
  
  racer.flyState = 'ascending'; // 'ascending' → 'landing' → 'landed'
  racer.flyStartTime = now;
}
```

### Fly Animation

```js
function updateRacerFly(racer, now) {
  if (!racer.flyState || racer.flyState === 'landed') return;
  
  const elapsed = now - racer.flyStartTime;
  
  if (racer.flyState === 'ascending') {
    // Lerp to target podium/overflow position
    const target = racer.targetPodium
      ? { x: racer.targetPodium.position.x, y: racer.targetPodium.position.y + racer.targetPodium.userData.height / 2 + 0.5, z: racer.targetPodium.position.z }
      : racer.overflowSpot;
    
    const duration = 2000;
    const t = clamp(elapsed / duration, 0, 1);
    const eased = smoothStep(t);
    
    racer.group.position.x = lerp(racer.group.position.x, target.x, eased * 0.08);
    racer.group.position.y = lerp(racer.group.position.y, target.y, eased * 0.08);
    racer.group.position.z = lerp(racer.group.position.z, target.z, eased * 0.08);
    
    // Spin drone propellers fast
    animateDronePropellers(racer.drone, 0.3);
    
    if (t >= 1) {
      racer.flyState = 'landing';
      racer.flyStartTime = now;
    }
  } else if (racer.flyState === 'landing') {
    // Gentle descend onto podium
    const duration = 800;
    const t = clamp(elapsed / duration, 0, 1);
    
    // Lower Y slightly
    racer.group.position.y -= 0.015 * (1 - t);
    animateDronePropellers(racer.drone, 0.2);
    
    if (t >= 1) {
      racer.flyState = 'landed';
      // Remove drone
      racer.group.remove(racer.drone);
      racer.drone = null;
      // Play confetti
      createParticleBurst(racer.group.position.clone(), racer.color, 40, 0.18);
    }
  }
}
```

---

## Phase 3 — Cinematic Camera khi kết thúc

### Trigger

Khi **thú cuối cùng về đích** (`towerRacers.every(r => r.finished)`):

```js
if (towerRacers.every(r => r.finished) && !towerCinematicStarted) {
  towerCinematicStarted = true;
  towerCinematicStartTime = now;
  towerCinematicPhase = 0; // 0: pan to podiums, 1: orbit top3, 2: idle
}
```

### Camera Phases

**Phase 0 (0-3s): Pan to Podiums**
- Camera lerp từ vị trí hiện tại → trước mặt podium 1 (distance 8, angle facing center)
- lookAt podium 1 center

**Phase 1 (3-12s): Orbit Top 3**
- Camera orbit chậm quanh 3 bục (radius 9, speed 0.0002 rad/ms)
- lookAt trung tâm tam giác 3 bục

**Phase 2 (12s+): Idle**
- Camera đứng yên ở góc đẹp nhất
- UI "Copy" button xuất hiện

```js
function updateCinematicCamera(now) {
  if (!towerCinematicStarted) return;
  const elapsed = now - towerCinematicStartTime;
  
  if (elapsed < 3000) {
    // Phase 0: Pan to podiums
    towerCinematicPhase = 0;
    const t = smoothStep(elapsed / 3000);
    const targetX = 8;
    const targetY = apexHeight + 2;
    const targetZ = 0;
    towerCamera.position.x = lerp(towerCamera.position.x, targetX, t * 0.05);
    towerCamera.position.y = lerp(towerCamera.position.y, targetY, t * 0.05);
    towerCamera.position.z = lerp(towerCamera.position.z, targetZ, t * 0.05);
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
```

---

## Phase 4 — Copy Button UI

### HTML

Thêm vào `minigames.html` (trong arena-view):

```html
<div id="tower-cinematic-ui" style="display: none;">
  <button class="tower-copy-btn" onclick="copyTowerResults()">
    📋 Copy Kết Quả
  </button>
</div>
```

### CSS (tower-climb.css)

```css
#tower-cinematic-ui {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
}

.tower-copy-btn {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #1a0a00;
  font-size: 18px;
  font-weight: 800;
  padding: 14px 32px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(251, 191, 36, 0.5);
  transition: all 0.3s ease;
  animation: pulseCopyButton 2s ease-in-out infinite;
}

.tower-copy-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 12px 32px rgba(251, 191, 36, 0.7);
}

@keyframes pulseCopyButton {
  0%, 100% { box-shadow: 0 8px 24px rgba(251, 191, 36, 0.5); }
  50% { box-shadow: 0 12px 36px rgba(251, 191, 36, 0.9); }
}
```

### JS Function

```js
function showCopyButton() {
  document.getElementById('tower-cinematic-ui').style.display = 'block';
}

function copyTowerResults() {
  const sorted = getSortedTowerRacers();
  const top3 = sorted.slice(0, 3);
  const text = `🏆 Tower Climb Results 🏆\n` +
    top3.map((r, i) => `${i + 1}. ${r.emoji} ${r.name}`).join('\n');
  
  navigator.clipboard.writeText(text).then(() => {
    alert('✅ Đã copy kết quả!');
  });
}
```

---

## Phase 5 — Disable Popup Victory

### Xóa popup logic

Trong `animateTowerClimb`, thay:

```js
if (towerRacers.every((racer) => racer.finished) || overtime) {
  cancelAnimationFrame(towerLoopId);
  towerLoopId = null;
  towerLegacy?.stopRaceTimer?.(true);
  towerLegacy?.playVictorySound?.();
  towerLegacy?.displayVictoryResults?.(getSortedTowerRacers()); // ← XÓA dòng này
  return;
}
```

Thành:

```js
if (towerRacers.every((racer) => racer.finished) || overtime) {
  if (!towerCinematicStarted) {
    towerCinematicStarted = true;
    towerCinematicStartTime = now;
    towerLegacy?.stopRaceTimer?.(true);
    towerLegacy?.playVictorySound?.();
  }
  // Continue animation loop for cinematic camera
}
```

---

## Thứ tự thực hiện

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
Podium   Drone     Camera    Copy UI   Disable popup
 (1h)     (1.5h)    (1h)      (0.5h)    (0.5h)
```

---

## Files cần thay đổi

| File | Thay đổi |
|---|---|
| [engine3d.js](WebBangChien/minigames/games/tower-climb/engine3d.js) | buildPodiums, createDrone, updateRacerFly, updateCinematicCamera |
| [config.js](WebBangChien/minigames/games/tower-climb/config.js) | Thêm podium config, cinematic config |
| [minigames.html](WebBangChien/minigames.html) | Thêm #tower-cinematic-ui |
| [tower-climb.css](WebBangChien/minigames/styles/games/tower-climb.css) | .tower-copy-btn styles |
| [app.js](WebBangChien/minigames/core/app.js) | copyTowerResults, showCopyButton |

---

## Checklist

- [ ] **Phase 1:** Build 3 podiums với rank sprites
- [ ] **Phase 2:** Drone model + attach on finish + fly animation
- [ ] **Phase 3:** Cinematic camera 3 phases
- [ ] **Phase 4:** Copy button UI + CSS + copyTowerResults()
- [ ] **Phase 5:** Disable displayVictoryResults popup
- [ ] **Test:** 3 racers lên bục đúng, overflow racers đứng vòng tròn
- [ ] **Test:** Camera orbit mượt, copy button hoạt động
