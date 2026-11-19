// Постобработка «АРТА: Башня»: одна короткая цепочка полноэкранных проходов поверх основного кадра.
//   сцена → цель с MSAA (тот же тональный оператор и sRGB, что и при прямом выводе: кадр до обработки совпадает
//   с прямым рендером пиксель в пиксель) → яркие места в ½ (и ¼) разрешения → размытие → сведение:
//   свечение ламп, виньетка, мягкая «плёночная» коррекция (холодные тени, тёплые света), красный свет ночного боя,
//   зерно. На уровне качества без postfx цепочки нет совсем — движок рисует прямо на экран.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// яркие места: 4 билинейные выборки (ячейка 4×4 пикселя источника) → порог по самой яркой составляющей
const FRAG_BRIGHT = `
uniform sampler2D tMap; uniform vec2 uPx; uniform vec2 uThr;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tMap, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture2D(tMap, vUv + uPx * vec2(1.0, -1.0)).rgb
         + texture2D(tMap, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture2D(tMap, vUv + uPx * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float m = max(c.r, max(c.g, c.b));
  float w = smoothstep(uThr.x, uThr.y, m);
  gl_FragColor = vec4(c * w * w, 1.0);
}`;
const FRAG_DOWN = `
uniform sampler2D tMap; uniform vec2 uPx;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tMap, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture2D(tMap, vUv + uPx * vec2(1.0, -1.0)).rgb
         + texture2D(tMap, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture2D(tMap, vUv + uPx * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
// размытие по Гауссу, 9 отсчётов за 5 билинейных выборок
const FRAG_BLUR = `
uniform sampler2D tMap; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tMap, vUv).rgb * 0.227027;
  c += (texture2D(tMap, vUv + uDir * 1.384615).rgb + texture2D(tMap, vUv - uDir * 1.384615).rgb) * 0.316216;
  c += (texture2D(tMap, vUv + uDir * 3.230769).rgb + texture2D(tMap, vUv - uDir * 3.230769).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;
const FRAG_FINAL = `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB;
uniform vec2 uPx; uniform vec3 uBloom;      // сила: узкое свечение, широкое, общий множитель
uniform vec4 uVig;                           // сила, внутренний радиус, внешний радиус, растяжение по ширине (углы темнее середины краёв)
uniform vec3 uGrade;                         // сила коррекции, контраст, ночь 0..1
uniform vec2 uGrain;                         // сила зерна, зерно-время
uniform vec4 uFlash;                         // rgb вспышки, сила
varying vec2 vUv;
#ifdef FXAA
vec3 sceneColor(vec2 uv){
  vec3 nw = texture2D(tScene, uv + uPx * vec2(-1.0, -1.0)).rgb, ne = texture2D(tScene, uv + uPx * vec2(1.0, -1.0)).rgb;
  vec3 sw = texture2D(tScene, uv + uPx * vec2(-1.0, 1.0)).rgb, se = texture2D(tScene, uv + uPx * vec2(1.0, 1.0)).rgb;
  vec3 m = texture2D(tScene, uv).rgb;
  const vec3 L = vec3(0.299, 0.587, 0.114);
  float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * uPx;
  vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
  float lb = dot(b, L);
  return (lb < lmin || lb > lmax) ? a : b;
}
#else
vec3 sceneColor(vec2 uv){ return texture2D(tScene, uv).rgb; }
#endif
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec3 c = sceneColor(vUv);
  // свечение: «экранное» наложение, чтобы светлое не выгорало
  #ifdef BLOOM
  vec3 b = texture2D(tBloomA, vUv).rgb * uBloom.x;
  #ifdef BLOOM_WIDE
  b += texture2D(tBloomB, vUv).rgb * uBloom.y;
  #endif
  b = min(b * uBloom.z, vec3(1.0));
  c = 1.0 - (1.0 - c) * (1.0 - b);
  #endif
  c += uFlash.rgb * uFlash.a * (1.0 - c);
  const vec3 L = vec3(0.299, 0.587, 0.114);
  float l = dot(c, L);
  // плёночная коррекция: чуть холоднее тени, теплее света, лёгкая S-кривая
  vec3 g = c * mix(vec3(0.94, 0.985, 1.07), vec3(1.045, 1.0, 0.93), smoothstep(0.08, 0.75, l));
  g = mix(g, g * g * (3.0 - 2.0 * g), uGrade.y);
  c = mix(c, g, uGrade.x);
  vec2 d = (vUv - vec2(0.5, 0.47)) * vec2(uVig.w, 1.0);
  float r = length(d) * 2.0;
  // ночь: красное боевое освещение — цвет уходит в красный, к краям сильнее; лампы остаются различимы по цвету
  float nk = uGrade.z;
  if (nk > 0.0) {
    float edge = smoothstep(0.25, 1.25, r);
    vec3 red = mix(vec3(1.0, 0.85, 0.79), vec3(0.82, 0.44, 0.37), edge);
    vec3 n = mix(c, vec3(l * 1.1, l * 0.9, l * 0.84), 0.25) * red;
    // горящие лампы сохраняют свой цвет: зелёную от красной надо отличать и ночью
    c = mix(c, n, nk * (1.0 - 0.65 * smoothstep(0.72, 0.98, max(c.r, max(c.g, c.b)))));
  }
  c *= 1.0 - uVig.x * smoothstep(uVig.y, uVig.z, r);
  #ifdef GRAIN
  float n = hash(gl_FragCoord.xy + uGrain.y) - 0.5;
  c += n * uGrain.x * (0.35 + 0.65 * (1.0 - abs(2.0 * l - 1.0)));
  #endif
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * Цепочка постобработки. renderer — THREE.WebGLRenderer.
 * post.configure(quality) — включить/выключить по уровню качества; post.setSize(w, h) — размер в пикселях буфера;
 * post.render(scene, camera, time, onMain) — кадр: основной проход в цель, затем проходы обработки на экран
 * (onMain вызывается сразу после основного прохода — движок снимает счётчики вызовов).
 */
export function createPost(renderer) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(tri, null);
  quad.frustumCulled = false;
  const pscene = new THREE.Scene();
  pscene.add(quad);
  pscene.matrixWorldAutoUpdate = false;

  const mk = (frag, uniforms, defines) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const V2 = () => new THREE.Vector2();
  const mBright = mk(FRAG_BRIGHT, { tMap: { value: null }, uPx: { value: V2() }, uThr: { value: new THREE.Vector2(0.9, 1.0) } });
  const mDown = mk(FRAG_DOWN, { tMap: { value: null }, uPx: { value: V2() } });
  const mBlur = mk(FRAG_BLUR, { tMap: { value: null }, uDir: { value: V2() } });
  const uFinal = {
    tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, uPx: { value: V2() },
    uBloom: { value: new THREE.Vector3(0.75, 0.9, 1) }, uVig: { value: new THREE.Vector4(0.28, 0.85, 1.7, 1.25) },
    uGrade: { value: new THREE.Vector3(1, 0.1, 0) }, uGrain: { value: V2() }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
  };
  const mFinal = mk(FRAG_FINAL, uFinal);

  let active = false, cfg = null, w = 0, h = 0;
  let rtScene = null, rtA = null, rtA2 = null, rtB = null, rtB2 = null;
  const info = { passes: 0, calls: 0 };

  const small = (ww, hh) => {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, ww), Math.max(2, hh), { depthBuffer: false, type: THREE.UnsignedByteType });
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  function free() {
    for (const rt of [rtScene, rtA, rtA2, rtB, rtB2]) if (rt) rt.dispose();
    rtScene = rtA = rtA2 = rtB = rtB2 = null;
  }
  function build() {
    free();
    if (!active || !w || !h) return;
    const maxS = renderer.capabilities.maxSamples || 0;
    const samples = Math.min(cfg.samples || 0, maxS);
    rtScene = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false, samples, type: THREE.UnsignedByteType });
    // Цель помечена как «XR»: three применяет к ней тональный оператор и выходное пространство рендерера, как к экрану.
    // Поэтому материалы (в т.ч. toneMapped: false у видов из щели и окуляра) выглядят так же, как при прямом выводе.
    rtScene.isXRRenderTarget = true;
    rtScene.texture.colorSpace = renderer.outputColorSpace;
    rtScene.texture.internalFormat = 'RGBA8';        // байты уже в sRGB — повторное кодирование не нужно
    rtScene.texture.minFilter = rtScene.texture.magFilter = THREE.LinearFilter;
    rtScene.texture.generateMipmaps = false;
    const fx = samples === 0 && cfg.fxaa !== false;
    const wide = cfg.bloom >= 2, bloom = cfg.bloom > 0;
    if (bloom) {
      // bloom 2: узкое свечение в ½ + широкое в ¼; bloom 1: только ¼
      if (wide) { rtA = small(w >> 1, h >> 1); rtA2 = small(w >> 1, h >> 1); }
      rtB = small(w >> 2, h >> 2); rtB2 = small(w >> 2, h >> 2);
    }
    const def = {};
    if (fx) def.FXAA = 1;
    if (bloom) def.BLOOM = 1;
    if (wide) def.BLOOM_WIDE = 1;
    if (cfg.grain) def.GRAIN = 1;
    mFinal.defines = def; mFinal.needsUpdate = true;
    uFinal.uPx.value.set(1 / w, 1 / h);
  }

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    const c0 = renderer.info.autoReset ? 0 : renderer.info.render.calls;      // счётчик three сбрасывается на каждом render, если его не отключили
    renderer.render(pscene, cam);
    info.passes++; info.calls += renderer.info.render.calls - c0;
  }

  const post = {
    /** true — цепочка включена (уровни с postfx). */
    get active() { return active && !!rtScene; },
    /** Свечение 0…1.5 (множитель; пост может приглушить его у себя: station.post = { bloom: 0.6 }). */
    bloom: 1,
    /** Порог свечения в экранных значениях [начало, полная сила]: ниже начала ничего не светится. */
    threshold: [0.9, 1.0],
    /** Виньетка 0…1 и сила цветокоррекции 0…1. */
    vignette: 0.28, grade: 1, contrast: 0.1, grain: 0.035,
    /** Красный свет ночного боя 0…1 (ставит движок: engine.setNight). */
    night: 0,
    /** Вспышка поверх кадра: цвет и сила 0…1 (ставит engine.fx.flash, сама не гаснет). */
    flash: new THREE.Vector4(1, 0.9, 0.75, 0),
    /** { passes, calls } — полноэкранные проходы последнего кадра. */
    info,

    configure(q) {
      const on = !!(q && q.postfx);
      const key = on ? [q.samples, q.bloom, q.grain ? 1 : 0].join() : '';
      if (on === active && key === post._key) return;
      active = on; cfg = q; post._key = key;
      build();
    },
    setSize(ww, hh) {
      ww = Math.max(1, Math.floor(ww)); hh = Math.max(1, Math.floor(hh));
      if (ww === w && hh === h) return;
      w = ww; h = hh;
      build();
    },
    /** Основной проход в цель + обработка на экран. */
    render(scene, camera, time, onMain) {
      info.passes = 0; info.calls = 0;
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);
      if (onMain) onMain();
      const bloomOn = cfg.bloom > 0 && post.bloom > 0.001;
      if (bloomOn) {
        mBright.uniforms.uThr.value.set(post.threshold[0], post.threshold[1]);
        if (rtA) {
          mBright.uniforms.tMap.value = rtScene.texture; mBright.uniforms.uPx.value.set(1 / w, 1 / h);
          pass(mBright, rtA);
          mDown.uniforms.tMap.value = rtA.texture; mDown.uniforms.uPx.value.set(1 / rtA.width, 1 / rtA.height);
          pass(mDown, rtB);
        } else {
          // сразу в ¼: шаг выборки шире (ячейка 4×4 накрывается четырьмя билинейными выборками 2×2)
          mBright.uniforms.tMap.value = rtScene.texture; mBright.uniforms.uPx.value.set(1 / w, 1 / h);
          pass(mBright, rtB);
        }
        mBlur.uniforms.tMap.value = rtB.texture; mBlur.uniforms.uDir.value.set(1 / rtB.width, 0); pass(mBlur, rtB2);
        mBlur.uniforms.tMap.value = rtB2.texture; mBlur.uniforms.uDir.value.set(0, 1 / rtB.height); pass(mBlur, rtB);
        if (rtA) {
          mBlur.uniforms.tMap.value = rtA.texture; mBlur.uniforms.uDir.value.set(1 / rtA.width, 0); pass(mBlur, rtA2);
          mBlur.uniforms.tMap.value = rtA2.texture; mBlur.uniforms.uDir.value.set(0, 1 / rtA.height); pass(mBlur, rtA);
        }
      }
      uFinal.tScene.value = rtScene.texture;
      uFinal.tBloomA.value = rtA ? rtA.texture : (rtB ? rtB.texture : null);
      uFinal.tBloomB.value = rtB ? rtB.texture : null;
      uFinal.uBloom.value.set(rtA ? 0.5 : 0.85, 0.6, bloomOn ? post.bloom : 0);
      uFinal.uVig.value.x = post.vignette;
      uFinal.uGrade.value.set(post.grade, post.contrast, post.night);
      uFinal.uGrain.value.set(post.grain, (Math.floor(time * 24) % 97) * 13.7);
      uFinal.uFlash.value.copy(post.flash);
      pass(mFinal, null);
    },
    dispose() {
      free(); tri.dispose();
      for (const m of [mBright, mDown, mBlur, mFinal]) m.dispose();
    },
    _key: '',
  };
  return post;
}
