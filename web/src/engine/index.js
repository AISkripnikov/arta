// Движок «АРТА: Башня» — DESIGN §5. Точка входа: createEngine(canvas, opts).
import * as THREE from 'three';
import { loadFonts, fontState } from './fonts.js';
import { setMaxAnisotropy } from './textures.js';
import * as textures from './textures.js';
import * as geom from './geom.js';
import { createMaterials } from './materials.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRoom, ROOM } from './room.js';
import { createUI } from './controls/index.js';
import { createPost } from './post.js';
import { createFx } from './fx.js';
import { probeDevice } from './device.js';

export { ROOM };
export const DEFAULT_CAMERA = { position: [0, 1.42, 1.25], target: [0, 1.08, 0], fov: 46 };

const TAU = Math.PI * 2;
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function normPose(pose, base) {
  const b = base || DEFAULT_CAMERA, p = pose || {};
  const v = (a, d) => new THREE.Vector3().fromArray(a && a.isVector3 ? a.toArray() : (a || d));
  return { pos: v(p.position, b.position), target: v(p.target, b.target), fov: p.fov || b.fov };
}

/**
 * Процедурная карта окружения (PMREM): маленькая панорама помещения башни в «широком» диапазоне яркости — тёмный потолок,
 * горячие пятна плафонов, полоса дневного света из амбразуры, тёмный настил. Координаты — в осях поста (игрок смотрит
 * в −Z): движок поворачивает карту вместе с рамкой камеры, поэтому блики на каждом посту лежат одинаково и согласованы
 * с ключевым светом. night — красное боевое освещение: плафоны тёмно-красные, амбразура тёмная.
 */
function buildEnvironment(renderer, night) {
  const s = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(6, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uNight: { value: night ? 1 : 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'varying vec3 vP; uniform float uNight;',
        'void main(){',
        '  vec3 d = normalize(vP); float h = d.y;',
        '  vec3 lo = vec3(0.010, 0.011, 0.013), mid = vec3(0.050, 0.060, 0.072), top = vec3(0.020, 0.018, 0.016);',
        '  vec3 c = h < 0.0 ? mix(mid, lo, clamp(-h * 1.8, 0.0, 1.0)) : mix(mid, top, clamp(h * 1.5, 0.0, 1.0));',
        '  c *= 1.0 + 0.9 * exp(-pow((h - 0.12) * 4.5, 2.0));',                  // пояс стены, освещённый плафонами
        '  float az = atan(d.x, -d.z);',
        '  c *= 0.86 + 0.14 * step(0.5, fract(az * 3.8197));',                    // рёбра набора: чередование светлого и тёмного
        '  c += vec3(0.16, 0.10, 0.05) * exp(-pow(length(d.xz) * 2.4, 2.0)) * step(0.0, -h);',   // тёплое пятно на настиле под плафоном
        '  c = mix(c, vec3(dot(c, vec3(0.6, 0.3, 0.1))) * vec3(1.25, 0.34, 0.26), uNight) * mix(1.0, 0.55, uNight);',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
    }));
  s.add(shell);
  const lampGeo = new THREE.BoxGeometry(1, 1, 1);
  const lamp = (color, intensity, pos, scale, rotY) => {
    const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.fromArray(pos); m.scale.fromArray(scale); if (rotY) m.rotation.y = rotY; s.add(m); return m;
  };
  const warm = night ? '#ff3a22' : '#ffd9a8', k = night ? 0.45 : 1;
  lamp(warm, 16 * k, [-1.7, 3.4, 2.9], [1.2, 0.25, 1.2]);                 // центральный плафон: сверху-слева, из-за спины (как ключевой свет)
  lamp(night ? '#ff4630' : '#ffcf96', 2.2 * k, [0.4, 5.3, 0.6], [3.4, 0.1, 3.4]);   // отсвет на потолке вокруг него
  for (let i = 0; i < 8; i++) {                                           // плафоны в решётках по стене, в простенках
    const th = (i + 0.5) * Math.PI / 4;
    lamp(night ? '#ff3520' : '#ffdcae', (i === 3 || i === 4 ? 9 : 6) * k, [4.9 * Math.sin(th), 0.75, -4.9 * Math.cos(th)], [0.42, 0.55, 0.42], -th);
    lamp(night ? '#b02a18' : '#ffb878', 0.9 * k, [5.3 * Math.sin(th), 0.75, -5.3 * Math.cos(th)], [1.9, 2.6, 0.1], -th);   // пятно света на стене
  }
  // амбразура: полоса дневного света (ночью — тёмно-синяя)
  lamp(night ? '#1c2740' : '#cfe2ff', night ? 1.0 : 7.5, [3.1, 0.95, 4.2], [2.8, 0.17, 0.12], -Math.atan2(3.1, 4.2));
  lamp(night ? '#3a4a66' : '#9db8d8', night ? 0.9 : 2.0, [5.0, 0.3, -1.2], [0.3, 2.0, 2.8]);      // холодный отсвет справа (как контровой)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.025);
  pmrem.dispose();
  shell.geometry.dispose(); shell.material.dispose(); lampGeo.dispose();
  s.traverse(o => { if (o.isMesh && o.material !== shell.material) o.material.dispose(); });
  return rt;
}

/**
 * Мягкая тень дешевле штатной: 9 выборок карты (3×3, веса 1-2-1) вместо 17 у PCFShadowMap из three; при shadow.radius < 1
 * (уровень mid) — 4 выборки. Ветвление по однородной переменной: на всех пикселях одно и то же, шейдер один на оба уровня. На телефоне тень
 * считается в каждом освещённом пикселе, поэтому число выборок — главное в её цене. Не нашли место вставки — остаётся штатная.
 */
function patchShadowChunk() {
  const key = 'shadowmap_pars_fragment', src = THREE.ShaderChunk[key];
  if (!src || src.includes('ARTA_PCF9')) return;
  const a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'), b = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  if (a < 0 || b < a) return;
  THREE.ShaderChunk[key] = src.slice(0, a) + [
    '#if defined( SHADOWMAP_TYPE_PCF ) // ARTA_PCF9',
    '			vec2 ts = vec2( shadowRadius ) / shadowMapSize;',
    '			if ( shadowRadius < 1.0 ) {',          // уровень mid: 4 выборки (каждая — аппаратная 2×2 с фильтрацией) в углах полутекселя
    '				ts = vec2( 0.5 ) / shadowMapSize;',
    '				shadow = 0.25 * (',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( - ts.x, - ts.y ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( ts.x, - ts.y ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( - ts.x, ts.y ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( ts.x, ts.y ), shadowCoord.z ) );',
    '			} else',
    '			shadow = (',
    '				texture2DCompare( shadowMap, shadowCoord.xy + vec2( - ts.x, - ts.y ), shadowCoord.z ) +',
    '				texture2DCompare( shadowMap, shadowCoord.xy + vec2( ts.x, - ts.y ), shadowCoord.z ) +',
    '				texture2DCompare( shadowMap, shadowCoord.xy + vec2( - ts.x, ts.y ), shadowCoord.z ) +',
    '				texture2DCompare( shadowMap, shadowCoord.xy + vec2( ts.x, ts.y ), shadowCoord.z ) +',
    '				2.0 * ( texture2DCompare( shadowMap, shadowCoord.xy + vec2( - ts.x, 0.0 ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( ts.x, 0.0 ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, - ts.y ), shadowCoord.z ) +',
    '					texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, ts.y ), shadowCoord.z ) ) +',
    '				4.0 * texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z )',
    '			) * ( 1.0 / 16.0 );',
    '		',
  ].join('\n') + src.slice(b);
}

/**
 * Создаёт движок. Ждёт загрузки шрифта Oswald.
 * opts: { debug=false, maxPixelRatio=2, exposure=1.0, antialias=false }
 */
export async function createEngine(canvas, opts = {}) {
  await loadFonts();
  patchShadowChunk();

  const renderer = new THREE.WebGLRenderer({
    // MSAA буфера кадра выключен: high сглаживает в своей MSAA-цели постобработки, mid и low — плотностью пикселей 1.75 / 1.5
    // (буфер кадра с MSAA на телефоне — лишняя память и проход «сведения» каждый кадр, на SwiftShader — вдвое дороже кадр)
    canvas, antialias: opts.antialias === true, alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure || 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // тени: одна карта от ключевого света; перерисовывается только когда что-то сдвинулось (см. updateShadows)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
  // качество графики (настройка игрока). Телефон упирается в заливку и пропускную способность памяти: дороги полноэкранные
  // проходы обработки, MSAA-цели и тени в реальном времени; чёткость же даёт плотность пикселей, а не эффекты.
  //   pixelRatio — предел плотности пикселей холста (× CSS-пикселей, не больше devicePixelRatio; не ниже 1 CSS-пикселя);
  //   rtScale, samples — масштаб и MSAA текстур-видов постов (щель, окуляр); viewGap — не чаще одной перерисовки видов за
  //   столько секунд (0 — как задумано постом); seaSimple — простое море и небо в видах;
  //   shadow — сторона карты теней (0 — теней нет); shadowStatic — карта перерисовывается только при смене поста, по прилёте
  //   камеры и при смене уровня (не за каждым движением органов управления); postfx — цепочка постобработки; bloom — 2:
  //   свечение в ½ + ¼ разрешения, 1: только ¼, 0: нет; grain — зерно; vignette 'css' — виньетка слоем DOM поверх холста
  //   (без прохода по кадру); particles — доля частиц engine.fx (0 — частиц нет); chartPx — холст карты прокладки (px);
  //   fpsCap — 30 к/с, если игрок сам не выбрал частоту.
  const maxPR = opts.maxPixelRatio || 2;
  const QUALITY = {
    high: { tier: 'high', pixelRatio: maxPR, rtScale: 1, samples: 4, viewGap: 0, shadow: 1024, postfx: true, bloom: 2, grain: true, particles: 1, chartPx: 2048 },
    mid: { tier: 'mid', pixelRatio: Math.min(maxPR, 1.75), rtScale: 0.6, samples: 0, viewGap: 0.1, seaSimple: true, shadow: 512, shadowSoft: 0.9, shadowStatic: true,
      postfx: false, bloom: 0, grain: false, vignette: 'css', particles: 0.5, chartPx: 2048 },
    low: { tier: 'low', pixelRatio: Math.min(maxPR, 1.5), rtScale: 0.5, samples: 0, viewGap: 0.1, seaSimple: true, shadow: 0, postfx: false, bloom: 0, grain: false,
      particles: 0, chartPx: 2048, fpsCap: 30 },
  };
  const TIERS = ['low', 'mid', 'high'];
  let quality = QUALITY.high, maxPixelRatio = quality.pixelRatio;
  const post = createPost(renderer);
  let frameCap = 0, frameCapChosen = false;      // 0 — без ограничения; 30 — «экономия батареи»; chosen — частоту выбрал игрок

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050607);
  const envRTs = { day: buildEnvironment(renderer, false), night: null };      // ночная карта строится при первом ночном бое
  scene.environment = envRTs.day.texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, 2, 0.05, 30);
  scene.add(camera);

  // --- свет (§3): тёплый ключевой прожектор от плафона (единственный с тенью), холодное небо полусферы как заполнение,
  //     тёплый плафон в центре потолка и холодный контровой сбоку. Все идут за рамкой камеры; посты света не добавляют. ---
  const LIGHT = {
    day: { hemiSky: new THREE.Color(0x9fb2cc), hemiGround: new THREE.Color(0x2a2119), hemi: 0.46, key: new THREE.Color(0xffe2bd), keyI: 13.5,
      ceil: new THREE.Color(0xffc98f), rim: new THREE.Color(0x86a8dc), rimI: 3.4 },
    night: { hemiSky: new THREE.Color(0x9a7f88), hemiGround: new THREE.Color(0x21130e), hemi: 0.4, key: new THREE.Color(0xff8260), keyI: 13,
      ceil: new THREE.Color(0xff6a45), rim: new THREE.Color(0x6f86b8), rimI: 2.2 },
  };
  const hemi = new THREE.HemisphereLight(LIGHT.day.hemiSky, LIGHT.day.hemiGround, LIGHT.day.hemi);
  const keyLight = new THREE.SpotLight(LIGHT.day.key, LIGHT.day.keyI, 9, 0.9, 0.75, 1.6);
  const fillCeil = new THREE.PointLight(LIGHT.day.ceil, 4.3, 9, 1.6);      // центральный плафон
  const fillCool = new THREE.PointLight(LIGHT.day.rim, LIGHT.day.rimI, 7, 1.8);   // холодный контровой: справа, почти в плоскости пульта
  fillCeil.position.set(0, 2.25, 0);
  const fillCeil0 = fillCeil.intensity;
  keyLight.shadow.mapSize.set(quality.shadow || 512, quality.shadow || 512);
  keyLight.shadow.camera.near = 0.5; keyLight.shadow.camera.far = 7;
  keyLight.shadow.bias = -0.0007; keyLight.shadow.normalBias = 0.012;
  keyLight.shadow.radius = 1.4;
  keyLight.shadow.intensity = 0.6;                 // тень не глубже 60 %: подписи под маховиками остаются читаемыми
  keyLight.castShadow = quality.shadow > 0;
  scene.add(hemi, keyLight, keyLight.target, fillCeil, fillCool);
  const light = {
    night: 0, nightTarget: 0, nightAmount: 1, applied: -1,
    flashT: 0, flashDur: 0, flashI: 0, flashColor: new THREE.Color(), flashPos: new THREE.Vector3(), flashAt: false,
    rimColor: new THREE.Color(), rimI: LIGHT.day.rimI, keyI: LIGHT.day.keyI,
  };
  const _c = new THREE.Color();
  function applyMood(k) {
    const a = LIGHT.day, b = LIGHT.night;
    hemi.color.copy(a.hemiSky).lerp(b.hemiSky, k); hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, k);
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * k;
    keyLight.color.copy(a.key).lerp(b.key, k); light.keyI = a.keyI + (b.keyI - a.keyI) * k;
    fillCeil.color.copy(a.ceil).lerp(b.ceil, k);
    light.rimColor.copy(a.rim).lerp(b.rim, k); light.rimI = a.rimI + (b.rimI - a.rimI) * k;
    const want = k > 0.5 ? 'night' : 'day';
    if (!envRTs[want]) envRTs[want] = buildEnvironment(renderer, want === 'night');
    if (scene.environment !== envRTs[want].texture) scene.environment = envRTs[want].texture;
  }
  applyMood(0);
  /** Свет за кадр: смена дня/ночи, мигание ламп (идёт от room.flicker / setLampLevel), вспышка engine.fx.flash. */
  function updateLights(dt) {
    if (light.night !== light.nightTarget) {
      const d = light.nightTarget - light.night, stepK = dt / 0.8;
      light.night = Math.abs(d) <= stepK || dt === 0 ? light.nightTarget : light.night + Math.sign(d) * stepK;
    }
    if (light.night !== light.applied) { applyMood(light.night); light.applied = light.night; }
    post.night = light.night * light.nightAmount;
    // яркость ламп помещения 0…1 читаем по центральному плафону (её ведёт room: мигание при сотрясении, аварийный свет)
    const lamp = Math.max(0, Math.min(1.2, (fillCeil.intensity / fillCeil0 - 0.35) / 0.65));
    let key = light.keyI * (0.22 + 0.78 * lamp), rimI = light.rimI;
    fillCool.color.copy(light.rimColor);
    if (light.flashT < light.flashDur) {
      light.flashT += dt;
      const f = Math.max(0, 1 - light.flashT / light.flashDur), ff = f * f;
      if (light.flashAt) {
        fillCool.position.copy(light.flashPos);
        fillCool.color.lerp(light.flashColor, Math.min(1, ff * 3));
        rimI = rimI * (1 - ff) + light.flashI * 9 * ff;
      } else key *= 1 + light.flashI * ff;
    }
    keyLight.intensity = key; fillCool.intensity = rimI;
  }
  function flashLight(color, intensity, seconds, worldPos) {
    // более слабая вспышка не перебивает ещё не погасшую сильную
    const left = light.flashT < light.flashDur ? light.flashI * Math.pow(1 - light.flashT / light.flashDur, 2) : 0;
    if (intensity < left) return;
    light.flashColor.set(color); light.flashI = intensity; light.flashDur = Math.max(0.03, seconds); light.flashT = 0;
    light.flashAt = !!worldPos;
    if (worldPos) light.flashPos.copy(worldPos);
  }

  // --- тени: кто отбрасывает и кто принимает (правило — в README, раздел «Свет и тени») ---
  const casters = new WeakMap();                  // пост → [меши, отбрасывающие тень]
  const SHADOW_MIN = 0.03;                        // мельче 3 см тень не отбрасывают (стрелки, винты, заклёпки)
  function flagShadows(root, list) {
    const out = list || [];
    const walk = (o, noShadow, noCast) => {
      const ud = o.userData || {};
      noShadow = noShadow || ud.noShadow === true; noCast = noCast || ud.noCast === true;
      if (o.isMesh) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const lit = !!m && (m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial) && !m.transparent && m.visible !== false;
        const recv = lit && !noShadow;
        let cast = recv && !noCast && !o.isInstancedMesh;
        if (cast && ud.castShadow !== true) {
          const g = o.geometry;
          if (g && !g.boundingSphere) g.computeBoundingSphere();
          const r = g && g.boundingSphere ? g.boundingSphere.radius * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)) : 0;
          if (!(r >= SHADOW_MIN)) cast = false;
        }
        o.receiveShadow = recv; o.castShadow = cast;
        if (cast) out.push(o);
      }
      for (const ch of o.children) walk(ch, noShadow, noCast);
    };
    walk(root, false, false);
    return out;
  }
  let shDirty = true, shLast = -1, shSum = NaN;
  const shStats = { calls: 0, updates: 0 };
  function shadowSum() {
    const p = keyLight.position;
    let s = p.x * 1.37 + p.y * 0.77 + p.z * 2.11;
    const list = entered && casters.get(entered);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i], e = o.matrixWorld.elements;
        s += (e[0] + e[1] * 1.3 + e[5] * 1.7 + e[6] * 1.9 + e[10] * 2.3 + e[12] * 3.1 + e[13] * 3.7 + e[14] * 4.1) * (1 + (i % 17) * 0.13)
          + (o.visible && (!o.parent || o.parent.visible) ? 0 : 7.7);
      }
    }
    return s;
  }
  /** Перед основным проходом: карта теней перерисовывается не чаще 15 раз в секунду и только если что-то сдвинулось. */
  function updateShadows() {
    if (!keyLight.castShadow) return;
    // «статичная» карта (уровень mid): только по shDirty — смена поста, прилёт камеры, смена уровня, engine.shadowsDirty()
    if (quality && quality.shadowStatic) {
      if (!shDirty || rig.tr) return;
      shDirty = false; shLast = time; shSum = NaN;
      renderer.shadowMap.needsUpdate = true;
      return;
    }
    if (engine.input && engine.input.busy) shDirty = true;
    if (time - shLast < 1 / 15 && shLast >= 0 && time >= shLast) return;
    const sum = shadowSum();
    if (sum !== shSum) { shSum = sum; shDirty = true; }
    if (!shDirty) return;
    shDirty = false; shLast = time;
    renderer.shadowMap.needsUpdate = true;
  }
  {
    // счётчик вызовов прохода теней: three рисует карту внутри renderer.render и обнуляет renderer.info уже после неё
    const sm = renderer.shadowMap, render0 = sm.render;
    sm.render = function (lights, sc, cam) {
      const will = sm.needsUpdate && sc === scene && lights.length > 0;
      const c0 = renderer.info.render.calls;
      render0.call(sm, lights, sc, cam);
      if (will) { shStats.calls = renderer.info.render.calls - c0; shStats.updates++; shStats.fresh = true; }
    };
  }

  const listeners = new Map();
  const frameFns = new Set();
  const stations = [];
  const byId = new Map();
  let current = null, entered = null;
  let running = false, raf = 0, lastT = 0, time = 0, started = false;
  let width = 0, height = 0, pixelRatio = 1, resolution = 0;      // resolution: 0 — по уровню, иначе выбор игрока «ЧЁТКОСТЬ»

  // --- камера: локальная поза + угол «рамки» вокруг центра помещения ---
  const rig = {
    angle: 0,                                   // угол рамки (рад, по часовой сверху), 0 — пост №0
    pose: normPose(null),                       // текущая локальная поза
    tr: null,                                   // { fromPose, toPose, fromAngle, dAngle, t, dur, arc, resolve }
    shakeAmp: 0, shakeT: 0, shakeDur: 0, shakeSeed: 0,
  };
  const _pos = new THREE.Vector3(), _tgt = new THREE.Vector3();

  function localToWorld(angle, v, out) {
    const c = Math.cos(angle), s = Math.sin(angle);
    // поворот Y на −angle и перенос в центр поста на кольце
    return out.set(v.x * c - v.z * s + ROOM.ring * s, v.y, v.x * s + v.z * c - ROOM.ring * c);
  }

  function startTransition(toAngle, toPose, seconds, arc) {
    if (rig.tr && rig.tr.resolve) rig.tr.resolve(false);
    if (!(seconds > 0)) {
      rig.angle = toAngle; rig.pose = toPose; rig.tr = null;
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      rig.tr = {
        fromPose: { pos: rig.pose.pos.clone(), target: rig.pose.target.clone(), fov: rig.pose.fov },
        toPose, fromAngle: rig.angle, dAngle: wrapPi(toAngle - rig.angle), toAngle, t: 0, dur: seconds, arc, resolve,
      };
    });
  }

  function updateRig(dt) {
    const tr = rig.tr;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const k = ease(tr.t);
      rig.pose.pos.lerpVectors(tr.fromPose.pos, tr.toPose.pos, k);
      rig.pose.target.lerpVectors(tr.fromPose.target, tr.toPose.target, k);
      rig.pose.fov = tr.fromPose.fov + (tr.toPose.fov - tr.fromPose.fov) * k;
      rig.angle = tr.fromAngle + tr.dAngle * k;
      if (tr.arc) {                              // при перелёте чуть отходим к центру помещения
        const b = Math.sin(Math.PI * k) * Math.min(1, Math.abs(tr.dAngle) / 1.0);
        rig.pose.pos.z += 0.16 * b; rig.pose.target.y += 0.05 * b;
      }
      if (tr.t >= 1) {
        rig.angle = tr.toAngle;
        rig.pose = { pos: tr.toPose.pos.clone(), target: tr.toPose.target.clone(), fov: tr.toPose.fov };
        rig.tr = null;
        tr.resolve(true);
        shDirty = true;                          // свет идёт за камерой: «статичную» карту теней — заново на новом месте
        if (tr.arc) emit('arrive', current);
      }
    }
    localToWorld(rig.angle, rig.pose.pos, _pos);
    localToWorld(rig.angle, rig.pose.target, _tgt);
    camera.position.copy(_pos);
    // на узких экранах (уже 16:9) расширяем вертикальный угол, чтобы пульт помещался по ширине
    const aspect = camera.aspect, ref = 16 / 9;
    let fov = rig.pose.fov;
    if (aspect < ref) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * ref / aspect));
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.up.set(0, 1, 0);
    camera.lookAt(_tgt);
    if (rig.shakeT < rig.shakeDur) {
      rig.shakeT += dt;
      const f = Math.max(0, 1 - rig.shakeT / rig.shakeDur), a = rig.shakeAmp * f * f, t = rig.shakeT * 38 + rig.shakeSeed;
      camera.position.x += a * 0.03 * Math.sin(t * 1.31);
      camera.position.y += a * 0.035 * Math.sin(t * 1.93 + 1.7);
      camera.position.z += a * 0.02 * Math.sin(t * 1.13 + 0.6);
      camera.rotateZ(a * 0.018 * Math.sin(t * 1.57 + 2.2));
      camera.rotateX(a * 0.012 * Math.sin(t * 2.21 + 0.3));
    }
    camera.updateMatrixWorld();

    // свет держится у текущей рамки; карта окружения поворачивается вместе с ней
    localToWorld(rig.angle, _tgt.set(-0.78, 2.32, 1.2), keyLight.position);
    localToWorld(rig.angle, _tgt.set(0.2, 1.02, -0.2), keyLight.target.position);
    keyLight.target.updateMatrixWorld();
    localToWorld(rig.angle, _tgt.set(1.6, 1.72, 0.34), fillCool.position);
    scene.environmentRotation.y = -rig.angle;

    // видимость постов: текущий и соседние по кольцу (по углу рамки — корректно и во время перелёта)
    for (const st of stations) {
      const d = Math.abs(wrapPi(st.angle - rig.angle));
      st.group.visible = d < 1.5 * TAU / ROOM.slots || st.id === current;
    }
  }

  // --- события ---
  function on(name, fn) {
    let set = listeners.get(name);
    if (!set) listeners.set(name, set = new Set());
    set.add(fn);
    return () => set.delete(fn);
  }
  function off(name, fn) { const set = listeners.get(name); if (set) set.delete(fn); }
  function emit(name, ...args) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(...args); } catch (e) { console.error('[engine] ошибка в обработчике «' + name + '»:', e); }
    }
  }
  const safeCall = (obj, name, ...args) => {
    if (obj && typeof obj[name] === 'function') {
      try { return obj[name](...args); } catch (e) { console.error('[engine] ошибка в ' + (obj.id || '') + '.' + name + ':', e); }
    }
  };

  // --- размер ---
  function checkResize(force) {
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    // плотность пикселей: по уровню (quality.pixelRatio) или выбор игрока «ЧЁТКОСТЬ» (engine.setResolution) — не больше devicePixelRatio
    const pr = Math.min(window.devicePixelRatio || 1, resolution > 0 ? resolution : maxPixelRatio);
    if (!w || !h) return;
    if (force || w !== width || h !== height || pr !== pixelRatio) {
      width = w; height = h; pixelRatio = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      post.setSize(Math.floor(w * pr), Math.floor(h * pr));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      emit('resize', w, h);
      rod.need = Math.max(rod.need, 2);
    }
  }

  // --- кадр ---
  const stats = { calls: 0, triangles: 0, frameMs: 0, fps: 0, frames: 0, shadowCalls: 0, postCalls: 0, postPasses: 0 };
  let fpsT = 0, fpsN = 0, mainC0 = 0, mainT0 = 0;
  const grabStats = () => {                       // сразу после основного прохода: дальше renderer.info затрут проходы обработки
    stats.shadowCalls = shStats.fresh ? shStats.calls : 0; shStats.fresh = false;
    // с выключенным автосбросом (замер tools/perf.cjs) счётчик three накопительный: берём прирост и вычитаем проход теней
    const acc = !renderer.info.autoReset;
    stats.calls = renderer.info.render.calls - (acc ? mainC0 + stats.shadowCalls : 0);
    stats.triangles = renderer.info.render.triangles - (acc ? mainT0 : 0);
  };
  function step(dt, render = true) {
    const t0 = performance.now();
    time += dt; rod.inMain = false;
    checkResize(false);
    for (const fn of Array.from(frameFns)) {
      try { fn(dt, time); } catch (e) { console.error('[engine] ошибка в onFrame:', e); }
    }
    updateRig(dt);
    updateLights(dt);
    for (const st of stations) if (st.group.visible) safeCall(st, 'update', dt, time);
    engine.fx._resize(height * pixelRatio, camera.fov);
    engine.fx._update(dt, time);
    if (render === 'auto') {
      render = wantRender();
      if (!render) { rod.drew = false; rod.skipped++; }
    }
    if (render) {
      rod.drew = true; rod.n++; rod.rendered++; rod.last = time; rod.rt = false; if (rod.need > 0) rod.need--;
      rod.inMain = true;
      try {
        updateShadows();
        mainC0 = renderer.info.render.calls; mainT0 = renderer.info.render.triangles;
        if (post.active) {
          post.render(scene, camera, time, grabStats);
          stats.postCalls = post.info.calls; stats.postPasses = post.info.passes;
        } else {
          renderer.render(scene, camera);
          grabStats();
          stats.postCalls = 0; stats.postPasses = 0;
        }
      } catch (e) {
        // тени или постобработка не работают на этом устройстве — выключаем их и рисуем кадр напрямую, без чёрного экрана
        if (gfxSafe) throw e;
        degrade('ошибка кадра', e);
        try { renderer.setRenderTarget(null); renderer.render(scene, camera); grabStats(); } catch (e2) { console.error('[engine] кадр не нарисован:', e2); }
      }
      rod.inMain = false;
      // отрисовка сама меняет кое-что в сцене (three: прозрачный двусторонний материал рисуется в два прохода и при этом
      // поднимает material.version) — подпись снимаем заново после кадра, иначе следующий кадр всегда «изменился»
      if (onDemand) rod.sig = sceneSig();
    } else if (render === false) scene.updateMatrixWorld();
    const ms = performance.now() - t0;
    stats.frameMs += (ms - stats.frameMs) * (stats.frames < 5 ? 1 : 0.08);
    stats.frames++;
  }
  // Пропущенный кадр не трогает холст, и некоторые сборки Chromium (headless) тогда реже зовут requestAnimationFrame.
  // Чтобы логика боя шла с прежней частотой, после пропущенного кадра взводится таймер: если rAF не пришёл за ~33 мс,
  // шаг делается по таймеру (на телефоне rAF приходит раньше, таймер снимается).
  let wd = 0;
  const WD_MS = 34;
  function watchdog() {
    wd = 0;
    // свёрнутое приложение или уход со страницы: rAF стоит — стоит и логика, как раньше (таймер не тикает в фоне)
    if (!running || document.hidden) return;
    const drew = tick(performance.now());
    if (running && onDemand && !drew && !wd) wd = setTimeout(watchdog, WD_MS);
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (wd) { clearTimeout(wd); wd = 0; }
    const drew = tick(now);
    if (onDemand && !drew && !wd) wd = setTimeout(watchdog, WD_MS);
  }
  function tick(now) {
    // шаг по таймеру ставит lastT = performance.now(), а метка rAF — начало кадра, она бывает раньше: время назад не идёт
    // (иначе следующий шаг посчитал бы тот же промежуток дважды)
    if (lastT && now < lastT) now = lastT;
    // ограничение кадров: лишние кадры пропускаем целиком, dt следующего — полное время с прошлого отрисованного
    const cap = effCap();
    if (cap && lastT && now - lastT < 1000 / cap - 3) return false;
    const dt = lastT ? Math.min(0.05, Math.max(0, (now - lastT) / 1000)) : 0;
    if (lastT) {
      fpsT += now - lastT; fpsN++;
      if (fpsT >= 500) { stats.fps = fpsN * 1000 / fpsT; stats.renderFps = rod.n * 1000 / fpsT; fpsT = 0; fpsN = 0; rod.n = 0; }
      // «АВТО» меряет только интервал после нарисованного кадра: пропущенный кадр (сцена стоит) ничего не говорит о GPU
      if (rod.drew) autoSample(now - lastT);
    }
    lastT = now;
    step(dt, onDemand ? 'auto' : true);
    return rod.drew;
  }

  // --- рисование по требованию: башня большую часть времени неподвижна. Кадр рисуется, только если что-то изменилось:
  //     камера (перелёт, тряска), ввод (палец на органе управления), свет (мигание, вспышка, ночь), частицы, виды постов
  //     (их renderer.render в свою цель), перерисованные текстуры, сдвинутые или перекрашенные меши (сверка «подписи» сцены),
  //     engine.invalidate(seconds) от постов, смена размера и качества; плюс страховочный кадр раз в секунду.
  //     Логика (onFrame, update постов, эффекты) идёт каждый кадр как раньше. ---
  let onDemand = opts.onDemand !== false;
  const rod = { need: 3, until: 0, rt: false, sig: NaN, last: -1, drew: true, n: 0, skipped: 0, rendered: 0, frameNo: 0, inMain: false, why: {} };
  {
    const render0 = renderer.render;
    renderer.render = function (sc, cam) {
      if (!rod.inMain && sc !== scene) rod.rt = true;          // пост обновил свой вид (щель, окуляр, ПВО, карта)
      return render0.call(this, sc, cam);
    };
  }
  const sigStack = [];
  function texSig(t) { return t ? t.version * 1.31 + t.id * 0.0173 + t.offset.x * 3.7 + t.offset.y * 4.3 + t.repeat.x * 0.9 + t.repeat.y * 1.1 + t.rotation * 2.9 : 0; }
  function matSig(m) {
    if (m.__rodF === rod.frameNo) return m.__rodV;
    let s = m.version * 1.3 + m.opacity * 2.1 + (m.visible ? 0.7 : 0) + m.id * 0.0011;
    if (m.color) s += m.color.r * 1.7 + m.color.g * 2.3 + m.color.b * 2.9;
    if (m.emissive) s += m.emissive.r * 3.1 + m.emissive.g * 3.7 + m.emissive.b * 4.1 + (m.emissiveIntensity || 0) * 4.7;
    if (m.map) s += texSig(m.map);
    if (m.emissiveMap) s += texSig(m.emissiveMap) * 0.7;
    if (m.alphaMap) s += texSig(m.alphaMap) * 0.5;
    if (m.size !== undefined) s += m.size * 1.9;
    const u = m.uniforms;
    if (u) {
      let k = 1;
      for (const n in u) {
        const v = u[n] && u[n].value; k += 0.37;
        if (typeof v === 'number') s += v * k;
        else if (v === true) s += k;
        else if (v && typeof v === 'object') {
          if (v.isTexture) s += texSig(v) * k;
          else if (v.isColor) s += (v.r + v.g * 1.3 + v.b * 1.7) * k;
          else if (v.x !== undefined) s += (v.x + v.y * 1.3 + (v.z || 0) * 1.7 + (v.w || 0) * 2.1) * k;
          else if (v.elements) { const e = v.elements; for (let i = 0; i < e.length; i++) s += e[i] * (i + 1) * 0.01 * k; }
          else if (v.length !== undefined && v.length < 64) for (let i = 0; i < v.length; i++) { const x = v[i]; s += (typeof x === 'number' ? x : x && x.x !== undefined ? x.x + x.y * 1.3 + (x.z || 0) * 1.7 : 0) * (i + 1) * 0.1 * k; }
        }
      }
    }
    m.__rodF = rod.frameNo; m.__rodV = s;
    return s;
  }
  /** «Подпись» того, что видно: позы видимых объектов, материалы, версии геометрий и текстур, свет, камера, постобработка. */
  function sceneSig() {
    rod.frameNo++;
    let s = 0, k = 1;
    const ce = camera.matrixWorld.elements;
    for (let i = 0; i < 16; i++) s += ce[i] * (i + 1) * 0.37;
    s += camera.fov * 3.3 + camera.aspect * 1.7 + (scene.environment ? scene.environment.id * 0.1 : 0) + scene.environmentRotation.y * 2.3
      + Math.round(renderer.toneMappingExposure * 2000) * 0.0019 + renderer.toneMapping * 0.7;   // экспозиция (оболочка: отказ света, ночь) — с шагом, без «вечного» дрожания
    s += post.night * 5.1 + post.bloom * 2.9 + post.vignette * 1.3 + post.grade * 1.1 + post.contrast * 0.7 + post.grain * 0.3
      + post.flash.x * 0.11 + post.flash.y * 0.13 + post.flash.z * 0.17 + post.flash.w * 7.3 + (post.active ? 1 : 0);
    const st = sigStack; st.length = 0; st.push(scene);
    let sNaN = s;                                     // NaN в чьём-то параметре не должен делать «изменилось» каждый кадр
    while (st.length) {
      const o = st.pop();
      k++;
      if (!o.visible) { s += k * 0.0131; continue; }
      const w = 1 + (k % 97) * 0.0101;
      if (o.matrixAutoUpdate) {
        const p = o.position, q = o.quaternion, c = o.scale;
        s += (p.x * 1.1 + p.y * 1.3 + p.z * 1.7 + q.x * 2.3 + q.y * 2.9 + q.z * 3.1 + q.w * 3.7 + c.x * 4.1 + c.y * 4.3 + c.z * 4.7) * w;
      } else {
        const m = o.matrix.elements;
        s += (m[0] + m[1] * 3.7 + m[2] * 4.1 + m[5] * 1.3 + m[10] * 1.7 + m[12] * 2.3 + m[13] * 2.9 + m[14] * 3.1) * w;
      }
      if (o.material) {
        const g = o.geometry;
        if (g) {
          const a = g.attributes;
          for (const n in a) { const at = a[n]; s += (at.isInterleavedBufferAttribute ? at.data.version : at.version) * 0.71 * w; }
          if (g.index) s += g.index.version * 0.53;
          s += g.id * 0.0007 + g.drawRange.start * 0.3 + Math.min(g.drawRange.count, 1e7) * 0.0003;
          if (g.morphAttributes && o.morphTargetInfluences) for (let i = 0; i < o.morphTargetInfluences.length; i++) s += o.morphTargetInfluences[i] * (i + 2);
        }
        if (o.isInstancedMesh) s += o.instanceMatrix.version * 1.9 + o.count * 0.7 + (o.instanceColor ? o.instanceColor.version * 1.3 : 0);
        const mt = o.material;
        if (Array.isArray(mt)) { for (let i = 0; i < mt.length; i++) s += matSig(mt[i]) * (i + 1) * w; } else s += matSig(mt) * w;
        s += o.renderOrder * 0.31 + (o.frustumCulled ? 0.1 : 0);
      } else if (o.isLight) {
        s += (o.intensity * 5.3 + o.color.r + o.color.g * 2 + o.color.b * 3 + (o.castShadow ? 1.9 : 0)) * w;
      }
      if (s !== s) { s = sNaN; if (!rod.nan) rod.nan = (o.name || o.type) + '#' + o.id + (o.material ? ' ' + (o.material.name || o.material.type) : ''); }
      sNaN = s;
      const ch = o.children;
      s += ch.length * 0.017 * w;
      for (let i = 0; i < ch.length; i++) st.push(ch[i]);
    }
    return s;
  }
  /** Нужен ли кадр. Дешёвые признаки — сначала; подпись сцены считается всегда (чтобы после кадра она была свежей). */
  function wantRender() {
    const sig = sceneSig();
    const changed = !(sig === rod.sig);
    rod.sig = sig;
    const why = changed ? 'scene' : rod.need > 0 ? 'need' : rod.rt ? 'view' : time < rod.until ? 'invalidate' : rig.tr ? 'camera' : rig.shakeT < rig.shakeDur ? 'shake'
      : light.flashT < light.flashDur ? 'flash' : light.night !== light.nightTarget ? 'night' : engine.fx && engine.fx.particles > 0 ? 'particles'
      : engine.input && engine.input.busy ? 'input' : time - rod.last >= 1 || time < rod.last ? 'keepalive' : shDirty && keyLight.castShadow ? 'shadow' : '';
    if (why) rod.why[why] = (rod.why[why] || 0) + 1;
    return !!why;
  }
  /** Частота кадров по уровню: «экономное» — не чаще 30 к/с, если игрок сам не выбрал частоту (engine.setFrameCap(n, true)). */
  function effCap() { return frameCap || (quality && quality.fpsCap && !frameCapChosen ? quality.fpsCap : 0); }

  // --- качество ---
  // Запасной режим: если тени или постобработка дали ошибку (нет нужного формата, шейдер не собрался на этом GPU),
  // они выключаются до конца запуска на любом уровне качества — с console.info, без падения и без чёрного экрана.
  let gfxSafe = false;
  function degrade(why, e) {
    if (gfxSafe) return;
    gfxSafe = true;
    console.info('[engine] тени и постобработка выключены (' + why + ')' + (e && e.message ? ': ' + e.message : ''));
    const q = quality; quality = null;
    applyQuality(q);
  }
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    let log = '';
    try { log = (gl.getProgramInfoLog(program) || '') + ' ' + (gl.getShaderInfoLog(vs) || '') + ' ' + (gl.getShaderInfoLog(fs) || ''); } catch (e) { /* нет журнала */ }
    degrade('шейдер не собрался', { message: log.trim().slice(0, 300) });
  };
  // виньетка уровня mid: неподвижный слой DOM поверх холста (браузер сводит его при выводе) вместо прохода обработки по кадру
  let vigEl = null;
  function cssVignette(on) {
    if (!on && !vigEl) return;
    try {
      if (!vigEl) {
        if (!canvas.parentNode || typeof document === 'undefined') return;
        vigEl = document.createElement('div');
        vigEl.id = 'stageVignette'; vigEl.setAttribute('aria-hidden', 'true');
        vigEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;' +
          'background:radial-gradient(ellipse farthest-corner at 50% 47%,rgba(0,0,0,0) 52%,rgba(0,0,0,.1) 72%,rgba(0,0,0,.27) 100%)';
        canvas.parentNode.insertBefore(vigEl, canvas.nextSibling);
      }
      vigEl.style.display = on ? 'block' : 'none';
    } catch (e) { /* без виньетки */ }
  }
  function applyQuality(q0) {
    if (q0 === quality) return q0;
    const q = gfxSafe ? Object.assign({}, q0, { shadow: 0, postfx: false, bloom: 0, grain: false }) : q0;
    quality = q0; maxPixelRatio = q.pixelRatio;
    const sh = keyLight.shadow;
    keyLight.castShadow = q.shadow > 0;
    sh.radius = q.shadowSoft || 1.4;
    if (q.shadow > 0 && sh.mapSize.x !== q.shadow) {
      sh.mapSize.set(q.shadow, q.shadow);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    shDirty = true; shLast = -1;
    post.configure(q);
    cssVignette((q.vignette === 'css' || q0.postfx) && !post.active);      // и high, если обработка выключилась после ошибки
    engine.fx._setQuality(q);
    checkResize(false);
    AQ.hold = Math.max(AQ.hold, 1.5); AQ.slow = 0; AQ.good = 0; AQ.acc = 0; AQ.n = 0;
    rod.need = Math.max(rod.need, 3);
    emit('quality', q);
    // тени включились/выключились — у освещаемых материалов другие шейдеры: собираем их заранее, параллельно (KHR_parallel_shader_compile),
    // чтобы первый кадр нового уровня не стоял на компиляции
    if (started && renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) { try { renderer.compileAsync(scene, camera).catch(() => {}); } catch (e) { /* соберутся при отрисовке */ } }
    return q;
  }
  // «АВТО»: средний интервал между кадрами по окнам в 1 с. Четыре медленных окна подряд (> ~24 мс) — уровень ниже;
  // 30 с подряд с запасом — один раз за запуск вернуться на уровень выше. Подобранный уровень запоминается до следующего запуска.
  // Без «качелей»: уровень, на который «АВТО» спустилось, становится потолком подъёма (localStorage['arta2.autoCeil'] — уровень
  // и время) на 7 дней: подъём туда не пробуется ни в этом запуске, ни в следующих — до выбора игрока или повторного замера устройства.
  const AQ = { tier: 'high', acc: 0, n: 0, slow: 0, good: 0, ups: 0, downs: 0, hold: 2, last: 0, ceil: 'high' };
  const CEIL_KEY = 'arta2.autoCeil', CEIL_DAYS = 7;
  try { const v = localStorage.getItem('arta2.autoTier'); if (QUALITY[v]) { AQ.tier = v; AQ.stored = true; } } catch (e) { /* хранилище недоступно */ }
  try {
    const c = JSON.parse(localStorage.getItem(CEIL_KEY) || 'null');
    if (c && QUALITY[c.tier] && Date.now() - c.t < CEIL_DAYS * 864e5 && Date.now() >= c.t) AQ.ceil = c.tier;
  } catch (e) { /* хранилище недоступно */ }
  let device = null;
  function setCeil(tier) {
    AQ.ceil = tier;
    try { if (tier === 'high') localStorage.removeItem(CEIL_KEY); else localStorage.setItem(CEIL_KEY, JSON.stringify({ tier, t: Date.now() })); } catch (e) { /* хранилище недоступно */ }
  }
  function autoStep(dir) {
    const i = TIERS.indexOf(AQ.tier) + dir;
    if (i < 0 || i >= TIERS.length) return false;
    if (dir > 0 && i > TIERS.indexOf(AQ.ceil)) return false;     // выше потолка не поднимаемся
    AQ.tier = TIERS[i];
    if (dir < 0) setCeil(AQ.tier);                               // не потянул прежний уровень — выше нового больше не пробуем
    try { localStorage.setItem('arta2.autoTier', AQ.tier); } catch (e) { /* хранилище недоступно */ }
    if (dir > 0) AQ.ups++; else AQ.downs++;
    applyQuality(QUALITY[AQ.tier]);
    return true;
  }
  function autoSample(ms, cpuMs) {
    if (!engine.qualityAuto) return;
    const cpu = cpuMs == null ? stats.frameMs : cpuMs;
    if (!(ms > 0) || ms > 3000 || document.hidden) return;      // пауза, свёрнутое приложение — не замер
    ms = Math.min(ms, 1000);                                     // кадр в 1–3 с — очень медленный телефон, а не пауза
    if (AQ.hold > 0) { AQ.hold -= ms / 1000; return; }           // первые секунды и смена уровня: компиляция шейдеров
    AQ.acc += ms; AQ.n++;
    if (AQ.acc < 1000) return;
    // предел частоты (выбор игрока или 30 к/с уровня low): интервал в 33 мс — это предел, а не медленный телефон
    const avg = AQ.acc / AQ.n, capHz = effCap(), cap = capHz ? 1000 / capHz : 0;
    AQ.acc = 0; AQ.n = 0; AQ.last = avg;
    if (avg > Math.max(24, cap + 8)) { AQ.slow++; AQ.good = 0; }
    // с запасом: интервал в пределе и логика кадра быстрая (при пределе 30 к/с — вдвое строже: запаса по GPU не видно)
    else { AQ.slow = 0; AQ.good = avg <= Math.max(18, cap + 2) && cpu < (cap > 20 ? 4.5 : 9) ? AQ.good + 1 : 0; }
    if (AQ.slow >= 4) { AQ.slow = 0; autoStep(-1); }
    else if (AQ.good >= 30 && AQ.ups < 1) { AQ.good = 0; if (!autoStep(1)) AQ.ups = 1; }
  }

  function kick(amount, seconds) {
    if (engine.settings.shake === false) return;
    rig.shakeAmp = Math.max(amount, rig.shakeT < rig.shakeDur ? rig.shakeAmp * (1 - rig.shakeT / rig.shakeDur) : 0);
    rig.shakeDur = Math.max(0.05, seconds); rig.shakeT = 0; rig.shakeSeed = Math.random() * 100;
  }

  const engine = {
    THREE, scene, camera, renderer, canvas,
    /** Помощники для авторов постов: geom (slab, lathe, merge, boxUV…), textures (canvasTexture, drawLabel…). */
    geom, textures,
    fonts: fontState,
    lights: { hemi, key: keyLight, fillCeil, fillCool, rim: fillCool },

    get current() { return current; },
    /** Объект текущего поста. */
    get station() { return entered; },
    get stations() { return stations.slice(); },
    getStation(id) { return byId.get(id) || null; },
    /** true, пока камера летит между постами. */
    get flying() { return !!(rig.tr && rig.tr.arc); },
    get time() { return time; },
    get running() { return running; },

    /** Добавить пост. Порядок добавления = порядок по кольцу (по часовой, вид сверху). */
    addStation(station) {
      if (!station || !station.id || !station.group) throw new Error('addStation: нужен объект { id, group, … }');
      if (byId.has(station.id)) throw new Error('addStation: пост «' + station.id + '» уже добавлен');
      const index = stations.length;
      if (index >= ROOM.slots) console.warn('[engine] постов больше ' + ROOM.slots + ' — они наложатся друг на друга');
      const angle = index * TAU / ROOM.slots;
      station.index = index; station.angle = angle;
      station.group.userData.stationId = station.id;
      station.group.position.set(ROOM.ring * Math.sin(angle), 0, -ROOM.ring * Math.cos(angle));
      station.group.rotation.set(0, -angle, 0);
      scene.add(station.group);
      stations.push(station); byId.set(station.id, station);
      casters.set(station, flagShadows(station.group));
      if (!current) {                             // первый пост — текущий (onEnter придёт в start()/gotoStation)
        current = station.id;
        rig.angle = angle; rig.pose = normPose(station.camera);
      }
      updateRig(0);
      return station;
    },

    /**
     * Перелёт к посту (~0.7 с). Сразу вызывает onLeave старого и onEnter нового, шлёт 'station'(id);
     * по прилёте — 'arrive'(id). → Promise<boolean> (false, если перелёт был прерван другим).
     */
    gotoStation(id, o = {}) {
      const st = byId.get(id);
      if (!st) { console.warn('[engine] нет поста «' + id + '»'); return Promise.resolve(false); }
      const prev = entered, changed = prev !== st;
      if (changed) {
        if (prev) safeCall(prev, 'onLeave');
        entered = st; current = id;
        safeCall(st, 'onEnter');
        casters.set(st, flagShadows(st.group));     // пост мог достроить себя после addStation
        shDirty = true; shLast = -1;
        post.bloom = st.post && st.post.bloom != null ? st.post.bloom : 1;
        AQ.hold = Math.max(AQ.hold, 0.8);
        emit('station', id);
      }
      const steps = Math.round(Math.abs(wrapPi(st.angle - rig.angle)) / (TAU / ROOM.slots));
      const dur = o.instant ? 0 : (steps === 0 ? 0.4 : 0.7 + 0.16 * (steps - 1));
      const p = startTransition(st.angle, normPose(st.camera), dur, steps > 0);
      updateRig(0);
      if (o.instant && changed) emit('arrive', id);
      return p;
    },

    /**
     * Дополнительный вид в локальных координатах текущего поста; null — вернуть основной.
     * pose: { position, target, fov } (любое поле можно опустить — возьмётся из основного вида поста).
     */
    setCameraPose(pose, seconds = 0.5) {
      const st = entered || byId.get(current);
      const base = normPose(st && st.camera);
      const to = pose ? normPose(pose, { position: base.pos.toArray(), target: base.target.toArray(), fov: base.fov }) : base;
      const p = startTransition(st ? st.angle : rig.angle, to, seconds, false);
      updateRig(0);
      return p;
    },

    /** fn(dt, time) каждый кадр. → функция отписки. */
    onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },
    on, off, emit,

    start() {
      if (running) return;
      running = true; lastT = 0;
      checkResize(true);
      if (!started) {
        started = true;
        if (!entered && current) engine.gotoStation(current, { instant: true });
      }
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); if (wd) { clearTimeout(wd); wd = 0; } },

    /** Тряска камеры: amount ~0..1 (1 — выстрел главного калибра), seconds — длительность затухания.
     *  Настройка игрока engine.settings.shake = false камеру не трогает (лампы помещения мигают по-прежнему). */
    shake(amount = 1, seconds = 0.6) {
      kick(amount, seconds);
      if (engine.room) engine.room.flicker(Math.min(1, amount), seconds);
    },

    /** Карту теней нужно перерисовать (что-то сдвинулось без участия ввода). Движок и сам следит за мешами текущего поста. */
    shadowsDirty() { shDirty = true; },
    /** Расставить castShadow/receiveShadow в поддереве (пост достроил себя после addStation). Правило — в README. */
    flagShadows(object3D) {
      const st = entered || byId.get(current);
      if (st && casters.get(st)) {
        let inside = false;
        for (let o = object3D; o; o = o.parent) if (o === st.group) { inside = true; break; }
        if (inside) { casters.set(st, flagShadows(st.group)); shDirty = true; return; }
      }
      flagShadows(object3D); shDirty = true;
    },
    /**
     * Ночной бой: красное боевое освещение (цвет ламп, ночная карта окружения, красная коррекция кадра на уровнях с
     * постобработкой). amount 0…1 — сила красной коррекции (настройка игрока «красный свет ночью»).
     */
    setNight(on, amount = 1) { light.nightTarget = on ? 1 : 0; light.nightAmount = Math.max(0, Math.min(1, amount)); },
    get night() { return light.nightTarget > 0; },
    /** Постобработка: { active, bloom, threshold, vignette, grade, contrast, grain, night, info } — см. post.js. */
    post,

    /**
     * Качество графики: 'high' | 'mid' | 'low' → предел плотности пикселей 2 / 1.5 / 1, масштаб текстур-видов 1 / 0.75 / 0.5,
     * тени 1024 / 512 / нет, постобработка (свечение, виньетка, коррекция; зерно — только high) / нет, частицы.
     * Шлёт 'quality'(engine.quality) — посты меняют размер своих текстур.
     * 'auto' — движок сам подбирает уровень под телефон: engine.qualityAuto = true, уровень снижается, когда кадры
     * идут медленнее ~24 мс около 4 с подряд, и один раз за запуск возвращается на ступень выше после 30 с с запасом.
     * Повторный setQuality('auto') подобранный уровень не сбрасывает.
     */
    setQuality(tier) {
      const auto = tier === 'auto';
      if (auto && !engine.qualityAuto) { AQ.slow = 0; AQ.good = 0; AQ.acc = 0; AQ.n = 0; }
      if (!auto && QUALITY[tier] && AQ.ceil !== 'high') setCeil('high');     // выбор игрока снимает потолок «АВТО»
      engine.qualityAuto = auto;
      return applyQuality(QUALITY[auto ? AQ.tier : tier] || QUALITY.high);
    },
    /**
     * Распознать слабый телефон (device.js: ядра, память, имя GPU, пиксели экрана, замер ~0.3–0.5 с) и начать «АВТО» с
     * подходящего уровня — чтобы слабый телефон не строил текстуры и цели уровня high и не ждал смены уровня. Действует,
     * только пока «АВТО» не подобрало уровень (нет localStorage['arta2.autoTier']) или при o.force. Звать до создания постов.
     * → итог замера { tier, reasons, gpu, cores, memory, screenPx, cpu, gpuMs, ms } или null (уровень уже подобран).
     */
    probeDevice(o = {}) {
      if (AQ.stored && !o.force) return null;
      device = probeDevice(renderer, o);
      AQ.tier = device.tier; AQ.stored = true;
      if (AQ.ceil !== 'high') setCeil('high');
      try { localStorage.setItem('arta2.autoTier', device.tier); } catch (e) { /* хранилище недоступно */ }
      console.info('[engine] устройство: ' + device.tier + ' (' + (device.reasons.join(', ') || 'без ограничений') + '; GPU «' + device.gpu + '», ядер ' + device.cores +
        ', память ' + (device.memory || '?') + ', CPU ' + device.cpu + ', заливка ' + device.gpuMs + ' мс, замер ' + device.ms + ' мс)');
      return device;
    },
    get device() { return device; },
    /**
     * (расш.) «ЧЁТКОСТЬ»: плотность пикселей холста — 'auto' (или 0) по уровню качества (quality.pixelRatio), либо число
     * (0.75 / 1 / 1.25 / 1.5 / 2) × CSS-пикселей, не больше devicePixelRatio. Уровень качества её не меняет. → действующая плотность.
     */
    setResolution(v) {
      const n = typeof v === 'number' && isFinite(v) && v > 0 ? Math.max(0.5, Math.min(3, v)) : 0;
      if (n !== resolution) { resolution = n; checkResize(false); }
      return pixelRatio;
    },
    /** Выбор «ЧЁТКОСТИ»: 'auto' или число (см. setResolution). */
    get resolution() { return resolution > 0 ? resolution : 'auto'; },
    /** { tier, pixelRatio, rtScale, samples, viewGap, seaSimple, shadow, shadowStatic, postfx, bloom, grain, vignette, particles, chartPx, fpsCap } — текущее качество (только чтение). При 'auto' здесь уровень, действующий сейчас. */
    get quality() { return quality; },
    /** true — игрок выбрал качество «АВТО» (setQuality('auto')): уровень подбирает движок. */
    qualityAuto: false,
    /** Текущая плотность пикселей рендера (после ограничения качеством). */
    get pixelRatio() { return pixelRatio; },
    /** Ограничение кадров: 30 — рисовать не чаще 30 раз в секунду; 0 или 60 — без ограничения.
     *  chosen = true — частоту выбрал сам игрок: тогда и на «экономном» уровне она не ограничивается 30 к/с. */
    setFrameCap(n, chosen = false) { frameCap = n > 0 && n < 60 ? n : 0; frameCapChosen = !!chosen; },
    /** Частота, выбранная игроком (0 — без ограничения). Действующая (с учётом уровня) — frameCapActive. */
    get frameCap() { return frameCap; },
    get frameCapActive() { return effCap(); },
    /**
     * Рисование по требованию: кадр рисуется, только когда в сцене что-то изменилось (см. wantRender).
     * Пост, у которого есть анимация, которую движок не видит (например, меняет что-то вне сцены), зовёт
     * engine.invalidate(seconds) — рисовать каждый кадр ещё seconds секунд (0 — один кадр).
     */
    invalidate(seconds = 0) { rod.need = Math.max(rod.need, 1); if (seconds > 0) rod.until = Math.max(rod.until, time + seconds); },
    /** Выключить/включить рисование по требованию (по умолчанию включено; opts.onDemand = false — выключено). */
    setOnDemand(on) { onDemand = !!on; rod.need = Math.max(rod.need, 1); },
    get onDemand() { return onDemand; },

    /** Точка из локальных координат поста → мировые. */
    stationToWorld(id, v, out = new THREE.Vector3()) {
      const st = byId.get(id);
      const p = v.isVector3 ? v : new THREE.Vector3().fromArray(v);
      return st ? localToWorld(st.angle, p, out) : out.copy(p);
    },

    debug: {
      enabled: !!opts.debug,
      /** { calls (основной проход), triangles, frameMs (CPU, сглаж.), fps, geometries, textures, programs,
       *    tier, auto, autoMs (средний интервал кадров последнего окна «АВТО»), shadowCalls (вызовы прохода теней в последнем
       *    кадре, 0 — карта не перерисовывалась), shadowUpdates (сколько раз перерисована), postCalls, postPasses, particles } */
      stats() {
        return {
          calls: stats.calls, triangles: stats.triangles, frameMs: +stats.frameMs.toFixed(2), fps: +stats.fps.toFixed(1),
          tier: quality.tier, auto: !!engine.qualityAuto, autoTier: AQ.tier, autoCeil: AQ.ceil, resolution: resolution || 'auto', gfxSafe, autoMs: +AQ.last.toFixed(1), autoUps: AQ.ups, autoDowns: AQ.downs,
          shadowCalls: stats.shadowCalls, shadowUpdates: shStats.updates, postCalls: stats.postCalls, postPasses: stats.postPasses,
          particles: engine.fx ? engine.fx.particles : 0,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          programs: renderer.info.programs ? renderer.info.programs.length : 0,
          rendered: rod.rendered, skipped: rod.skipped, renderFps: +(stats.renderFps || 0).toFixed(1), onDemand, cap: effCap(), why: Object.assign({}, rod.why),
        };
      },
      /** Для проверки «АВТО» (tools/test-quality.cjs): подать count интервалов между кадрами по ms мс с временем логики cpuMs,
       *  как будто их намерил цикл кадров. Действует только при qualityAuto. */
      autoFeed(ms, count = 1, cpuMs = 4) { for (let i = 0; i < count; i++) autoSample(ms, cpuMs); return engine.debug.stats(); },
      /** Один кадр вручную (для тестов и снимков при остановленном цикле); render=false — только логика, без отрисовки. */
      step(dt = 1 / 60, render = true) { step(dt, render); },
      /** Кадр как в цикле: с рисованием по требованию (если оно включено). → true, если кадр нарисован (для tools/perf). */
      /** «Подпись» сцены для рисования по требованию (число; одинаковое — кадр не нужен). */
      sig() { return { sig: sceneSig(), nan: rod.nan || null }; },
      tick(dt = 1 / 60) { step(dt, onDemand ? 'auto' : true); return onDemand ? rod.drew : true; },
      /** Рамка зоны управления (|x| ≤ 0.85, 0.74 ≤ y ≤ 1.46, z = 0) и габарит поста у текущего поста. */
      guides(show = true) {
        if (engine.debug._guides) { engine.debug._guides.removeFromParent(); engine.debug._guides.geometry.dispose(); engine.debug._guides = null; }
        const st = entered || byId.get(current);
        if (!show || !st) return;
        const pts = [], line = (a, b) => pts.push(...a, ...b);
        const rect = (x0, y0, x1, y1, z) => { line([x0, y0, z], [x1, y0, z]); line([x1, y0, z], [x1, y1, z]); line([x1, y1, z], [x0, y1, z]); line([x0, y1, z], [x0, y0, z]); };
        rect(-0.85, 0.74, 0.85, 1.46, 0.002);
        rect(-0.9, 0, 0.9, 2.4, 0); rect(-0.9, 0, 0.9, 2.4, -0.95);
        line([-0.9, 0, 0.35], [0.9, 0, 0.35]);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4be36a, depthTest: false, toneMapped: false }));
        l.renderOrder = 999;
        st.group.add(l);
        engine.debug._guides = l;
      },
      _guides: null,
    },

    dispose() {
      engine.stop();
      engine.input.dispose();
      engine.audio.dispose();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
      document.removeEventListener('visibilitychange', onVisibility);
      if (overlay) overlay.remove();
      if (envRTs.day) envRTs.day.dispose();
      if (envRTs.night) envRTs.night.dispose();
      engine.fx.dispose(); post.dispose();
      if (keyLight.shadow.map) keyLight.shadow.map.dispose();
      engine.mat.dispose();
      renderer.dispose();
    },
  };

  /** Настройки игрока, которые читают органы управления: sens — чувствительность маховиков и рычагов привода (0.6…1.6, 1 — ход 1:1);
   *  invert — маховики крутят в обратную сторону; shake — тряска камеры (engine.shake) разрешена. */
  engine.settings = { sens: 1, invert: false, shake: true };
  /** Перехватчики действий постов (ставит оболочка). guards.fire(proceed) — пост ОГОНЬ вызывает его вместо game.fire();
   *  оболочка либо сразу зовёт proceed(), либо сперва спрашивает игрока. null — перехвата нет. */
  engine.guards = { fire: null };
  engine.mat = createMaterials();
  engine.audio = createAudio();
  engine.input = createInput(engine, canvas);
  engine.ui = createUI(engine);
  engine.room = createRoom(engine);
  scene.add(engine.room.group);
  engine.room.group.userData.noCast = true;       // помещение тени принимает, но не отбрасывает (стена — один большой меш)
  flagShadows(engine.room.group);
  /** Эффекты: shake, flash, flicker, dust, puff, sparks, clear — см. fx.js и README. */
  engine.fx = createFx(engine, {
    kick, flashLight, post,
    lampFlicker(amount, seconds) { if (engine.room) engine.room.flicker(Math.min(1, amount), seconds); },
  });
  engine.fx._setQuality(quality);
  post.configure(quality);

  // звук — после первого жеста пользователя
  function unlock() { engine.audio.unlock(); }
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchend', unlock, true);
  // свернули приложение — звук на паузу
  const onVisibility = () => { if (document.hidden) engine.audio.suspend(); else engine.audio.resume(); };
  document.addEventListener('visibilitychange', onVisibility);

  // отладочная плашка
  let overlay = null;
  if (opts.debug && canvas.parentNode) {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:6px;top:6px;z-index:9999;font:11px/1.3 monospace;color:#9fe8b0;' +
      'background:rgba(0,0,0,.55);padding:3px 6px;border-radius:3px;pointer-events:none;white-space:pre';
    canvas.parentNode.appendChild(overlay);
    let acc = 0;
    engine.onFrame(dt => {
      acc += dt; if (acc < 0.5) return; acc = 0;
      const s = engine.debug.stats();
      overlay.textContent = (current || '—') + '  ' + s.tier + (s.auto ? '*' : '') + '  ' + s.fps + ' к/с  ' + s.frameMs + ' мс  ' + s.calls + ' выз.  ' + (s.triangles / 1000).toFixed(1) + 'к тр.';
    });
  }

  checkResize(true);
  updateRig(0);
  return engine;
}
