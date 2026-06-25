export const BEAST_FACE_EXPRESSIONS = [
  "sad",
  "happy",
  "squint",
  "angry",
  "cute",
  "silly",
  "wibu",
  "cat3",
  "flat",
  "smile"
];

export const BEAST_AWARD_IDLE_ACTIONS = [
  "stand",
  "lie",
  "lazy",
  "sit",
  "lickPaw",
  "spin",
  "chaseTail",
  "teaseNeighbor"
];

function chooseRandom(list, fallback) {
  return list.length ? list[Math.floor(Math.random() * list.length)] : fallback;
}

function makeMaterial(THREE, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: options.emissive || color,
    emissiveIntensity: options.emissiveIntensity ?? 0.12,
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.05,
    transparent: Boolean(options.transparent),
    opacity: options.opacity ?? 1,
    polygonOffset: Boolean(options.polygonOffset),
    polygonOffsetFactor: options.polygonOffsetFactor ?? 0,
    polygonOffsetUnits: options.polygonOffsetUnits ?? 0
  });
  return material;
}

function recordBasePose(part) {
  if (!part) return;
  part.userData.basePosition = part.position.clone();
  part.userData.baseRotation = part.rotation.clone();
  part.userData.baseScale = part.scale.clone();
}

function resetPart(part) {
  if (!part?.userData?.basePosition) return;
  part.position.copy(part.userData.basePosition);
  part.rotation.copy(part.userData.baseRotation);
  part.scale.copy(part.userData.baseScale);
}

function resetParts(parts) {
  parts.forEach(resetPart);
}

function setEye(eye, options = {}) {
  if (!eye) return;
  eye.visible = options.visible !== false;
  eye.scale.set(options.scaleX ?? 1, options.scaleY ?? 1, options.scaleZ ?? 1);
  eye.rotation.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0);
  if (typeof options.y === "number") eye.position.y = eye.userData.basePosition.y + options.y;
  if (typeof options.z === "number") eye.position.z = eye.userData.basePosition.z + options.z;
}

function setBrow(brow, options = {}) {
  if (!brow) return;
  brow.visible = options.visible !== false;
  brow.scale.set(options.scaleX ?? 1, options.scaleY ?? 1, options.scaleZ ?? 1);
  brow.rotation.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0);
  if (typeof options.y === "number") brow.position.y = brow.userData.basePosition.y + options.y;
}

function setMouth(mouth, options = {}) {
  if (!mouth) return;
  mouth.visible = options.visible !== false;
  mouth.scale.set(options.scaleX ?? 1, options.scaleY ?? 1, options.scaleZ ?? 1);
  mouth.rotation.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0);
  if (typeof options.y === "number") mouth.position.y = mouth.userData.basePosition.y + options.y;
  if (typeof options.x === "number") mouth.position.x = mouth.userData.basePosition.x + options.x;
}

export function applyBeastFace(beast, expression = null) {
  if (!beast?.userData) return null;
  const face = expression || chooseRandom(BEAST_FACE_EXPRESSIONS, "happy");
  const { eyes = [], brows = [], mouth, mouthAlt, cheeks = [] } = beast.userData;

  resetParts([...eyes, ...brows, mouth, mouthAlt, ...cheeks].filter(Boolean));
  eyes.forEach((eye) => setEye(eye, { scaleX: 1, scaleY: 1, scaleZ: 1 }));
  brows.forEach((brow) => setBrow(brow, { visible: true }));
  setMouth(mouth, { visible: true });
  setMouth(mouthAlt, { visible: false });
  cheeks.forEach((cheek) => { cheek.visible = false; });

  if (face === "sad") {
    setEye(eyes[0], { scaleY: 0.72, y: -0.01, rotZ: -0.08 });
    setEye(eyes[1], { scaleY: 0.72, y: -0.01, rotZ: 0.08 });
    setBrow(brows[0], { rotZ: -0.34, y: -0.015 });
    setBrow(brows[1], { rotZ: 0.34, y: -0.015 });
    setMouth(mouth, { scaleX: 0.75, scaleY: 0.7, rotZ: Math.PI, y: -0.018 });
  } else if (face === "squint") {
    eyes.forEach((eye) => setEye(eye, { scaleY: 0.18, scaleX: 1.35 }));
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 0.9, scaleY: 0.55, y: 0.005 });
  } else if (face === "angry") {
    setEye(eyes[0], { scaleY: 0.62, rotZ: 0.16 });
    setEye(eyes[1], { scaleY: 0.62, rotZ: -0.16 });
    setBrow(brows[0], { rotZ: 0.42, y: -0.01 });
    setBrow(brows[1], { rotZ: -0.42, y: -0.01 });
    setMouth(mouth, { scaleX: 0.68, scaleY: 0.5, rotZ: Math.PI, y: -0.01 });
  } else if (face === "cute") {
    eyes.forEach((eye) => setEye(eye, { scaleX: 1.28, scaleY: 1.28, y: 0.01 }));
    cheeks.forEach((cheek) => { cheek.visible = true; });
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 0.65, scaleY: 0.55, y: 0.008 });
  } else if (face === "silly") {
    setEye(eyes[0], { scaleX: 1.28, scaleY: 0.82, y: 0.015 });
    setEye(eyes[1], { scaleX: 0.75, scaleY: 1.35, y: -0.01 });
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 0.95, scaleY: 1.45, rotZ: 0.22, x: 0.015 });
  } else if (face === "wibu") {
    eyes.forEach((eye) => setEye(eye, { scaleX: 1.45, scaleY: 1.05, rotZ: eye.position.x < 0 ? -0.28 : 0.28 }));
    cheeks.forEach((cheek) => { cheek.visible = true; });
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 0.78, scaleY: 0.5, y: 0.01 });
    setMouth(mouthAlt, { visible: true, scaleX: 0.5, scaleY: 0.55, y: 0.012 });
  } else if (face === "cat3") {
    eyes.forEach((eye) => setEye(eye, { scaleY: 0.45, scaleX: 1.1, rotZ: eye.position.x < 0 ? -0.16 : 0.16 }));
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 0.42, scaleY: 1.1, rotZ: 0.42, x: -0.025 });
    setMouth(mouthAlt, { visible: true, scaleX: 0.42, scaleY: 1.1, rotZ: -0.42, x: 0.025 });
  } else if (face === "flat") {
    eyes.forEach((eye) => setEye(eye, { scaleY: 0.2, scaleX: 1.2 }));
    brows.forEach((brow) => setBrow(brow, { visible: false }));
    setMouth(mouth, { scaleX: 1.05, scaleY: 0.22, rotZ: 0 });
  } else {
    eyes.forEach((eye) => setEye(eye, { scaleX: 1, scaleY: 1 }));
    setBrow(brows[0], { rotZ: -0.12 });
    setBrow(brows[1], { rotZ: 0.12 });
    setMouth(mouth, { scaleX: face === "smile" ? 0.95 : 0.72, scaleY: 0.58, y: 0.008 });
  }

  beast.userData.faceExpression = face;
  return face;
}

export function createBeastWolfModel(THREE, color, options = {}) {
  const beast = new THREE.Group();
  beast.name = options.name || "shared-beast-wolf";

  const bodyMat = makeMaterial(THREE, color, {
    emissiveIntensity: options.emissiveIntensity ?? 0.22,
    roughness: 0.58
  });
  const darkMat = makeMaterial(THREE, "#111827", {
    emissive: "#020617",
    emissiveIntensity: 0.08,
    roughness: 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const lightMat = makeMaterial(THREE, "#e5e7eb", { roughness: 0.55 });
  const cheekMat = makeMaterial(THREE, "#f9a8d4", {
    emissive: "#fb7185",
    emissiveIntensity: 0.16,
    roughness: 0.64,
    transparent: true,
    opacity: 0.82
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.92), bodyMat);
  body.position.set(0, 0.56, 0);
  body.scale.set(1, 0.82, 1);
  beast.add(body);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.22), lightMat);
  chest.position.set(0, 0.54, -0.36);
  beast.add(chest);

  const head = new THREE.Group();
  head.name = "wolf-head-rig";
  head.position.set(0, 0.77, -0.58);
  beast.add(head);

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), bodyMat);
  head.add(headMesh);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.24), lightMat);
  snout.position.set(0, -0.05, -0.29);
  head.add(snout);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), darkMat);
  nose.position.set(0, -0.04, -0.44);
  head.add(nose);

  const earGeo = new THREE.BoxGeometry(0.14, 0.18, 0.08);
  const leftEar = new THREE.Mesh(earGeo, bodyMat);
  leftEar.position.set(-0.15, 0.21, 0);
  leftEar.rotation.set(0.1, 0, -0.38);
  head.add(leftEar);

  const rightEar = leftEar.clone();
  rightEar.position.x = 0.15;
  rightEar.rotation.z = 0.38;
  head.add(rightEar);

  const eyeGeo = new THREE.BoxGeometry(0.07, 0.07, 0.018);
  const leftEye = new THREE.Mesh(eyeGeo, darkMat);
  leftEye.position.set(-0.105, 0.035, -0.232);
  head.add(leftEye);

  const rightEye = leftEye.clone();
  rightEye.position.x = 0.105;
  head.add(rightEye);

  const browGeo = new THREE.BoxGeometry(0.12, 0.024, 0.018);
  const leftBrow = new THREE.Mesh(browGeo, darkMat);
  leftBrow.position.set(-0.105, 0.105, -0.238);
  head.add(leftBrow);

  const rightBrow = leftBrow.clone();
  rightBrow.position.x = 0.105;
  head.add(rightBrow);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.028, 0.026), darkMat);
  mouth.position.set(0, -0.105, -0.425);
  head.add(mouth);

  const mouthAlt = mouth.clone();
  mouthAlt.visible = false;
  mouthAlt.position.x = 0.035;
  head.add(mouthAlt);

  const cheekGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
  leftCheek.position.set(-0.15, -0.08, -0.35);
  leftCheek.scale.set(1, 0.62, 0.28);
  leftCheek.visible = false;
  head.add(leftCheek);

  const rightCheek = leftCheek.clone();
  rightCheek.position.x = 0.15;
  head.add(rightCheek);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.42), bodyMat);
  tail.position.set(0, 0.64, 0.56);
  tail.rotation.x = -0.48;
  beast.add(tail);

  const legGeo = new THREE.BoxGeometry(0.14, 0.36, 0.16);
  const legPositions = [
    [-0.2, 0.27, -0.28],
    [0.2, 0.27, -0.28],
    [-0.2, 0.27, 0.32],
    [0.2, 0.27, 0.32]
  ];
  const legs = legPositions.map((pos, idx) => {
    const leg = new THREE.Mesh(legGeo, darkMat);
    leg.position.set(pos[0], pos[1], pos[2]);
    leg.name = "wolf-leg-" + idx;
    beast.add(leg);
    return leg;
  });

  const parts = [
    body, chest, head, headMesh, snout, nose, leftEar, rightEar, leftEye, rightEye,
    leftBrow, rightBrow, mouth, mouthAlt, leftCheek, rightCheek, tail,
    ...legs
  ];
  parts.forEach(recordBasePose);

  const baseScale = options.scale ?? 1;
  beast.scale.setScalar(baseScale);
  beast.userData = {
    ...beast.userData,
    body,
    chest,
    head,
    headMesh,
    snout,
    nose,
    ears: [leftEar, rightEar],
    eyes: [leftEye, rightEye],
    brows: [leftBrow, rightBrow],
    mouth,
    mouthAlt,
    cheeks: [leftCheek, rightCheek],
    tail,
    legs,
    parts,
    baseScale,
    groundClearance: options.groundClearance ?? 0.02,
    footBottomY: 0.09 * baseScale,
    awardIdleAction: options.awardIdleAction || chooseRandom(BEAST_AWARD_IDLE_ACTIONS, "stand")
  };

  applyBeastFace(beast, options.expression);
  return beast;
}

export function getBeastGroundClearance(beast, fallback = 0.02) {
  if (!beast?.userData) return fallback;
  const value = Number(beast.userData.groundClearance);
  return Number.isFinite(value) ? value : fallback;
}

export function getBeastSurfaceOffset(beast, fallbackClearance = 0.02) {
  if (!beast?.userData) return fallbackClearance;
  const clearance = getBeastGroundClearance(beast, fallbackClearance);
  const footBottomY = Number(beast.userData.footBottomY);
  return clearance - (Number.isFinite(footBottomY) ? footBottomY : 0);
}

export function chooseBeastAwardIdleAction() {
  return chooseRandom(BEAST_AWARD_IDLE_ACTIONS, "stand");
}

export function resetBeastPose(beast) {
  if (!beast?.userData?.parts) return;
  resetParts(beast.userData.parts);
  beast.position.set(0, 0, 0);
  beast.rotation.set(0, beast.rotation.y || 0, 0);
  beast.scale.setScalar(beast.userData.baseScale || 1);
}

function applySitPose(beast) {
  const { body, head, tail, tailTip, legs = [] } = beast.userData;
  if (body) {
    body.rotation.x = -0.24;
    body.position.y -= 0.08;
  }
  if (head) {
    head.rotation.x = 0.16;
    head.position.y -= 0.02;
  }
  legs.forEach((leg, index) => {
    leg.rotation.x = index < 2 ? -0.55 : 0.78;
    leg.position.y -= index < 2 ? 0.02 : 0.12;
  });
  if (tail) tail.rotation.x = -0.25;
  if (tailTip) tailTip.rotation.x = -0.25;
}

function applyLiePose(beast, lazy = false) {
  const { body, head, tail, tailTip, legs = [] } = beast.userData;
  if (body) {
    body.rotation.x = -0.06;
    body.position.y -= lazy ? 0.21 : 0.24;
    body.scale.y = 0.72;
  }
  if (head) {
    head.position.y -= lazy ? 0.16 : 0.2;
    head.rotation.x = lazy ? 0.24 : 0.1;
  }
  legs.forEach((leg, index) => {
    leg.rotation.x = index % 2 === 0 ? 1.15 : -1.15;
    leg.position.y -= 0.18;
    leg.position.z += index < 2 ? -0.05 : 0.07;
  });
  if (tail) tail.rotation.x = -0.12;
  if (tailTip) tailTip.rotation.x = -0.12;
}

function applyLickPawPose(beast, wave) {
  const { head, legs = [], tail, tailTip } = beast.userData;
  if (head) {
    head.rotation.x = 0.24 + wave * 0.08;
    head.rotation.z = 0.12;
  }
  if (legs[0]) {
    legs[0].rotation.x = -1.1 + wave * 0.25;
    legs[0].rotation.z = -0.24;
    legs[0].position.y += 0.08;
    legs[0].position.z -= 0.08;
  }
  if (legs[1]) legs[1].rotation.x = -0.16;
  if (tail) tail.rotation.x = -0.5 + wave * 0.12;
  if (tailTip) tailTip.rotation.x = -0.5 + wave * 0.12;
}

export function updateBeastIdlePose(beast, action = "stand", now = 0, options = {}) {
  if (!beast?.userData) return;
  const phase = now * 0.004 + (options.seed || 0);
  const wave = Math.sin(phase);
  const slowWave = Math.sin(phase * 0.43);
  const lockFacing = Boolean(options.lockFacing);
  resetBeastPose(beast);

  const { body, head, tail, tailTip, legs = [] } = beast.userData;
  beast.position.y = 0;
  beast.rotation.x = 0;
  beast.rotation.z = 0;

  if (action === "sit") {
    applySitPose(beast);
  } else if (action === "lie") {
    applyLiePose(beast, false);
  } else if (action === "lazy") {
    applyLiePose(beast, true);
    if (head) head.rotation.z = slowWave * 0.12;
  } else if (action === "lickPaw") {
    applySitPose(beast);
    applyLickPawPose(beast, wave);
  } else if (action === "spin") {
    if (lockFacing) {
      if (body) body.rotation.y = wave * 0.28;
      if (head) head.rotation.y = -wave * 0.34;
      legs.forEach((leg, index) => {
        leg.rotation.x = Math.sin(phase * 1.8 + index * Math.PI) * 0.18;
      });
    } else {
      beast.rotation.y = phase * 0.75;
    }
    if (body) body.rotation.z = wave * 0.035;
  } else if (action === "chaseTail") {
    if (!lockFacing) beast.rotation.y = phase * 1.15;
    if (body) body.rotation.z = wave * 0.12;
    if (head) head.rotation.y = 0.35 + wave * 0.12;
    legs.forEach((leg, index) => {
      leg.rotation.x = Math.sin(phase * 2.2 + index * Math.PI) * 0.28;
    });
  } else if (action === "teaseNeighbor") {
    beast.rotation.z = wave * 0.045;
    if (head) {
      head.rotation.y = (options.neighborSide || 1) * (0.34 + Math.abs(slowWave) * 0.12);
      head.rotation.z = (options.neighborSide || 1) * 0.08;
    }
    if (body) body.rotation.z = (options.neighborSide || 1) * 0.035;
  } else {
    if (head) head.rotation.x = 0.05 + slowWave * 0.05;
  }

  if (tail) tail.rotation.x = (tail.userData.baseRotation?.x ?? -0.62) + Math.sin(phase * 1.2) * 0.14;
  if (tailTip) tailTip.rotation.x = (tailTip.userData.baseRotation?.x ?? -0.62) + Math.sin(phase * 1.2) * 0.14;

  if (action === "stand") {
    legs.forEach((leg, index) => {
      leg.rotation.x = Math.sin(phase * 0.8 + index * Math.PI) * 0.045;
    });
  }
}
