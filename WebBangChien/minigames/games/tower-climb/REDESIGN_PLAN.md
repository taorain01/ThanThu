# 🗼 Kế hoạch Redesign Tower Climb

**Ngày tạo:** 2026-06-25  
**Mục tiêu:** Giao diện đẹp hơn, hiệu ứng mượt mà, camera di chuyển mượt mà hơn

---

## Tổng quan hiện trạng

| Yếu tố | Hiện tại | Vấn đề |
|---|---|---|
| Camera | Lerp factor cố định `0.055` | Cảm giác "nảy", không có quán tính |
| Ánh sáng | Ambient + Directional cơ bản | Phẳng, thiếu chiều sâu |
| Particle | Sphere mesh + gravity đơn giản | Ít, thiếu đa dạng |
| Materials | `MeshStandardMaterial` không PBR | Thiếu glow, không có bloom |
| Nền | `FogExp2` màu xanh tối | Nhàm, thiếu atmosphere |

---

## Phase 1 — Camera System ⭐ (Ưu tiên cao nhất)

**Vấn đề gốc:** `lerp(current, target, 0.055)` tạo ra oscillation — camera không bao giờ settle hoàn toàn.

**Giải pháp:** Thay bằng **critically damped spring** (spring-mass-damper):

```javascript
// Công thức spring-damper
velocity += (target - current) * stiffness * dt
velocity *= damping
current += velocity * dt
```

### Các cải tiến camera:

| Cải tiến | Chi tiết | Code location |
|---|---|---|
| Spring camera Y | `stiffness: 80`, `damping: 0.85` thay lerp | `updateTowerCamera()` |
| Dynamic FOV | Khi pack di chuyển nhanh → FOV tăng nhẹ (60→70°), ease về 60° | `updateTowerCamera()` |
| Orbit easing | Thêm `orbitOffset` sinusoidal nhẹ theo sự kiện để tránh mechanical | `updateTowerCamera()` |
| Event zoom | Khi racer finish → brief zoom-in + pull back (0.3s ease) | `updateTowerRacers()` |
| Slight lag | Camera theo sau pack với 200ms intentional lag để cinematic | `updateTowerCamera()` |

**File thay đổi:** `engine3d.js` — function `updateTowerCamera()`, lines ~560-582

**Config mới thêm vào `config.js`:**
```javascript
camera: {
  orbitSpeed: 0.00032,
  orbitRadius: 24,
  spring: {
    stiffness: 80,
    damping: 0.85,
    lagMs: 200
  },
  dynamicFov: {
    min: 60,
    max: 70,
    speedThreshold: 0.015
  }
}
```

---

## Phase 2 — Lighting & Materials

### Lighting setup mới:

```javascript
// Thay đổi trong buildTowerStructure()
const ambientLight = new THREE.AmbientLight(0x1a0a2e, 0.4); // Tím tối

const directionalLight = new THREE.DirectionalLight(0xfff5e0, 1.2); // Ấm
directionalLight.position.set(20, 60, 20);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.set(2048, 2048);

// Rim light - tạo viền sáng phía sau
const rimLight = new THREE.PointLight(0xff6b35, 0.8, 100);
rimLight.position.set(0, 30, -15);

// Fill light - chiếu sáng mặt trước
const fillLight = new THREE.PointLight(0x4ecdc4, 0.4, 80);
fillLight.position.set(0, 20, 25);

// Lantern point lights - mỗi 8 steps
for (let i = 0; i < numSteps; i += 8) {
  const pos = getHelixPosition(i / numSteps);
  const lanternLight = new THREE.PointLight(0xffa040, 0.6, 6);
  lanternLight.position.set(pos.x, pos.y, pos.z);
  towerScene.add(lanternLight);
}
```

### Materials upgrade:

| Object | Material hiện tại | Material mới |
|---|---|---|
| Pillar | `MeshStandardMaterial` xám | `MeshPhysicalMaterial` + `roughness: 0.3`, `metalness: 0.7`, `color: 0x2a2a3e` |
| Platform | `MeshStandardMaterial` xanh | Emissive glow `#2a4a2a` base, `emissiveIntensity` tăng mạnh khi pulse |
| Fox body | `MeshStandardMaterial` color | Thêm `envMapIntensity: 0.5` để phản chiếu ánh sáng |
| Vines | `MeshBasicMaterial` xanh tối | `MeshStandardMaterial` + `emissive: 0x003300`, `emissiveIntensity: 0.3` |
| Trophy | `MeshStandardMaterial` vàng | `MeshPhysicalMaterial` + `roughness: 0.1`, `metalness: 1.0`, `emissive: 0xffaa00` |

**File thay đổi:** `engine3d.js` — function `buildTowerStructure()`, lines ~210-350

---

## Phase 3 — Post-Processing (Bloom Effect)

Dùng `THREE.EffectComposer` + `UnrealBloomPass` để tạo hiệu ứng phát sáng:

```javascript
// Thêm vào sau khi tạo renderer
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(towerRenderer);
const renderPass = new RenderPass(towerScene, towerCamera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.2,  // strength
  0.8,  // radius
  0.4   // threshold
);
composer.addPass(bloomPass);

// Trong animation loop, thay:
// towerRenderer.render(towerScene, towerCamera);
// Bằng:
composer.render();
```

**Kết quả:** Lanterns, trophy, status aura, particle bursts → phát sáng lung linh thay vì flat.

> **Note:** Load lazy cùng Three.js để không ảnh hưởng fallback 2D.

**File thay đổi:** `engine3d.js` — function `initTowerScene()` và `animateTowerClimb()`

**Config mới:**
```javascript
bloom: {
  enabled: true,
  strength: 1.2,
  radius: 0.8,
  threshold: 0.4
}
```

---

## Phase 4 — Particle & Effects System

### Particle system nâng cấp:

| Effect | Hiện tại | Cải tiến |
|---|---|---|
| Motion trail | Sphere burst | `THREE.BufferGeometry` line trail (30 points) — mượt hơn nhiều |
| Landing dust | 8 particles | Tăng count → 20, thêm ring expand animation |
| Ambient dust | Không có | 200 floating particles drift lên theo tower liên tục (atmosphere) |
| Boost effect | Particle burst vàng | Speed lines dọc theo hướng di chuyển + glow trail |
| Finish burst | Không có | Confetti explosion (200 quads màu random, physics nhẹ) |
| Screen shake | Không có | Micro shake (±2px) khi trap event, mạnh hơn khi finish |

### Motion Trail Implementation:

```javascript
// Thay createTowerMotionTrail()
function createMotionTrail(racer, color) {
  const positions = new Float32Array(30 * 3); // 30 points
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const material = new THREE.LineBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.6,
    linewidth: 2
  });
  
  const trail = new THREE.Line(geometry, material);
  racer.trail = { mesh: trail, positions: [], maxLength: 30 };
  towerScene.add(trail);
}

// Update trong animateTowerClimb()
function updateTrails() {
  towerRacers.forEach(racer => {
    if (!racer.trail) return;
    
    // Add current position
    racer.trail.positions.push(racer.mesh.position.clone());
    if (racer.trail.positions.length > racer.trail.maxLength) {
      racer.trail.positions.shift();
    }
    
    // Update geometry
    const positions = racer.trail.mesh.geometry.attributes.position.array;
    racer.trail.positions.forEach((pos, i) => {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
    });
    racer.trail.mesh.geometry.attributes.position.needsUpdate = true;
  });
}
```

### Ambient Dust Implementation:

```javascript
// Thêm vào buildTowerStructure()
function createAmbientDust() {
  const dustCount = 200;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(dustCount * 3);
  const velocities = [];
  
  for (let i = 0; i < dustCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 15;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * TOWER_CONFIG.tower.height;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    velocities.push(Math.random() * 0.01 + 0.005); // Upward velocity
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const material = new THREE.PointsMaterial({
    color: 0xaaffaa,
    size: 0.1,
    transparent: true,
    opacity: 0.3
  });
  
  const dust = new THREE.Points(geometry, material);
  towerScene.add(dust);
  
  return { mesh: dust, velocities };
}

// Update trong animateTowerClimb()
function updateAmbientDust(ambientDust) {
  const positions = ambientDust.mesh.geometry.attributes.position.array;
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 1] += ambientDust.velocities[i];
    
    // Wrap around when reaching top
    if (positions[i * 3 + 1] > TOWER_CONFIG.tower.height) {
      positions[i * 3 + 1] = 0;
    }
  }
  ambientDust.mesh.geometry.attributes.position.needsUpdate = true;
}
```

### Screen Shake:

```javascript
// Thêm vào config
screenShake: {
  enabled: true,
  intensity: 2,
  duration: 300,
  decay: 0.9
}

// Thêm biến global
let shakeOffset = { x: 0, y: 0 };
let shakeVelocity = { x: 0, y: 0 };

// Function trigger shake
function triggerScreenShake(intensity = 1) {
  shakeVelocity.x = (Math.random() - 0.5) * intensity * TOWER_CONFIG.screenShake.intensity;
  shakeVelocity.y = (Math.random() - 0.5) * intensity * TOWER_CONFIG.screenShake.intensity;
}

// Update trong animateTowerClimb()
function updateScreenShake() {
  shakeOffset.x += shakeVelocity.x;
  shakeOffset.y += shakeVelocity.y;
  shakeVelocity.x *= TOWER_CONFIG.screenShake.decay;
  shakeVelocity.y *= TOWER_CONFIG.screenShake.decay;
  
  towerCamera.position.x += shakeOffset.x;
  towerCamera.position.y += shakeOffset.y;
  
  // Reset for next frame
  shakeOffset.x *= 0.5;
  shakeOffset.y *= 0.5;
}
```

**File thay đổi:** `engine3d.js` — nhiều functions

---

## Phase 5 — Background & Atmosphere

### Gradient Sky Shader:

```javascript
// Thay fog bằng sky sphere với gradient shader
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
      vec3 topColor = vec3(0.04, 0.0, 0.125);    // #0a0020
      vec3 midColor = vec3(0.1, 0.04, 0.24);     // #1a0a3e
      vec3 bottomColor = vec3(0.18, 0.1, 0.3);   // #2d1b4e
      
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
}
```

### Stars:

```javascript
function createStars() {
  const starCount = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const offsets = new Float32Array(starCount); // For twinkle effect
  
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 150;
    
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
    
    offsets[i] = Math.random() * Math.PI * 2;
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
  
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true
  });
  
  // Custom shader để twinkle
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `
      attribute float offset;
      uniform float time;
      varying float vAlpha;
      void main() {
        vAlpha = 0.5 + 0.5 * sin(time + offset);
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
      varying float vAlpha;
      void main() {
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a * vAlpha );'
    );
    shader.uniforms.time = { value: 0 };
    
    // Store reference để update
    material.userData.shader = shader;
  };
  
  const stars = new THREE.Points(geometry, material);
  towerScene.add(stars);
  
  return stars;
}

// Update trong animateTowerClimb()
if (stars.material.userData.shader) {
  stars.material.userData.shader.uniforms.time.value = now * 0.001;
}
```

### Clouds:

```javascript
async function createClouds() {
  // Tạo canvas texture cho cloud
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // Draw soft cloud shape
  const gradient = ctx.createRadialGradient(256, 256, 50, 256, 256, 256);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  
  const texture = new THREE.CanvasTexture(canvas);
  const clouds = [];
  
  for (let i = 0; i < 4; i++) {
    const geometry = new THREE.PlaneGeometry(20, 10);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    });
    
    const cloud = new THREE.Mesh(geometry, material);
    const angle = (i / 4) * Math.PI * 2;
    cloud.position.set(
      Math.cos(angle) * 30,
      15 + Math.random() * 10,
      Math.sin(angle) * 30
    );
    cloud.userData.speed = 0.005 + Math.random() * 0.005;
    cloud.userData.angle = angle;
    
    towerScene.add(cloud);
    clouds.push(cloud);
  }
  
  return clouds;
}

// Update trong animateTowerClimb()
function updateClouds(clouds, now) {
  clouds.forEach(cloud => {
    cloud.userData.angle += cloud.userData.speed;
    cloud.position.x = Math.cos(cloud.userData.angle) * 30;
    cloud.position.z = Math.sin(cloud.userData.angle) * 30;
    cloud.lookAt(towerCamera.position);
  });
}
```

### Mist Pool at Base:

```javascript
function createMistPool() {
  const geometry = new THREE.CircleGeometry(25, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x88ff88,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide
  });
  
  const mist = new THREE.Mesh(geometry, material);
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = 0.5;
  towerScene.add(mist);
  
  return mist;
}

// Update trong animateTowerClimb()
function updateMist(mist, now) {
  const scale = 1 + 0.1 * Math.sin(now * 0.0005);
  mist.scale.set(scale, scale, 1);
  mist.material.opacity = 0.2 + 0.1 * Math.sin(now * 0.0008);
}
```

**File thay đổi:** `engine3d.js` — function `buildTowerStructure()`

---

## Phase 6 — HUD/Leaderboard UI

**Không cần thay đổi trong engine3d.js** — đây là CSS/HTML changes trong parent shell.

### CSS improvements:

```css
.tower-leaderboard {
  backdrop-filter: blur(10px);
  background: linear-gradient(135deg, 
    rgba(26, 10, 46, 0.8) 0%, 
    rgba(10, 0, 32, 0.9) 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.tower-racer-row {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  padding: 8px 12px;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.tower-racer-row:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateX(4px);
}

.tower-racer-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  margin-right: 12px;
  border: 2px solid currentColor;
}

.tower-progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.tower-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ecdc4, #44a3d5);
  transition: width 0.3s ease;
  box-shadow: 0 0 8px rgba(78, 205, 196, 0.6);
}
```

**File thay đổi:** Parent HTML/CSS (không phải trong tower-climb folder)

---

## Thứ tự thực hiện đề xuất

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
Camera   Light     Bloom     VFX       BG        HUD
 (1h)     (1h)     (1.5h)    (2h)      (1h)      (1h)
```

### Lý do ưu tiên Phase 1:

Camera mượt là cảm nhận quan trọng nhất khi xem. Các phase sau chỉ là visual enhancement.

---

## Checklist thực hiện

- [ ] **Phase 1:** Spring camera system
  - [ ] Thêm config spring vào `config.js`
  - [ ] Implement spring damper trong `updateTowerCamera()`
  - [ ] Dynamic FOV based on pack speed
  - [ ] Event zoom on finish
  - [ ] Test mượt mà không jitter

- [ ] **Phase 2:** Lighting & Materials
  - [ ] Setup 4-point lighting (ambient, directional, rim, fill)
  - [ ] Lantern point lights mỗi 8 steps
  - [ ] Upgrade materials sang Physical/Standard với PBR
  - [ ] Test shadows và reflections

- [ ] **Phase 3:** Bloom post-processing
  - [ ] Load EffectComposer, RenderPass, UnrealBloomPass
  - [ ] Configure bloom parameters
  - [ ] Replace render() với composer.render()
  - [ ] Test performance impact

- [ ] **Phase 4:** Particle & Effects
  - [ ] Motion trail với BufferGeometry lines
  - [ ] Enhanced landing dust (20 particles + ring)
  - [ ] Ambient dust system (200 floating particles)
  - [ ] Speed lines cho boost
  - [ ] Confetti explosion on finish
  - [ ] Screen shake system
  - [ ] Test particle pool performance

- [ ] **Phase 5:** Background & Atmosphere
  - [ ] Sky gradient shader sphere
  - [ ] Twinkling stars (500 points)
  - [ ] Drifting clouds (4 planes)
  - [ ] Mist pool at base
  - [ ] Remove old fog
  - [ ] Test render order

- [ ] **Phase 6:** HUD/Leaderboard
  - [ ] Backdrop blur + gradient background
  - [ ] Avatar icons per racer
  - [ ] Smooth position transitions
  - [ ] Progress bars
  - [ ] Hover effects
  - [ ] Test với 40 racers

---

## Performance Considerations

| Optimizations | Chi tiết |
|---|---|
| Particle pooling | Reuse particle objects thay vì create/destroy |
| LOD clouds | Chỉ render clouds khi camera gần |
| Conditional bloom | Disable bloom trên low-end devices |
| Throttle trail updates | Update trail mỗi 2-3 frames thay vì mỗi frame |
| Shadow map resolution | Giữ 2048x2048, không tăng cao hơn |

---

## Fallback 2D Enhancements (Bonus)

Nếu có thời gian, cải thiện fallback2d.js:

- [ ] Gradient background 3 màu giống 3D sky
- [ ] Glow intensity cao hơn (shadowBlur tăng 20→30)
- [ ] Particle count tăng gấp đôi
- [ ] Smooth camera follow với spring (tương tự 3D)
- [ ] CSS backdrop-filter cho leaderboard

---

## Testing Plan

1. **Visual regression:** Screenshot trước/sau mỗi phase
2. **Performance:** Đo FPS với 40 racers, target 60fps stable
3. **Cross-browser:** Test Chrome, Firefox, Safari
4. **Mobile:** Test trên phone/tablet (fallback 2D)
5. **Fallback:** Force disable WebGL để test 2D path

---

## Notes

- Tất cả Three.js postprocessing imports phải lazy load cùng Three.js main
- Không breaking changes cho fallback 2D
- Config values đều ở `config.js` để dễ tweak
- Commit sau mỗi phase để dễ rollback nếu cần
