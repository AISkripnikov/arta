// Распознавание слабого телефона при запуске (только для качества «АВТО», пока «АВТО» ещё не подобрало уровень само):
// число ядер, память, имя GPU (WEBGL_debug_renderer_info), пиксели экрана и короткий замер (~0.3–0.5 с на экране загрузки):
// счёт на процессоре и заливка полноэкранным шейдером на GPU. Итог — уровень, с которого начать: 'high' | 'mid' | 'low'.
// Ошибка где угодно — 'high' (как раньше: дальше «АВТО» снизит уровень по настоящим кадрам).
import * as THREE from 'three';

// заведомо слабые GPU: Mali-4xx/T6xx/T7xx/T8xx/G31/G51/G52/G57, Adreno 3xx/4xx/50x/51x/52x/530/605/608/610/612/613,
// PowerVR SGX/GE/GX/GM/Rogue, Vivante, Tegra 2–4, VideoCore, программная отрисовка (SwiftShader, llvmpipe)
const WEAK_GPU = /mali-?[34]\d\d|mali-?t[678]\d\d|mali-?g(31|51|52|57|68)\b|adreno[^\d]*(3\d\d|4\d\d|50\d|51\d|52\d|530|60[58]|61[023])\b|powervr|sgx|rogue|\bge8\d\d|\bgx6\d\d|\bgm9\d\d|vivante|gc\d{3,4}|tegra [234]|videocore|swiftshader|llvmpipe|softpipe|software|microsoft basic/i;
// средние: Mali-G71/G72/G76/G610, Adreno 616–619/620/630/640 — не ниже mid на старте
const MID_GPU = /mali-?g(71|72|76|77|610|615)\b|adreno[^\d]*(61[5-9]|620|630|640)\b|xclipse 5/i;

function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(r || '');
  } catch (e) { return ''; }
}

/** Счёт на процессоре: блоков в мс (на этой машине разработки без замедления ≈ 13, с замедлением ×4 ≈ 3.4). */
function cpuBench(ms) {
  const a = new Float32Array(256);
  let n = 0, x = 0.5;
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    for (let i = 0; i < 2000; i++) { x = Math.sin(x * 1.0001 + i) * 0.5 + 0.5; a[i & 255] += x; }
    n++;
  }
  return n / ms + a[0] * 0;
}

/** Заливка на GPU: 6 полноэкранных проходов шейдером средней тяжести в цель 512×512, мс (после прогрева и с ожиданием GPU). */
function gpuBench(renderer) {
  const rt = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform float uT;',
      'void main(){ vec2 p = vUv * 7.0 + uT; float s = 0.0;',
      '  for (int i = 0; i < 12; i++) { p = vec2(p.x * 1.07 + sin(p.y + float(i)), p.y * 0.93 + cos(p.x - uT)); s += fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
      '  gl_FragColor = vec4(vec3(s / 12.0), 1.0); }'].join('\n'),
    uniforms: { uT: { value: 0 } }, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.Camera(), px = new Uint8Array(4);
  const prev = renderer.getRenderTarget();
  const run = (n) => {
    for (let i = 0; i < n; i++) { mat.uniforms.uT.value = i * 0.37; renderer.setRenderTarget(rt); renderer.render(sc, cam); }
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px);
  };
  let ms = 0;
  try {
    run(1);                                        // компиляция шейдера и первая выделка цели — не в счёт
    const t0 = performance.now();
    run(6);
    ms = performance.now() - t0;
  } finally {
    renderer.setRenderTarget(prev);
    rt.dispose(); mat.dispose(); quad.geometry.dispose();
  }
  return ms;
}

/**
 * → { tier, reasons[], gpu, cores, memory, screenPx, cpu, gpuMs, ms }.
 * o.bench = false — без замера (только признаки устройства).
 */
export function probeDevice(renderer, o = {}) {
  const t0 = performance.now();
  const out = { tier: 'high', reasons: [], gpu: '', cores: 0, memory: 0, screenPx: 0, cpu: 0, gpuMs: 0, ms: 0 };
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const gl = renderer.getContext();
    out.gpu = gpuName(gl);
    out.cores = nav.hardwareConcurrency || 0;
    out.memory = nav.deviceMemory || 0;
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3);
    const sw = (typeof screen !== 'undefined' && Math.max(screen.width, screen.height)) || 0, sh = (typeof screen !== 'undefined' && Math.min(screen.width, screen.height)) || 0;
    out.screenPx = Math.round(sw * sh * dpr * dpr);
    let score = 2;                                 // 2 — high, 1 — mid, 0 — low
    const cap = (s, why) => { if (s < score) { score = s; } out.reasons.push(why); };
    if (WEAK_GPU.test(out.gpu)) cap(0, 'слабый GPU');
    else if (MID_GPU.test(out.gpu)) cap(1, 'средний GPU');
    if (out.memory && out.memory <= 2) cap(0, 'память ≤ 2 ГБ');
    else if (out.memory && out.memory <= 3) cap(1, 'память ≤ 3 ГБ');
    if (out.cores && out.cores <= 2) cap(0, 'ядер ≤ 2');
    else if (out.cores && out.cores <= 4) cap(1, 'ядер ≤ 4');
    if (o.bench !== false) {
      out.cpu = +cpuBench(140).toFixed(2);
      if (out.cpu < 4.5) cap(0, 'медленный процессор');
      else if (out.cpu < 7.5) cap(1, 'процессор средний');
      out.gpuMs = +gpuBench(renderer).toFixed(1);
      if (out.gpuMs > 45) cap(0, 'медленная заливка');
      else if (out.gpuMs > 16) cap(1, 'заливка средняя');
    }
    // большой экран с высокой плотностью при не самом быстром GPU — ступенью ниже (заливка растёт с пикселями)
    if (score === 2 && out.screenPx > 2.6e6 && out.gpuMs > 8) cap(1, 'много пикселей');
    out.tier = ['low', 'mid', 'high'][score];
  } catch (e) {
    out.tier = 'high'; out.reasons.push('ошибка замера: ' + (e && e.message));
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}
