// Blue Archive Memorial Lobby - Lively Wallpaper Engine (Joe's Architecture Faithful)
// Butter-smooth gaze easing (dt-based), Full Action Blocking, Cheek Pinch & Hand Follow, Headpatting, Floating Settings UI.

const CDN_BASE = "https://aronabot.cdn.nimblebun.works/v2/images/students/memorial-lobby";
let CAMERA = {
  x: -1366,
  y: -1986,
  width: 2732,
  height: 2048,
};

// Tracks matching ba-tools (Joe's source)
const TRACK_BASE = 0;
const TRACK_TALK_BODY = 20;
const TRACK_TALK_MOUTH = 21;
const TRACK_TOUCH_MOUTH = 22;
const TRACK_TOUCH_BODY = 23;

// Reaction tracks set for action blocking
let reactionTracks = new Set([
  TRACK_TALK_BODY,
  TRACK_TALK_MOUTH,
  TRACK_TOUCH_MOUTH,
  TRACK_TOUCH_BODY,
]);

// Gaze and Touch Physics Constants (Joe's exact measurements)
const LOOK_RESPONSIVENESS = 10;
const LOOK_MAX_OFFSET = 0.05;
const LOOK_SATURATION_DISTANCE = 0.35;
const PAT_ZONE_CENTER = 1.7;
const PAT_ZONE_RADIUS = 1.7;
const CHEEK_ZONE_CENTER = -0.35;
const CHEEK_ZONE_RADIUS = 0.85;
const HAND_ZONE_RADIUS = 1.3;
const HAND_MAX_OFFSET = 1.0;
const FINGER_ZONE_RADIUS = 0.8;
const CHEEK_MAX_STRETCH = 0.35;
const CHEEK_SIDEWAYS_STRETCH = 0.5;

let app = null;
let sceneContainer = null;
let activeSpines = [];
let activeBaseTextures = [];
let mainSpine = null;
let sceneData = null;
let loadToken = 0;
let currentStudentId = null;

let eyeBone = null;
let headBone = null;
let crownBone = null;
let lookApplied = null;
let lookTarget = null;
let lookOffset = { x: 0, y: 0 };
let lastLookUpdate = null;

// Cheek & Hand interaction state
let cheekPrefix = null;
let handBone = null;
let handSpotSlots = [];
let cheekDragBones = [];
let touchMode = null; // "pat" | "cheek" | "hand" | "look" | null
let currentTouchVariant = "";
let dragBone = null;
let dragRest = null;
let dragLimit = 0;
let dragOutward = null;
let dragOffset = { x: 0, y: 0 };
let dragApplied = null;

// Touch & Action Blocking State (Joe's engine faithful)
let introFinished = false;
let blockedUntil = 0;
let randomIdleAt = new Map();
let isPointerDown = false;
let activeTouchArea = null;
let activeAreaSince = 0;
let activeAreaTriggered = false;
let draggedBones = new Map(); // bone -> { area, bone, position, saved }
let hoverIdleTimer = null;

// Settings (persisted to localStorage) - Interaction: enabled (cheeks, hand, pat, click) or disabled
const savedInteraction = localStorage.getItem("ba_interaction") || localStorage.getItem("ba_gaze");
let settings = {
  studentId: localStorage.getItem("ba_student") || "aru",
  interaction: (savedInteraction === "off" || savedInteraction === "disabled") ? "disabled" : "enabled",
  get gazeMode() { return this.interaction; },
  set gazeMode(val) { this.interaction = val; },
  fpsLimit: Number(localStorage.getItem("ba_fps")) || 60,
  enableLook: true,
  enablePat: true,
};

const loadingEl = document.getElementById("loading");

function setLoading(text) {
  if (!loadingEl) return;
  if (text) {
    loadingEl.textContent = text;
    loadingEl.style.opacity = "1";
  } else {
    loadingEl.style.opacity = "0";
  }
}

const clamp = (val, min, max) =>
  Math.min(Math.max(val, Math.min(min, max)), Math.max(min, max));

function isInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Check if player is actively interacting
function isInteracting() {
  if (touchMode !== null || isPointerDown || activeTouchArea !== null) return true;
  if (!mainSpine) return false;

  const state = mainSpine.state;
  for (const track of reactionTracks) {
    const entry = state.getCurrent(track);
    if (entry && entry.animation && entry.animation.name !== "<empty>" && !entry.isComplete()) {
      return true;
    }
  }
  return false;
}

function canTouch() {
  if (settings.interaction === "disabled" || !settings.enablePat) return false;
  const now = performance.now() / 1000;
  return introFinished && now >= blockedUntil;
}

function applyFpsLimit(fps) {
  const limit = Number(fps) || 60;
  if (app && app.ticker) {
    app.ticker.maxFPS = limit;
  }
  if (window.PIXI && PIXI.Ticker && PIXI.Ticker.shared) {
    PIXI.Ticker.shared.maxFPS = limit;
  }
}

// 1. Initialize Pixi Application
function initApp() {
  const canvas = document.getElementById("canvas");

  app = new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundColor: 0x050505,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    sharedTicker: true,
  });

  applyFpsLimit(settings.fpsLimit);

  sceneContainer = new PIXI.Container();
  app.stage.addChild(sceneContainer);

  app.ticker.add(() => {
    updateRandomIdle();
    updateTouchTrigger();
  });

  window.addEventListener("resize", onResize);
  setupInputHandlers();
  setupMenuUI();
  setupStudentBoardUI();

  loadStudentLobby(settings.studentId);
}

// 2. Load Memorial Lobby
async function loadStudentLobby(studentId) {
  const token = ++loadToken;
  const isStale = () => token !== loadToken;
  currentStudentId = studentId;

  setLoading(`Loading ${studentId}...`);
  introFinished = false;
  blockedUntil = 0;
  randomIdleAt.clear();
  draggedBones.clear();
  activeTouchArea = null;
  activeAreaTriggered = false;
  touchMode = null;
  dragBone = null;
  dragRest = null;
  dragLimit = 0;
  dragOutward = null;
  dragOffset = { x: 0, y: 0 };
  dragApplied = null;
  cheekPrefix = null;
  handBone = null;
  handSpotSlots = [];
  cheekDragBones = [];
  currentTouchVariant = "";
  document.body.style.cursor = "default";

  try {
    activeSpines.forEach((s) => {
      sceneContainer.removeChild(s);
      s.destroy({ children: true });
    });
    activeSpines = [];
    activeBaseTextures.forEach((bt) => {
      try {
        bt.destroy(true);
      } catch (_) {}
    });
    activeBaseTextures = [];
    mainSpine = null;
    sceneData = null;
    eyeBone = null;
    headBone = null;
    crownBone = null;
    lookApplied = null;
    lookTarget = null;
    lookOffset = { x: 0, y: 0 };
    lastLookUpdate = null;

    reactionTracks = new Set([
      TRACK_TALK_BODY,
      TRACK_TALK_MOUTH,
      TRACK_TOUCH_MOUTH,
      TRACK_TOUCH_BODY,
    ]);

    const base = `${CDN_BASE}/${studentId}`;
    const res = await fetch(`${base}/manifest.json`);
    if (isStale()) return;
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching manifest`);
    const manifest = await res.json();
    if (isStale()) return;

    const lobby = manifest.lobbies[0];
    if (!lobby || !lobby.skeletons || lobby.skeletons.length === 0) {
      throw new Error("Invalid lobby manifest");
    }

    sceneData = lobby.scene || null;

    if (sceneData?.camera) {
      CAMERA = {
        x: sceneData.camera.x,
        y: -(sceneData.camera.y + sceneData.camera.height),
        width: sceneData.camera.width,
        height: sceneData.camera.height,
      };
    } else {
      CAMERA = {
        x: -1366,
        y: -1986,
        width: 2732,
        height: 2048,
      };
    }

    collectReactionTracks();

    const sorted = [...lobby.skeletons].sort((a, b) => {
      const isBg = (s) => s.role === "scene" || s.role === "background" || /scene|bg/i.test(s.skel);
      return (isBg(a) ? 0 : 1) - (isBg(b) ? 0 : 1);
    });

    for (const skelConfig of sorted) {
      const atlasUrl = skelConfig.atlasUrl || `${base}/${skelConfig.atlas}`;
      const skelUrl = skelConfig.skelUrl || `${base}/${skelConfig.skel}`;

      const [atlasText, skelBuffer] = await Promise.all([
        fetch(atlasUrl).then((r) => r.text()),
        fetch(skelUrl).then((r) => r.arrayBuffer()),
      ]);
      if (isStale()) return;

      const atlas = new spine.TextureAtlas(atlasText);

      await Promise.all(
        atlas.pages.map(async (page) => {
          const textureUrl = skelConfig.textureUrls?.[page.name] || `${base}/${page.name}`;
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = () => rej(new Error(`Failed to load ${textureUrl}`));
            img.src = textureUrl;
          });

          const baseTexture = PIXI.BaseTexture.from(img, {
            alphaMode: page.pma ? PIXI.ALPHA_MODES.PMA : PIXI.ALPHA_MODES.UNPACK,
          });
          activeBaseTextures.push(baseTexture);
          page.setTexture(spine.SpineTexture.from(baseTexture));
        })
      );
      if (isStale()) return;

      const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);
      const binary = new spine.SkeletonBinary(attachmentLoader);
      const skeletonData = binary.readSkeletonData(new Uint8Array(skelBuffer));

      const spineInstance = new spine.Spine({
        skeletonData,
        autoUpdate: true,
      });

      spineInstance.state.data.defaultMix = 0.25;

      const isMain =
        skelConfig.role === "character" ||
        skelConfig.role === "main" ||
        !/scene|bg/i.test(skelConfig.skel);

      if (isMain || !mainSpine) {
        mainSpine = spineInstance;
      }

      playAnimations(spineInstance, isMain);
      sceneContainer.addChild(spineInstance);
      activeSpines.push(spineInstance);
    }

    if (mainSpine) {
      setupBones(mainSpine);
    }

    onResize();
    setLoading(null);
  } catch (err) {
    if (isStale()) return;
    currentStudentId = null;
    console.error("Failed to load lobby:", err);
    setLoading(`Error loading ${studentId}: ${err.message}`);
  }
}

function collectReactionTracks() {
  const controller = sceneData?.controller;
  if (!controller) return;

  const seen = new Set();
  const visit = (idx) => {
    if (idx === null || idx === undefined || seen.has(idx)) return;
    seen.add(idx);
    const clip = controller.clips[idx];
    if (!clip) return;
    reactionTracks.add(clip.track);
    visit(clip.next);
    if (clip.sync && Array.isArray(clip.sync)) {
      for (const s of clip.sync) visit(s);
    }
  };

  for (const area of sceneData.touch || []) {
    visit(area.clip);
    visit(area.endClip);
  }

  for (const idx of [...(controller.idle || []), ...(controller.randomIdle || [])]) {
    const clip = controller.clips[idx];
    if (!clip) continue;
    reactionTracks.delete(clip.track);
    if (clip.sync && Array.isArray(clip.sync)) {
      for (const s of clip.sync) {
        if (controller.clips[s]) reactionTracks.delete(controller.clips[s].track);
      }
    }
  }
}

// 3. Animation Scheduling & Intro Blocking
function playAnimations(spineInstance, isMain) {
  const anims = spineInstance.skeleton.data.animations.map((a) => a.name);

  const introAnim = anims.find((n) => /^start_idle_0?1$/i.test(n));
  const idleAnim = anims.find((n) => /^idle_0?1$/i.test(n) || /^idle$/i.test(n));

  if (introAnim && idleAnim) {
    spineInstance.state.setAnimation(TRACK_BASE, introAnim, false);
    spineInstance.state.addAnimation(TRACK_BASE, idleAnim, true, 0);

    if (isMain) {
      introFinished = false;
      document.body.style.cursor = "default";

      spineInstance.state.addListener({
        start: (entry) => {
          if (entry.trackIndex === TRACK_BASE && entry.animation.name === idleAnim) {
            introFinished = true;
            document.body.style.cursor = "grab";
            startRandomIdle();
          }
        },
      });
    }
  } else if (idleAnim) {
    spineInstance.state.setAnimation(TRACK_BASE, idleAnim, true);
    if (isMain) {
      introFinished = true;
      document.body.style.cursor = "grab";
      startRandomIdle();
    }
  } else if (anims.length > 0) {
    spineInstance.state.setAnimation(TRACK_BASE, anims[0], true);
    if (isMain) {
      introFinished = true;
      document.body.style.cursor = "grab";
      startRandomIdle();
    }
  }

  if (!sceneData?.controller) {
    const repeatAnims = anims.filter((n) => /_R(_?\d+)?$/i.test(n) && !n.includes("Idle"));
    repeatAnims.forEach((anim, idx) => {
      spineInstance.state.setAnimation(idx + 1, anim, true);
    });
  }
}

// 4. Random Idle System with Mutual Action Blocking
function startRandomIdle() {
  const controller = sceneData?.controller;
  if (!controller || !controller.randomIdle) return;

  const now = performance.now() / 1000;
  for (const idx of controller.randomIdle) {
    const clip = controller.clips[idx];
    if (!clip) continue;
    const random = clip.random;
    const first =
      random && random.firstDelay > 0
        ? random.firstDelay
        : random
          ? random.minDelay + Math.random() * (random.maxDelay - random.minDelay)
          : 0;

    randomIdleAt.set(idx, now + first);
  }
}

function updateRandomIdle() {
  const controller = sceneData?.controller;
  if (!controller || !mainSpine) return;

  const now = performance.now() / 1000;

  for (const [idx, at] of randomIdleAt.entries()) {
    if (now < at) continue;

    const clip = controller.clips[idx];
    if (!clip) continue;

    if (clip.blocksTouch && isInteracting()) {
      randomIdleAt.set(idx, now + 1);
      continue;
    }

    const random = clip.random;
    const extra = random
      ? (random.minExtraLoops || 0) +
        Math.floor(Math.random() * ((random.maxExtraLoops || 0) - (random.minExtraLoops || 0) + 1))
      : 0;

    const duration = playClip(idx, extra, true);

    if (clip.blocksTouch) {
      blockedUntil = Math.max(blockedUntil, now + duration);
    }

    const delay = random
      ? (random.minDelay || 5) + Math.random() * ((random.maxDelay || 15) - (random.minDelay || 5))
      : 10;

    randomIdleAt.set(idx, now + duration + delay);
  }
}

function playClip(idx, extraLoops = 0, once = false) {
  const controller = sceneData?.controller;
  const spineInstance = mainSpine;
  const clip = controller?.clips[idx];
  const anim = clip && spineInstance?.skeleton.data.findAnimation(clip.animation);

  if (!controller || !spineInstance || !clip || !anim) return 0;

  const loop = clip.loop && !once;
  const state = spineInstance.state;

  const playing = state.getCurrent(clip.track) !== null;
  if (!playing) {
    state.setEmptyAnimation(clip.track, 0);
  }

  let entry = playing
    ? state.setAnimation(clip.track, anim.name, loop)
    : state.addAnimation(clip.track, anim.name, loop, 0);

  entry.mixDuration = clip.introMix || 0.25;

  for (let i = 0; i < extraLoops; i++) {
    entry = state.addAnimation(clip.track, anim.name, false, 0);
  }

  const next = clip.next !== null && clip.next !== undefined ? controller.clips[clip.next] : null;
  const nextAnim = next && spineInstance.skeleton.data.findAnimation(next.animation);

  if (next && nextAnim) {
    const nextEntry = state.addAnimation(next.track, nextAnim.name, next.loop, 0);
    nextEntry.mixDuration = next.introMix || 0;
    if (!next.loop && next.track !== 0) {
      state.addEmptyAnimation(next.track, next.outroMix || 0.25, 0);
    }
  } else if (!loop && clip.track !== 0) {
    state.addEmptyAnimation(clip.track, clip.outroMix || 0.25, 0);
  }

  if (clip.sync && Array.isArray(clip.sync)) {
    for (const syncIdx of clip.sync) {
      playClip(syncIdx);
    }
  }

  return anim.duration * (1 + extraLoops);
}

// 5. Cheek, Hand & Gaze Bones Setup (Joe's Exact Rigs)
const CHEEK_BONE_RE = /cheek|chin.*root|root.*chin/i;

function findCheekDragBones(spineInstance) {
  const bones = spineInstance.skeleton.bones;
  const head = eyeBone?.parent || headBone;
  const isUnderHead = (bone) => {
    for (let b = bone.parent; b; b = b.parent) {
      if (b === head) return true;
    }
    return false;
  };
  return bones.filter((b) => CHEEK_BONE_RE.test(b.data.name) && isUnderHead(b));
}

function findFingerSlots(spineInstance, hand) {
  const side = /^([lr])_/i.exec(hand.data.name)?.[1];
  if (!side) return [];
  const pattern = new RegExp(`^${side}_?finger_?index`, "i");
  return spineInstance.skeleton.slots.filter((slot) => pattern.test(slot.data.name));
}

function getSlotsCentroid(slots) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const slot of slots) {
    const bone = slot.bone;
    if (bone) {
      x += bone.worldX;
      y += bone.worldY;
      count++;
    }
  }
  return count > 0 ? { x: x / count, y: y / count } : null;
}

function findHandFollowBone(spineInstance) {
  const bones = spineInstance.skeleton.bones;
  const dedicated = bones.find((b) => /^handfollow$/i.test(b.data.name));
  if (dedicated) return dedicated;

  const followers = new Map();
  const constraints = [
    ...(spineInstance.skeleton.data.ikConstraints || []),
    ...(spineInstance.skeleton.data.transformConstraints || []),
  ];

  for (const c of constraints) {
    const targetName = c.target?.name || "";
    if (/hand/i.test(targetName)) {
      followers.set(targetName, (followers.get(targetName) || 0) + (c.bones?.length || 1));
    }
  }

  let best = null;
  for (const [name, count] of followers) {
    if (!best || count > (followers.get(best) || 0)) {
      best = name;
    }
  }

  return best ? spineInstance.skeleton.findBone(best) : null;
}

function setupBones(spineInstance) {
  const bones = spineInstance.skeleton.bones;

  eyeBone = bones.find((b) => /^touch_eye$/i.test(b.data.name)) || null;
  headBone =
    eyeBone?.parent ||
    bones.find((b) => b.data.name === "Head_Rot") ||
    bones.find((b) => /head_rot/i.test(b.data.name)) ||
    bones.find((b) => /head_01/i.test(b.data.name)) ||
    null;

  crownBone = bones.find((b) => /^touch_point$/i.test(b.data.name)) || null;

  // Detect cheek pinch/poke support (strictly mouth track _M or bare, never _A)
  const anims = spineInstance.skeleton.data.animations.map((a) => a.name);
  cheekPrefix =
    ["Pinch", "Touch"].find((prefix) =>
      anims.some((n) => new RegExp(`^${prefix}\\d*_01(_M)?$`, "i").test(n))
    ) || null;

  const hasHandFollow = anims.some((n) => /^HandFollow_01(_M)?$/i.test(n));
  handBone = hasHandFollow ? findHandFollowBone(spineInstance) : null;
  handSpotSlots =
    handBone && !/^handfollow$/i.test(handBone.data.name)
      ? findFingerSlots(spineInstance, handBone)
      : [];

  cheekDragBones = cheekPrefix === "Pinch" ? findCheekDragBones(spineInstance) : [];

  spineInstance.beforeUpdateWorldTransforms = () => {
    applyGaze();
  };

  spineInstance.afterUpdateWorldTransforms = () => {
    restoreGaze();
  };
}

function getHeadFrame() {
  const head = headBone || eyeBone?.parent;
  const crown = crownBone;
  if (!head || !crown) return null;

  const dx = crown.worldX - head.worldX;
  const dy = crown.worldY - head.worldY;
  const size = Math.hypot(dx, dy);
  if (size === 0) return null;

  return {
    x: head.worldX,
    y: head.worldY,
    ux: dx / size,
    uy: dy / size,
    size,
  };
}

// 6. Gaze, Cheek & Hand Physics Loop
function offsetBone(bone, offset) {
  const parent = bone.parent;
  if (!parent) return { x: 0, y: 0 };

  const from = parent.worldToLocal(new spine.Vector2(bone.worldX, bone.worldY));
  const to = parent.worldToLocal(new spine.Vector2(bone.worldX + offset.x, bone.worldY + offset.y));

  const applied = {
    x: to.x - from.x,
    y: to.y - from.y,
  };

  bone.x += applied.x;
  bone.y += applied.y;
  return applied;
}

function applyGaze() {
  const now = performance.now();
  const dt = lastLookUpdate ? Math.min((now - lastLookUpdate) / 1000, 0.1) : 0;
  lastLookUpdate = now;

  const ease = 1 - Math.exp(-LOOK_RESPONSIVENESS * dt);

  const hasTouchAreas = Boolean(sceneData?.touch && sceneData.touch.length > 0);
  if (hasTouchAreas) {
    applyDraggedBones(dt);
  } else {
    // 1. Dragging cheek stretch or hand follow (Fallback)
    let desiredDragX = 0;
    let desiredDragY = 0;
    const head = getHeadFrame();

    if (dragRest && lookTarget && head) {
      let dx = lookTarget.x - dragRest.x;
      let dy = lookTarget.y - dragRest.y;

      if (dragOutward) {
        const along = dx * dragOutward.x + dy * dragOutward.y;
        const sideX = dx - along * dragOutward.x;
        const sideY = dy - along * dragOutward.y;
        const pull = Math.max(0, along);

        dx = dragOutward.x * pull + sideX * CHEEK_SIDEWAYS_STRETCH;
        dy = dragOutward.y * pull + sideY * CHEEK_SIDEWAYS_STRETCH;
      }

      const dist = Math.hypot(dx, dy);
      const reach = Math.min(dist, dragLimit * head.size);
      if (dist > 0) {
        desiredDragX = (dx / dist) * reach;
        desiredDragY = (dy / dist) * reach;
      }
    }

    dragOffset.x += (desiredDragX - dragOffset.x) * ease;
    dragOffset.y += (desiredDragY - dragOffset.y) * ease;

    if (dragBone && Math.hypot(dragOffset.x, dragOffset.y) > 0.05) {
      dragApplied = offsetBone(dragBone, dragOffset);
    }
  }

  // 2. Eye Gaze Steering
  // Follows pointer during desktop cursor hover and headpat
  if (!eyeBone || !eyeBone.parent || !introFinished) return;

  const origin = headBone || eyeBone.parent;
  let desiredX = 0;
  let desiredY = 0;

  const isEnabled = settings.gazeMode === "enabled" && settings.enableLook;
  const shouldFollow =
    isEnabled &&
    isPointerDown &&
    !draggedBones.has(eyeBone) &&
    dragBone !== eyeBone &&
    touchMode !== "cheek" &&
    !isInteractingTalk() &&
    Boolean(lookTarget);

  if (shouldFollow && lookTarget) {
    const frameWidth = CAMERA.width;
    const lookMaxOffset = frameWidth * LOOK_MAX_OFFSET;
    const lookSaturationDist = frameWidth * LOOK_SATURATION_DISTANCE;

    const dx = lookTarget.x - origin.worldX;
    const dy = lookTarget.y - origin.worldY;
    const dist = Math.hypot(dx, dy);

    if (dist > 0) {
      const strength = Math.min(dist / lookSaturationDist, 1);
      const mag = lookMaxOffset * strength;

      desiredX = (dx / dist) * mag;
      desiredY = (dy / dist) * mag;
    }
  }

  lookOffset.x += (desiredX - lookOffset.x) * ease;
  lookOffset.y += (desiredY - lookOffset.y) * ease;

  if (Math.hypot(lookOffset.x, lookOffset.y) < 0.5) return;

  lookApplied = offsetBone(eyeBone, lookOffset);
}

function isInteractingTalk() {
  if (!mainSpine) return false;
  const entry = mainSpine.state.getCurrent(TRACK_TALK_BODY);
  return Boolean(entry && entry.animation && entry.animation.name !== "<empty>");
}

function applyDraggedBones(dt) {
  const pointer = lookTarget;

  for (const dragged of draggedBones.values()) {
    const { area, bone, position } = dragged;
    const origin = area.origin || { x: 0, y: 0 };
    const parent = bone.parent;
    if (!parent) continue;

    const pressed = activeTouchArea === area && pointer !== null;
    let target = origin;

    if (pressed && area.min && area.max) {
      const local = parent.worldToLocal(new spine.Vector2(pointer.x, pointer.y));
      target = {
        x: clamp(local.x, area.min.x, area.max.x),
        y: clamp(local.y, area.min.y, area.max.y),
      };
    }

    const speed = (pressed ? area.dragSpeed : area.releaseSpeed) || 0.2;
    const ease = 1 - Math.pow(1 - Math.min(speed, 1), dt * 60);

    position.x += (target.x - position.x) * ease;
    position.y += (target.y - position.y) * ease;

    if (!pressed && Math.hypot(position.x - origin.x, position.y - origin.y) < 0.05) {
      draggedBones.delete(bone);
      continue;
    }

    dragged.saved = { x: bone.x, y: bone.y };
    bone.x = position.x;
    bone.y = position.y;
  }
}

function restoreGaze() {
  if (eyeBone && lookApplied) {
    eyeBone.x -= lookApplied.x;
    eyeBone.y -= lookApplied.y;
    lookApplied = null;
  }

  if (dragBone && dragApplied) {
    dragBone.x -= dragApplied.x;
    dragBone.y -= dragApplied.y;
    dragApplied = null;
  }

  for (const dragged of draggedBones.values()) {
    if (dragged.saved) {
      dragged.bone.x = dragged.saved.x;
      dragged.bone.y = dragged.saved.y;
      dragged.saved = null;
    }
  }
}

// 7. Touch Animation Generator (Matches Joe's touchAnimationNames & Variants)
function touchVariants(spineInstance, prefix) {
  if (!spineInstance) return [""];
  const re = new RegExp(`^${prefix}(\\d*)_01(_[AM])?$`, "i");
  const variants = new Set();
  for (const a of spineInstance.skeleton.data.animations) {
    const match = re.exec(a.name);
    if (match) variants.add(match[1]);
  }
  return variants.size > 0 ? [...variants] : [""];
}

function touchAnimationNames(prefix, suffix, variant = "") {
  const bare = suffix === "_M";
  const name = `${prefix}${variant}`;
  const ends = [
    `${name}End_01`,
    `${name}_End_01`,
    ...(variant ? [`${prefix}End${variant}_01`] : []),
  ];

  return {
    intro: [`${name}_01${suffix}`, ...(bare ? [`${name}_01`] : [])],
    loop: [`${name}_02${suffix}`, ...(bare ? [`${name}_02`] : [])],
    end: [
      ...ends.map((e) => `${e}${suffix}`),
      ...(bare ? ends : []),
    ],
  };
}

function playTouchAnimation(prefix, isStart) {
  if (!mainSpine) return;
  const anims = mainSpine.skeleton.data.animations.map((a) => a.name);
  const state = mainSpine.state;

  for (const [track, suffix] of [
    [TRACK_TOUCH_MOUTH, "_M"],
    [TRACK_TOUCH_BODY, "_A"],
  ]) {
    const names = touchAnimationNames(prefix, suffix, currentTouchVariant);
    const intro = names.intro.find((n) => anims.includes(n));
    const loop = names.loop.find((n) => anims.includes(n));
    const end = names.end.find((n) => anims.includes(n));

    if (isStart) {
      if (!intro) {
        state.setEmptyAnimation(track, 0.2);
        continue;
      }
      if (state.getCurrent(track)) {
        state.setAnimation(track, intro, false);
      } else {
        state.setEmptyAnimation(track, 0);
        state.addAnimation(track, intro, false, 0).mixDuration = 0.2;
      }
      if (loop) {
        const entry = state.addAnimation(track, loop, true, 0);
        entry.mixDuration = 0;
      }
    } else {
      if (end) {
        state.setAnimation(track, end, false);
        state.addEmptyAnimation(track, 0.2, 0);
      } else {
        state.setEmptyAnimation(track, 0.2);
      }
    }
  }
}

// 8. Zone Detection & Input Handlers
function touchAreaAt(point) {
  const areas = sceneData?.touch;
  if (!areas || areas.length === 0) return null;

  const TOUCH_AREA_PRIORITY = ["pinch", "poke", "hand", "pat", "other", "look"];
  for (const kind of TOUCH_AREA_PRIORITY) {
    for (const area of areas) {
      if (
        area.kind === kind &&
        area.area &&
        isInPolygon(
          point.x,
          point.y,
          area.area.map((p) => ({ x: p.x, y: -p.y }))
        )
      ) {
        return area;
      }
    }
  }
  return null;
}

function zoneAt(point) {
  const head = getHeadFrame();
  if (!head) return null;

  const along = (distance) => ({
    x: head.x + head.ux * distance * head.size,
    y: head.y + head.uy * distance * head.size,
  });

  const projAlong = (point.x - head.x) * head.ux + (point.y - head.y) * head.uy;
  const alongRatio = projAlong / head.size;

  // Headpat zone (high on and above crown)
  const patPos = along(PAT_ZONE_CENTER);
  const inPat = Math.hypot(point.x - patPos.x, point.y - patPos.y) <= PAT_ZONE_RADIUS * head.size;

  // Headpat area on upper head / crown takes absolute precedence over cheek or hand
  if (inPat && alongRatio > 0.2) {
    return "pat";
  }

  // Hand zone priority (only if HandFollow is an actual animation)
  if (handBone) {
    const finger = getSlotsCentroid(handSpotSlots);
    const hx = finger ? finger.x : handBone.worldX;
    const hy = finger ? finger.y : handBone.worldY;
    const radius = (finger ? FINGER_ZONE_RADIUS : HAND_ZONE_RADIUS) * head.size;
    if (Math.hypot(point.x - hx, point.y - hy) <= radius) {
      return "hand";
    }
  }

  // Cheek zone priority (lower face only: cheeks / mouth / blush, alongRatio <= 0.25)
  if (cheekPrefix && alongRatio <= 0.25) {
    const cheekPos = along(CHEEK_ZONE_CENTER);
    if (Math.hypot(point.x - cheekPos.x, point.y - cheekPos.y) <= CHEEK_ZONE_RADIUS * head.size) {
      return "cheek";
    }
  }

  if (inPat) {
    return "pat";
  }

  return null;
}

function isOverSpot(local) {
  if (settings.interaction === "disabled") return false;
  const hasTouchAreas = Boolean(sceneData?.touch && sceneData.touch.length > 0);
  if (hasTouchAreas) {
    const area = touchAreaAt(local);
    if (!area) return false;
    return area.kind === "pat" || area.kind === "pinch" || area.kind === "poke" || area.kind === "hand";
  }
  return zoneAt(local) !== null;
}

function setupInputHandlers() {
  window.addEventListener("pointermove", (e) => {
    if (!sceneContainer) return;

    if (settings.interaction === "disabled") {
      document.body.style.cursor = "default";
      lookTarget = null;
      return;
    }

    const local = sceneContainer.toLocal(new PIXI.Point(e.clientX, e.clientY));
    if (isPointerDown) {
      lookTarget = local;
    }

    // Hover cursor feedback
    if (!isPointerDown && canTouch()) {
      document.body.style.cursor = isOverSpot(local) ? "grab" : "default";
    }

    clearTimeout(hoverIdleTimer);
    hoverIdleTimer = setTimeout(() => {
      lookTarget = null;
    }, 1800);
  });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#menu-modal") || e.target.closest(".top-controls") || e.target.closest("#board-modal")) return;
    if (settings.interaction === "disabled" || !canTouch() || isInteracting() || !mainSpine) return;

    const local = sceneContainer.toLocal(new PIXI.Point(e.clientX, e.clientY));
    lookTarget = local;
    isPointerDown = true;
    document.body.style.cursor = "grabbing";

    const hasTouchAreas = Boolean(sceneData?.touch && sceneData.touch.length > 0);

    // 1. Scene touch areas from manifest (Prefab)
    if (hasTouchAreas) {
      const area = touchAreaAt(local);
      if (area) {
        startAreaTouch(area, local);
      } else {
        playTalkReaction();
      }
      return;
    }

    // 2. Fallback procedural touch zones (Hand, Cheek, Headpat)
    const zone = zoneAt(local);
    if (zone) {
      startFallbackTouch(zone, local);
      return;
    }

    // 3. Otherwise: Talk reaction
    playTalkReaction();
  });

  function releasePointer() {
    isPointerDown = false;
    lookTarget = null;
    if (settings.interaction === "disabled") {
      document.body.style.cursor = "default";
      lookTarget = null;
      return;
    }
    if (canTouch()) {
      document.body.style.cursor = "grab";
    }
    if (activeTouchArea) {
      endAreaTouch();
    } else if (touchMode) {
      endFallbackTouch();
    }
  }

  window.addEventListener("pointerup", releasePointer);
  window.addEventListener("pointercancel", releasePointer);
  window.addEventListener("blur", releasePointer);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releasePointer();
  });

  document.documentElement.addEventListener("pointerleave", releasePointer);
}

function startAreaTouch(area, point) {
  activeTouchArea = area;
  activeAreaSince = performance.now() / 1000;
  activeAreaTriggered = false;

  const bone = area.bone ? mainSpine.skeleton.findBone(area.bone) : null;
  if (bone && area.origin) {
    const dragged = draggedBones.get(bone);
    if (dragged) {
      dragged.area = area;
    } else {
      draggedBones.set(bone, {
        area,
        bone,
        position: { ...area.origin },
        saved: null,
      });
    }
  }

  const mode =
    area.kind === "pat"
      ? "pat"
      : area.kind === "pinch" || area.kind === "poke"
        ? "cheek"
        : area.kind === "hand"
          ? "hand"
          : area.kind === "look" || area.kind === "other"
            ? "look"
            : null;

  touchMode = mode;

  // Prefab touch areas trigger clip via updateTouchTrigger; no procedural track fighting
  updateTouchTrigger();
}

function updateTouchTrigger() {
  const area = activeTouchArea;
  if (!area || activeAreaTriggered) return;

  const now = performance.now() / 1000;
  if (now - activeAreaSince < (area.triggerDelay || 0)) return;

  activeAreaTriggered = true;
  if (area.clip !== null && area.clip !== undefined) {
    playClip(area.clip);
  }
}

function endAreaTouch() {
  const area = activeTouchArea;
  activeTouchArea = null;
  touchMode = null;

  if (!area || !activeAreaTriggered || !sceneData?.controller) return;

  if (area.endClip !== null && area.endClip !== undefined) {
    playClip(area.endClip);
  } else if (area.clip !== null && area.clip !== undefined) {
    const clip = sceneData.controller.clips[area.clip];
    if (clip && mainSpine) {
      for (const idx of [area.clip, ...(clip.sync || [])]) {
        const c = sceneData.controller.clips[idx];
        if (c) mainSpine.state.setEmptyAnimation(c.track, clip.outroMix || 0.25);
      }
    }
  }
}

function startFallbackTouch(mode, point) {
  touchMode = mode;

  const prefix =
    mode === "pat" ? "Pat" : mode === "cheek" ? cheekPrefix || "Pinch" : mode === "hand" ? "HandFollow" : "Look";

  const variants = touchVariants(mainSpine, prefix);
  currentTouchVariant = variants[Math.floor(Math.random() * variants.length)] || "";

  const nearest = (bones) =>
    bones.reduce(
      (best, b) =>
        !best || Math.hypot(b.worldX - point.x, b.worldY - point.y) < Math.hypot(best.worldX - point.x, best.worldY - point.y)
          ? b
          : best,
      null
    );

  const dragTargetBone =
    mode === "hand" ? handBone : mode === "cheek" ? nearest(cheekDragBones) : null;

  if (dragTargetBone) {
    if (dragBone !== dragTargetBone) {
      dragOffset = { x: 0, y: 0 };
    }
    dragBone = dragTargetBone;
    dragRest = { x: dragTargetBone.worldX, y: dragTargetBone.worldY };
    dragLimit = mode === "hand" ? HAND_MAX_OFFSET : CHEEK_MAX_STRETCH;
    dragOutward = null;

    if (mode === "cheek" && headBone) {
      const ox = dragTargetBone.worldX - headBone.worldX;
      const oy = dragTargetBone.worldY - headBone.worldY;
      const len = Math.hypot(ox, oy);
      if (len > 0) {
        dragOutward = { x: ox / len, y: oy / len };
      }
    }
  } else {
    // Mode is "pat" or no drag bone: reset drag state cleanly
    if (dragBone && dragApplied) {
      dragBone.x -= dragApplied.x;
      dragBone.y -= dragApplied.y;
      dragApplied = null;
    }
    dragBone = null;
    dragRest = null;
    dragOffset = { x: 0, y: 0 };
    dragLimit = 0;
    dragOutward = null;
  }

  playTouchAnimation(prefix, true);
}

function endFallbackTouch() {
  if (!touchMode) return;
  const mode = touchMode;
  touchMode = null;
  dragRest = null;

  if (dragBone && dragApplied) {
    dragBone.x -= dragApplied.x;
    dragBone.y -= dragApplied.y;
    dragApplied = null;
  }
  dragBone = null;
  dragOffset = { x: 0, y: 0 };
  dragLimit = 0;
  dragOutward = null;

  const prefix =
    mode === "pat" ? "Pat" : mode === "cheek" ? cheekPrefix || "Pinch" : mode === "hand" ? "HandFollow" : "Look";

  playTouchAnimation(prefix, false);
}

function playTalkReaction() {
  if (!mainSpine) return;

  const anims = mainSpine.skeleton.data.animations.map((a) => a.name);
  const talkAnims = anims.filter((n) => /^Talk_\d+_A$/i.test(n));

  if (talkAnims.length > 0) {
    const pick = talkAnims[Math.floor(Math.random() * talkAnims.length)];
    const [prefix, index] = pick.split("_");
    const endPick = `${prefix}End_${index}_A`;

    mainSpine.state.setAnimation(TRACK_TALK_BODY, pick, false);
    if (anims.includes(endPick)) {
      mainSpine.state.addAnimation(TRACK_TALK_BODY, endPick, false, 0);
    }
    mainSpine.state.addEmptyAnimation(TRACK_TALK_BODY, 0.25, 0);

    const mouthPick = pick.replace(/_A$/, "_M");
    const mouthEnd = endPick.replace(/_A$/, "_M");
    if (anims.includes(mouthPick)) {
      mainSpine.state.setAnimation(TRACK_TALK_MOUTH, mouthPick, false);
      if (anims.includes(mouthEnd)) {
        mainSpine.state.addAnimation(TRACK_TALK_MOUTH, mouthEnd, false, 0);
      }
      mainSpine.state.addEmptyAnimation(TRACK_TALK_MOUTH, 0.25, 0);
    }
  }
}

// 9. Floating Settings Menu UI
function setupMenuUI() {
  const menuBtn = document.getElementById("menu-btn");
  const modal = document.getElementById("menu-modal");
  const closeBtn = document.getElementById("close-menu-btn");
  const interactionControl =
    document.getElementById("interaction-control") ||
    document.getElementById("gaze-control");
  const fpsControl = document.getElementById("fps-control");
  const applyBtn = document.getElementById("apply-btn");

  if (!menuBtn || !modal) return;

  let draftInteraction = settings.interaction;
  let draftFps = settings.fpsLimit;

  function syncControlsTo(interaction, fps) {
    if (interactionControl) {
      interactionControl.querySelectorAll(".segment-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === interaction);
      });
    }
    if (fpsControl) {
      fpsControl.querySelectorAll(".segment-btn").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.value) === fps);
      });
    }
  }

  function openMenu() {
    draftInteraction = settings.interaction;
    draftFps = settings.fpsLimit;
    syncControlsTo(draftInteraction, draftFps);
    modal.classList.remove("hidden");
    const boardModal = document.getElementById("board-modal");
    if (boardModal) boardModal.classList.add("hidden");
  }

  function closeMenu() {
    draftInteraction = settings.interaction;
    draftFps = settings.fpsLimit;
    syncControlsTo(draftInteraction, draftFps);
    modal.classList.add("hidden");
  }

  syncControlsTo(settings.interaction, settings.fpsLimit);

  document.addEventListener("ba:settings", () => {
    draftInteraction = settings.interaction;
    draftFps = settings.fpsLimit;
    syncControlsTo(draftInteraction, draftFps);
  });

  if (interactionControl) {
    interactionControl.addEventListener("click", (e) => {
      const btn = e.target.closest(".segment-btn");
      if (!btn) return;
      draftInteraction = btn.dataset.value;
      interactionControl.querySelectorAll(".segment-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  }

  if (fpsControl) {
    fpsControl.addEventListener("click", (e) => {
      const btn = e.target.closest(".segment-btn");
      if (!btn) return;
      draftFps = Number(btn.dataset.value);
      fpsControl.querySelectorAll(".segment-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  }

  menuBtn.addEventListener("click", () => {
    if (modal.classList.contains("hidden")) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      settings.interaction = draftInteraction;
      settings.fpsLimit = draftFps;
      localStorage.setItem("ba_interaction", settings.interaction);
      localStorage.setItem("ba_gaze", settings.interaction);
      localStorage.setItem("ba_fps", String(settings.fpsLimit));

      applyFpsLimit(settings.fpsLimit);

      if (settings.interaction === "disabled") {
        lookTarget = null;
        isPointerDown = false;
        document.body.style.cursor = "default";
        if (activeTouchArea) endAreaTouch();
        if (touchMode) endFallbackTouch();
      }

      modal.classList.add("hidden");
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeMenu);
  }

  // Esc or click outside to dismiss Options
  document.addEventListener("pointerdown", (e) => {
    if (modal.classList.contains("hidden")) return;
    if (!modal.contains(e.target) && !menuBtn.contains(e.target)) {
      closeMenu();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeMenu();
    }
  });
}

// 10. Student Selection Board UI (All 150 Normal Students with Alt Variant Picker)
function setupStudentBoardUI() {
  const boardBtn = document.getElementById("board-btn");
  const boardModal = document.getElementById("board-modal");
  const closeBoardBtn = document.getElementById("close-board-btn");
  const boardBackdrop = document.getElementById("board-backdrop");
  const boardGrid = document.getElementById("board-grid");
  const boardContainer = boardModal ? boardModal.querySelector(".board-container") : null;
  const boardGridWrap = boardModal ? boardModal.querySelector(".board-grid-wrap") : null;
  const altDropdown = document.getElementById("alt-dropdown");

  if (!boardModal || !boardGrid) return;

  const students = window.STUDENTS || [];
  const baseMap = new Map();
  students.forEach((s) => {
    const base = s.base || s.id;
    if (!baseMap.has(base)) baseMap.set(base, []);
    baseMap.get(base).push(s);
  });

  const baseList = [];
  for (const [baseId, variants] of baseMap) {
    const baseStudent = variants.find((x) => x.id === baseId) || variants[0];
    const alts = variants.filter((x) => x !== baseStudent);
    const match = baseStudent.name.match(/^(.*?)\s*\((.*?)\)$/);
    const baseName = match ? match[1] : baseStudent.name;
    baseList.push({
      baseId,
      baseName,
      baseStudent,
      variants,
      alts,
      hasAlts: alts.length > 0,
    });
  }

  baseList.sort((a, b) => a.baseName.localeCompare(b.baseName));

  let openCardRef = null;

  function closeAltDropdown() {
    if (!altDropdown) return;
    altDropdown.classList.add("hidden");
    altDropdown.innerHTML = "";
    if (openCardRef) {
      openCardRef.classList.remove("alt-open");
      openCardRef = null;
    }
  }

  function openAltDropdown(group, card) {
    if (!altDropdown || !boardContainer) return;

    if (openCardRef === card && !altDropdown.classList.contains("hidden")) {
      closeAltDropdown();
      return;
    }

    closeAltDropdown();
    openCardRef = card;
    card.classList.add("alt-open");

    altDropdown.innerHTML = "";
    group.variants.forEach((v) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isCurrent = v.id === settings.studentId;
      btn.className = `alt-dropdown-item ${isCurrent ? "active" : ""}`;

      const match = v.name.match(/^(.*?)\s*\((.*?)\)$/);
      const variantLabel = match ? match[2] : (v.id === group.baseId ? "Default" : v.name);

      btn.innerHTML = `
        <span>${variantLabel}</span>
        ${isCurrent ? `<span class="alt-check">✓</span>` : ""}
      `;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAltDropdown();
        selectStudent(v.id);
      });

      altDropdown.appendChild(btn);
    });

    altDropdown.classList.remove("hidden");

    const containerRect = boardContainer.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const dropdownRect = altDropdown.getBoundingClientRect();

    let left = cardRect.left - containerRect.left;
    let top = cardRect.bottom - containerRect.top + 3;

    if (top + dropdownRect.height > containerRect.height - 8) {
      top = (cardRect.top - containerRect.top) - dropdownRect.height - 3;
    }

    if (left + dropdownRect.width > containerRect.width - 8) {
      left = Math.max(8, containerRect.width - dropdownRect.width - 8);
    }
    if (left < 8) left = 8;

    altDropdown.style.left = `${Math.round(left)}px`;
    altDropdown.style.top = `${Math.round(top)}px`;
  }

  function createCard(group) {
    const card = document.createElement("div");
    card.dataset.base = group.baseId;

    function refreshCardContent() {
      const activeVariant = group.variants.find((v) => v.id === settings.studentId);
      const isActive = !!activeVariant;

      card.className = `student-card ${isActive ? "active" : ""}`;

      card.innerHTML = `
        <span class="card-name" title="${group.baseName}">${group.baseName}</span>
        <div class="card-end">
          ${group.hasAlts ? `<span class="alt-arrow">▾</span>` : ""}
          ${isActive ? `<span class="card-check">✓</span>` : ""}
        </div>
      `;
    }

    refreshCardContent();

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      if (group.hasAlts) {
        openAltDropdown(group, card);
      } else {
        closeAltDropdown();
        selectStudent(group.baseStudent.id);
      }
    });

    return { card, group, refresh: refreshCardContent };
  }

  boardGrid.innerHTML = "";
  const cardItems = [];
  baseList.forEach((group) => {
    const item = createCard(group);
    cardItems.push(item);
    boardGrid.appendChild(item.card);
  });

  document.addEventListener("ba:settings", () => cardItems.forEach((item) => item.refresh()));

  function selectStudent(id) {
    settings.studentId = id;
    localStorage.setItem("ba_student", id);

    cardItems.forEach((item) => item.refresh());

    closeAltDropdown();
    closeBoard();
    loadStudentLobby(id);
  }

  function openBoard() {
    closeAltDropdown();
    boardModal.classList.remove("hidden");
    const menuModal = document.getElementById("menu-modal");
    if (menuModal) menuModal.classList.add("hidden");

    setTimeout(() => {
      const activeCard = boardGrid.querySelector(".student-card.active");
      if (activeCard) {
        activeCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 60);
  }

  function closeBoard() {
    closeAltDropdown();
    boardModal.classList.add("hidden");
  }

  if (boardBtn) boardBtn.addEventListener("click", openBoard);
  if (closeBoardBtn) closeBoardBtn.addEventListener("click", closeBoard);
  if (boardBackdrop) boardBackdrop.addEventListener("click", closeBoard);

  if (boardGridWrap) {
    boardGridWrap.addEventListener("scroll", closeAltDropdown, { passive: true });
  }

  document.addEventListener("pointerdown", (e) => {
    if (!altDropdown || altDropdown.classList.contains("hidden")) return;
    if (altDropdown.contains(e.target) || e.target.closest(".student-card")) return;
    closeAltDropdown();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (altDropdown && !altDropdown.classList.contains("hidden")) {
        closeAltDropdown();
      } else if (!boardModal.classList.contains("hidden")) {
        closeBoard();
      } else {
        const menuModal = document.getElementById("menu-modal");
        if (menuModal && !menuModal.classList.contains("hidden")) {
          menuModal.classList.add("hidden");
        }
      }
    }
  });
}

// 10. Camera Fitting & Resizing
function onResize() {
  if (!app || !sceneContainer) return;

  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  const scale = Math.max(screenW / CAMERA.width, screenH / CAMERA.height);

  sceneContainer.scale.set(scale);
  sceneContainer.position.set(
    screenW / 2 - (CAMERA.x + CAMERA.width / 2) * scale,
    screenH / 2 - (CAMERA.y + CAMERA.height / 2) * scale
  );
}

// 11. Lively Wallpaper IPC
const LIVELY_STUDENT_LIST = ["aru", "hina", "shiroko", "yuuka", "hoshino", "mika"];
const livelySeen = new Set();

function notifySettingsChanged() {
  document.dispatchEvent(new CustomEvent("ba:settings"));
}

function setStudent(id) {
  if (!id || id === currentStudentId) return;
  settings.studentId = id;
  localStorage.setItem("ba_student", id);
  notifySettingsChanged();
  if (sceneContainer) loadStudentLobby(id);
}

window.livelyPropertyListener = function (name, val) {
  // Lively calls this once per property when the page loads (the "init" call),
  // then again whenever the user changes a value in Customize.
  const isInit = !livelySeen.has(name);
  livelySeen.add(name);

  switch (name) {
    case "studentId": {
      if (isInit && localStorage.getItem("ba_student")) return;
      setStudent(LIVELY_STUDENT_LIST[val] || "aru");
      break;
    }
    case "customStudentId": {
      const id = String(val || "").trim().toLowerCase();
      if (!id) return;
      if (isInit && localStorage.getItem("ba_student")) return;
      setStudent(id);
      break;
    }
    case "fpsLimit": {
      if (isInit && localStorage.getItem("ba_fps")) return;
      settings.fpsLimit = val === 0 ? 30 : 60;
      localStorage.setItem("ba_fps", String(settings.fpsLimit));
      applyFpsLimit(settings.fpsLimit);
      notifySettingsChanged();
      break;
    }
    case "enableLook": {
      settings.enableLook = Boolean(val);
      break;
    }
    case "enablePat": {
      settings.enablePat = Boolean(val);
      if (!settings.enablePat) {
        isPointerDown = false;
        if (activeTouchArea) endAreaTouch();
        if (touchMode) endFallbackTouch();
        document.body.style.cursor = "default";
      }
      break;
    }
  }
};

window.livelyWallpaperPlaybackChanged = function (data) {
  let paused = false;
  try {
    paused = Boolean(JSON.parse(data).IsPaused);
  } catch (e) {
    paused = data === true || data === "true";
  }

  if (!app) return;
  if (paused) {
    app.stop();
  } else {
    app.start();
  }
};

window.addEventListener("DOMContentLoaded", initApp);
