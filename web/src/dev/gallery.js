// Стенд разработки «Галерея»: шесть макетных постов, собранных ТОЛЬКО из engine.ui,
// на которых показаны и связаны все типы органов управления.
//   node build.mjs --dev gallery  →  .dev/gallery/index.html#<id поста>
//   ←/→ или свайп — соседний пост; D — направляющие зоны управления; M — звук вкл/выкл.
import { createEngine } from '../engine/index.js';

const DEG = Math.PI / 180;
const TURN = Math.PI * 2;

/** Пульт типа «А»: тумба, наклонный стол (45°) и вертикальная панель приборов. */
function consoleA(engine) {
  const { ui, THREE } = engine;
  const group = new THREE.Group();
  const put = (p, x, y, z, rx = 0) => { p.object3D.position.set(x, y, z); p.object3D.rotation.x = rx; group.add(p.object3D); return p; };
  put(ui.panel({ w: 1.76, h: 0.74, d: 0.5, color: '#2b343d', rivets: 0.12, wear: 0.8 }), 0, 0.37, -0.25);
  put(ui.panel({ w: 1.72, h: 0.78, d: 0.2, color: '#2b343d', rivets: false, wear: 0.8 }), 0, 1.1, -0.37);
  const desk = put(ui.panel({ w: 1.76, h: 0.40, d: 0.045, rivets: 0.1 }), 0, 0.8496, 0.0768, -45 * DEG);
  const main = put(ui.panel({ w: 1.76, h: 0.49, d: 0.05, rivets: 0.1 }), 0, 1.2586, -0.1166, -8 * DEG);
  return { group, main, desk };
}

/** Пульт типа «Б»: тумба и высокая панель с наклоном 12°. */
function consoleB(engine) {
  const { ui, THREE } = engine;
  const group = new THREE.Group();
  const put = (p, x, y, z, rx = 0) => { p.object3D.position.set(x, y, z); p.object3D.rotation.x = rx; group.add(p.object3D); return p; };
  put(ui.panel({ w: 1.76, h: 0.70, d: 0.45, color: '#2b343d', rivets: 0.12, wear: 0.8 }), 0, 0.35, -0.33);
  put(ui.panel({ w: 1.72, h: 0.8, d: 0.2, color: '#2b343d', rivets: false, wear: 0.8 }), 0, 1.1, -0.38);
  const main = put(ui.panel({ w: 1.76, h: 0.84, d: 0.06, rivets: 0.1 }), 0, 1.0983, -0.026, -12 * DEG);
  return { group, main };
}

const title = (ui, text) => ui.plate(text, { size: 0.034, style: 'black' });
const fix = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

// ------------------------------------------------------------------ 1. ПЛАНШЕТ
function plotStation(engine) {
  const { ui, audio } = engine;
  const { group, main, desk } = consoleA(engine);
  const s = { bearing: 47.5, range: 8.4, x: 12.34, y: 7.8 };
  main.add(title(ui, 'ПЛАНШЕТ'), 0, 0.195);
  const cBearing = main.add(ui.drumCounter({ digits: 4, decimals: 1, unit: '°', wrap: 360, label: 'ПЕЛЕНГ', value: s.bearing }), -0.56, 0.02);
  const cRange = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: 'КМ', label: 'ДАЛЬНОСТЬ', value: s.range }), -0.14, 0.02);
  const cX = main.add(ui.drumCounter({ digits: 4, decimals: 2, label: 'X', digitH: 0.044, value: s.x }), 0.36, 0.02);
  const cY = main.add(ui.drumCounter({ digits: 4, decimals: 2, label: 'Y', digitH: 0.044, value: s.y }), 0.66, 0.02);
  const lampOk = main.add(ui.lamp({ color: 'green', label: 'СОВМЕЩЕНО' }), -0.56, -0.135);
  const bRecord = main.add(ui.pushButton({
    color: 'ochre', label: 'ЗАПИСАТЬ', radius: 0.032,
    onPress() { bRecord.setLit(true); audio.clunk(); setTimeout(() => bRecord.setLit(false), 600); },
  }), -0.14, -0.14);
  const nudge = (key, d, counter) => () => { s[key] = Math.max(0, Math.min(20, fix(s[key] + d, 2))); counter.setValue(s[key]); check(); };
  const bXm = main.add(ui.pushButton({ label: 'X −', hold: true, radius: 0.027, onPress: nudge('x', -0.01, cX) }), 0.29, -0.14);
  const bXp = main.add(ui.pushButton({ label: 'X +', hold: true, radius: 0.027, onPress: nudge('x', 0.01, cX) }), 0.43, -0.14);
  const bYm = main.add(ui.pushButton({ label: 'Y −', hold: true, radius: 0.027, onPress: nudge('y', -0.01, cY) }), 0.59, -0.14);
  const bYp = main.add(ui.pushButton({ label: 'Y +', hold: true, radius: 0.027, onPress: nudge('y', 0.01, cY) }), 0.73, -0.14);
  function check() { lampOk.set(Math.abs(s.bearing - 47.5) < 0.3 && Math.abs(s.range - 8.4) < 0.05 ? true : false); }
  const wBearing = desk.add(ui.handwheel({
    radius: 0.16,
    onTurn(d) { s.bearing = ((s.bearing + d / TURN * 10) % 360 + 360) % 360; cBearing.setValue(s.bearing); check(); },
  }), -0.56, 0);
  const wRange = desk.add(ui.handwheel({
    radius: 0.16, spokes: 3,
    onTurn(d) { s.range = Math.max(0, Math.min(22, s.range + d / TURN * 0.5)); cRange.setValue(s.range); check(); },
  }), -0.14, 0);
  desk.add(ui.plate('ПОРЯДОК РАБОТЫ\n1. ФИШКА НА ЦЕЛЬ\n2. НАВЕСТИ АЛИДАДУ\n3. ЗАПИСАТЬ ЗАМЕР', { style: 'ivory', size: 0.022, screws: false }), 0.5, 0.02);
  desk.add(ui.rivetRow([-0.2, 0, 0], [0.2, 0, 0], { spacing: 0.05 }), 0.5, -0.15);
  desk.add(ui.cable([[0.2, 0.16, 0.012], [0.3, 0.19, 0.03], [0.5, 0.165, 0.012], [0.7, 0.19, 0.03], [0.82, 0.16, 0.012]], { radius: 0.009 }), 0, 0);
  check();
  return {
    id: 'plot', title: 'ПЛАНШЕТ', group,
    controls: { cBearing, cRange, cX, cY, lampOk, bRecord, bXm, bXp, bYm, bYp, wBearing, wRange, state: s },
  };
}

// ------------------------------------------------------------------ 2. ВЫЧИСЛИТЕЛЬ
function computerStation(engine) {
  const { ui, audio } = engine;
  const { group, main, desk } = consoleA(engine);
  const s = { range: 8.4, fine: 0, charge: 2, stale: false, pulls: 0 };
  main.add(title(ui, 'ВЫЧИСЛИТЕЛЬ'), 0, 0.195);
  const cRange = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: 'КМ', label: 'ДАЛЬНОСТЬ', value: s.range }), -0.56, 0.02);
  const cElev = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', label: 'УГОЛ ВОЗВЫШЕНИЯ' }), 0.3, 0.02);
  const cTof = main.add(ui.drumCounter({ digits: 3, decimals: 1, unit: 'С', label: 'ВРЕМЯ ПОЛЁТА' }), 0.68, 0.02);
  main.add(ui.plate('ЗАРЯД ДОСТАЁТ', { size: 0.022, screws: false }), -0.13, 0.1);
  const chargeLamps = [];
  for (let i = 0; i < 6; i++) chargeLamps.push(main.add(ui.lamp({ color: 'green', radius: 0.017, label: String(i + 1), labelSize: 0.022 }), -0.305 + i * 0.07, 0.035));
  const lampsRed = [];
  for (let i = 0; i < 6; i++) { const l = main.add(ui.lamp({ color: 'red', radius: 0.012 }), -0.305 + i * 0.07, -0.075); lampsRed.push(l); }
  const reach = i => { const min = 1 + i * 2.2, max = 6 + i * 3.2; return s.range >= min && s.range <= max; };
  const refresh = () => { chargeLamps.forEach((l, i) => l.set(reach(i))); lampsRed.forEach((l, i) => l.set(!reach(i))); lampStale.set(s.stale ? 'blink' : false); };
  const tFine = main.add(ui.toggle({ labels: ['ГРУБО', 'ТОЧНО'], orient: 'h', value: 0, onChange(i) { s.fine = i; } }), -0.56, -0.15);
  const lampStale = main.add(ui.lamp({ color: 'amber', label: 'УСТАРЕЛО' }), 0.3, -0.13);
  const lampOut = main.add(ui.lamp({ color: 'red', label: 'ВНЕ ДАЛЬНОСТИ' }), 0.66, -0.13);
  const wRange = desk.add(ui.handwheel({
    radius: 0.16,
    onTurn(d) {
      s.range = Math.max(0.01, Math.min(22, s.range + d / TURN * (s.fine ? 0.1 : 2)));
      cRange.setValue(s.range); s.stale = s.pulls > 0; refresh();
    },
  }), -0.56, 0);
  const selector = desk.add(ui.rotarySelector({
    positions: 6, value: s.charge,
    onChange(i) { s.charge = i; s.stale = s.pulls > 0; refresh(); },
  }), -0.1, -0.01);
  desk.add(ui.plate('ЗАРЯД', { size: 0.024, screws: false }), -0.1, 0.165);
  const leverCompute = desk.add(ui.lever({
    mode: 'momentary', length: 0.2, labels: ['ВЫЧИСЛИТЬ'],
    onPull() {
      s.pulls++;
      if (!reach(s.charge)) { lampOut.set(true); audio.buzz(); setTimeout(() => lampOut.set(false), 900); return; }
      s.stale = false;
      cElev.setValue(fix(4 + s.range * 1.9 - s.charge * 2.6, 2));
      cTof.setValue(fix(6 + s.range * 2.4, 1));
      refresh();
    },
  }), 0.42, -0.02);
  desk.add(ui.pipe([[0.62, -0.17, 0.02], [0.62, 0.05, 0.02], [0.8, 0.05, 0.02], [0.8, 0.19, 0.02]], 0.016), 0, 0);
  refresh();
  return {
    id: 'computer', title: 'ВЫЧИСЛИТЕЛЬ', group,
    controls: { cRange, cElev, cTof, chargeLamps, lampsRed, tFine, lampStale, lampOut, wRange, selector, leverCompute, state: s },
  };
}

// ------------------------------------------------------------------ 3. ЗАРЯЖАНИЕ
function loadingStation(engine) {
  const { ui, audio } = engine;
  const { group, main } = consoleB(engine);
  const s = { open: false, shell: 0, loaded: false, rammed: false, charges: 0, he: 10, ap: 6 };
  main.add(title(ui, 'ЗАРЯЖАНИЕ'), 0, 0.345);
  const lampAngle = main.add(ui.lamp({ color: 'green', label: 'УГОЛ ЗАРЯЖАНИЯ', state: true }), -0.64, 0.2);
  const lampClosed = main.add(ui.lamp({ color: 'green', label: 'ЗАТВОР ЗАКРЫТ', state: true }), -0.36, 0.2);
  const lampShell = main.add(ui.lamp({ color: 'amber', label: 'СНАРЯД' }), -0.12, 0.2);
  const cCharges = main.add(ui.drumCounter({ digits: 1, label: 'ЗАРЯДОВ', digitH: 0.06 }), 0.13, 0.18);
  const cHe = main.add(ui.drumCounter({ digits: 2, label: 'ОФ', value: s.he }), 0.42, 0.18);
  const cAp = main.add(ui.drumCounter({ digits: 2, label: 'ББ', value: s.ap }), 0.68, 0.18);
  const leverBreech = main.add(ui.lever({
    mode: 'toggle', length: 0.2, labels: ['ЗАКРЫТ', 'ОТКРЫТ'],
    onChange(on) { s.open = on; lampClosed.set(!on); audio.breech(); },
  }), -0.68, -0.14);
  const tShell = main.add(ui.toggle({ labels: ['ОФ', 'ББ'], orient: 'h', onChange(i) { s.shell = i; } }), -0.36, -0.03);
  const bHoist = main.add(ui.pushButton({
    color: 'ochre', label: 'ПОДАТЬ СНАРЯД', radius: 0.034,
    onPress() {
      if (!s.open || s.loaded) { audio.buzz(); return; }
      s.loaded = true; lampShell.set('blink'); audio.hoist();
      if (s.shell) cAp.setValue(--s.ap); else cHe.setValue(--s.he);
    },
  }), -0.36, -0.2);
  const leverRam = main.add(ui.lever({
    mode: 'momentary', length: 0.2, labels: ['ДОСЛАТЬ'],
    onPull() { if (s.loaded && !s.rammed) { s.rammed = true; lampShell.set(true); audio.ram(); } else audio.buzz(); },
  }), -0.05, -0.16);
  const setCharges = d => () => { s.charges = Math.max(0, Math.min(6, s.charges + d)); cCharges.setValue(s.charges); };
  const bPlus = main.add(ui.pushButton({ label: 'ЗАРЯД +', hold: true, onPress: setCharges(1) }), 0.27, -0.06);
  const bMinus = main.add(ui.pushButton({ label: 'ЗАРЯД −', hold: true, onPress: setCharges(-1) }), 0.27, -0.24);
  const bUnload = main.add(ui.pushButton({
    color: 'red', label: 'РАЗРЯДИТЬ', radius: 0.034,
    onPress() { s.loaded = s.rammed = false; s.charges = 0; cCharges.setValue(0); lampShell.set(false); audio.clunk(); },
  }), 0.52, -0.15);
  // декор: трубопровод гидравлики и кабель
  main.add(ui.pipe([[0.7, -0.4, 0.03], [0.7, -0.02, 0.03], [0.82, -0.02, 0.03], [0.82, 0.3, 0.03]], 0.02), 0, 0);
  main.add(ui.pipe([[0.77, -0.4, 0.025], [0.77, -0.1, 0.025]], 0.012, engine.mat.steel), 0, 0);
  main.add(ui.cable([[-0.85, -0.36, 0.012], [-0.5, -0.385, 0.02], [0.1, -0.375, 0.02], [0.62, -0.39, 0.012]], { radius: 0.01, sag: 0.008 }), 0, 0);
  return {
    id: 'loading', title: 'ЗАРЯЖАНИЕ', group,
    controls: { lampAngle, lampClosed, lampShell, cCharges, cHe, cAp, leverBreech, tShell, bHoist, leverRam, bPlus, bMinus, bUnload, state: s },
  };
}

// ------------------------------------------------------------------ 4. ПОВОРОТ
function traverseStation(engine) {
  const { ui, audio } = engine;
  const { group, main } = consoleB(engine);
  const s = { bearing: 12.5, brake: true, slew: 0, target: 47.5 };
  main.add(title(ui, 'ПОВОРОТ'), 0, 0.345);
  const cBearing = main.add(ui.drumCounter({ digits: 5, decimals: 2, unit: '°', wrap: 360, label: 'ПЕЛЕНГ БАШНИ', value: s.bearing }), -0.52, 0.17);
  const cTarget = main.add(ui.drumCounter({ digits: 4, decimals: 1, unit: '°', label: 'ЗАДАНО', digitH: 0.04, value: s.target }), -0.12, 0.17);
  const gPressure = main.add(ui.gauge({ radius: 0.115, min: 0, max: 160, majorStep: 40, minorStep: 10, label: 'ДАВЛЕНИЕ', unit: 'АТМ', zones: [{ from: 130, to: 160 }] }), 0.3, 0.13);
  const gCourse = main.add(ui.gauge({ radius: 0.115, min: 0, max: 360, sweep: 360, majorStep: 60, minorStep: 10, label: 'КУРС', value: s.bearing }), 0.62, 0.13);
  gCourse.setBug(s.target);
  const lampBrake = main.add(ui.lamp({ color: 'red', label: 'СТОПОР', state: true }), 0.52, -0.12);
  const lampDrive = main.add(ui.lamp({ color: 'amber', label: 'ПРИВОД' }), 0.72, -0.12);
  const lampOn = main.add(ui.lamp({ color: 'green', label: 'НА ЦЕЛИ' }), 0.62, -0.27);
  const leverBrake = main.add(ui.lever({
    mode: 'toggle', length: 0.2, labels: ['СТОИТ', 'СНЯТ'],
    onChange(on) { s.brake = !on; lampBrake.set(s.brake); },
  }), -0.7, -0.15);
  const slew = main.add(ui.slewLever({ length: 0.2, onInput(v) { s.slew = v; } }), -0.36, -0.3);
  main.add(ui.plate('ПРИВОД', { size: 0.024, screws: false }), -0.36, -0.01);
  const rotate = d => {
    if (s.brake) { audio.buzz(); return; }
    s.bearing = ((s.bearing + d) % 360 + 360) % 360;
    cBearing.setValue(s.bearing); gCourse.setValue(s.bearing);
    lampOn.set(Math.abs(((s.bearing - s.target + 540) % 360) - 180) < 0.1);
  };
  const wFine = main.add(ui.handwheel({ radius: 0.16, onTurn(d) { rotate(d / TURN * 1); } }), 0.13, -0.2);
  main.add(ui.plate('ТОЧНО', { size: 0.024, screws: false }), 0.13, 0.0);
  return {
    id: 'traverse', title: 'ПОВОРОТ', group,
    update(dt) {
      const active = !s.brake && Math.abs(s.slew) > 0;
      if (active) rotate(s.slew * 12 * dt);
      gPressure.setValue(active ? 60 + 80 * Math.abs(s.slew) : (s.brake ? 0 : 35));
      lampDrive.set(active);
      audio.servo(active ? Math.abs(s.slew) : 0);
    },
    onLeave() { audio.servo(0); },
    controls: { cBearing, cTarget, gPressure, gCourse, lampBrake, lampDrive, lampOn, leverBrake, slew, wFine, state: s },
  };
}

// ------------------------------------------------------------------ 5. ПОДЪЁМ
function elevationStation(engine) {
  const { ui } = engine;
  const { group, main, desk } = consoleA(engine);
  const s = { elevation: 2.5, target: 17.35, fine: 0 };
  main.add(title(ui, 'ПОДЪЁМ'), 0, 0.195);
  const cElev = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', signed: true, label: 'УГОЛ СТВОЛА', value: s.elevation }), -0.56, 0.02);
  const cTarget = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: '°', label: 'ЗАДАНО', digitH: 0.04, value: s.target }), -0.15, 0.02);
  const gElev = main.add(ui.gauge({ radius: 0.115, min: -5, max: 45, majorStep: 10, minorStep: 1, label: 'УГОЛ', unit: 'ГРАД', zones: [{ from: -5, to: 3, color: '#3d8f4f' }], value: s.elevation }), 0.3, -0.05);
  gElev.setBug(s.target);
  const gError = main.add(ui.gauge({ radius: 0.115, min: -5, max: 5, majorStep: 1, minorStep: 0.5, label: 'РАССОГЛ.', sweep: 180, zones: [{ from: -5, to: -3 }, { from: 3, to: 5 }] }), 0.62, -0.05);
  const tFine = main.add(ui.toggle({ labels: ['ГРУБО', 'ТОЧНО'], orient: 'h', onChange(i) { s.fine = i; } }), -0.56, -0.15);
  const lampLoad = main.add(ui.lamp({ color: 'green', label: 'УГОЛ ЗАРЯЖАНИЯ', state: true }), -0.15, -0.13);
  const refresh = () => {
    cElev.setValue(s.elevation); gElev.setValue(s.elevation);
    gError.setValue(s.elevation - s.target);
    lampLoad.set(s.elevation <= 3);
  };
  const wheel = desk.add(ui.handwheel({
    radius: 0.18, spokes: 5,
    onTurn(d) { s.elevation = Math.max(-2, Math.min(45, s.elevation + d / TURN * (s.fine ? 0.5 : 10))); refresh(); },
  }), -0.2, 0);
  desk.add(ui.plate('ВОЗВЫШЕНИЕ\nПО ЧАСОВОЙ — ВВЕРХ', { style: 'ivory', size: 0.022, screws: false }), 0.4, 0.08);
  desk.add(ui.pipe([[0.16, -0.12, 0.02], [0.64, -0.12, 0.02]], 0.018), 0, 0);
  desk.add(ui.pipe([[0.16, -0.06, 0.016], [0.64, -0.06, 0.016]], 0.01, engine.mat.steel), 0, 0);
  desk.add(ui.rivetRow([0.72, -0.16, 0], [0.72, 0.16, 0], { spacing: 0.04 }), 0, 0);
  refresh();
  return {
    id: 'elevation', title: 'ПОДЪЁМ', group,
    controls: { cElev, cTarget, gElev, gError, tFine, lampLoad, wheel, state: s },
  };
}

// ------------------------------------------------------------------ 6. ОГОНЬ
function fireStation(engine) {
  const { ui, audio } = engine;
  const { group, main } = consoleB(engine);
  const s = { armed: false, shots: 0, flight: 0, alarm: false };
  main.add(title(ui, 'ОГОНЬ'), 0, 0.345);
  const names = ['СНАРЯД', 'ЗАРЯД', 'ЗАТВОР', 'СТОПОР', 'ЦЕПЬ'];
  const ready = names.map((n, i) => main.add(ui.lamp({ color: i === 4 ? 'red' : 'green', label: n, state: i < 4 }), -0.72 + i * 0.16, 0.2));
  const gWatch = main.add(ui.gauge({ radius: 0.13, min: 0, max: 60, sweep: 360, majorStep: 10, minorStep: 1, label: 'ПОЛЁТ', unit: 'С', speed: 40, damping: 0.9 }), 0.6, 0.13);
  const cShots = main.add(ui.drumCounter({ digits: 3, label: 'ВЫСТРЕЛОВ', sound: true }), 0.22, 0.19);
  main.add(ui.plate('ЦЕПЬ СТРЕЛЬБЫ', { style: 'red', size: 0.024, screws: false }), -0.58, -0.02);
  const tArm = main.add(ui.toggle({ labels: ['', ''], onChange(i) { s.armed = !!i; ready[4].set(s.armed ? 'blink' : false); } }), -0.58, -0.17);
  const guard = main.add(ui.cover({ w: 0.1, h: 0.13, guards: [tArm], onChange(open) { if (!open && s.armed) { tArm.set(0); s.armed = false; ready[4].set(false); } } }), -0.58, -0.17);
  const trigger = main.add(ui.lever({
    mode: 'momentary', length: 0.22, color: '#8f1d14', labels: ['СПУСК'],
    onPull() {
      if (!s.armed) { audio.buzz(); return; }
      s.shots++; cShots.setValue(s.shots);
      audio.fire(); engine.shake(1, 0.9);
      s.flight = 24; gWatch.setValue(24, { instant: true });
      setTimeout(() => audio.impactFar(), 2600);
    },
  }), -0.2, -0.17);
  const lampAlarm = main.add(ui.cageLamp({ color: 'red', on: false, scale: 0.9 }), 0.78, -0.3);
  const bAlarm = main.add(ui.pushButton({
    color: 'red', label: 'ТРЕВОГА', radius: 0.034,
    onPress() { s.alarm = !s.alarm; bAlarm.setLit(s.alarm); lampAlarm.set(s.alarm); audio.alarm(s.alarm); },
  }), 0.56, -0.24);
  const bRadio = main.add(ui.pushButton({ color: 'ivory', label: 'СВЯЗЬ', onPress() { audio.radio(); } }), 0.3, -0.24);
  const bReset = main.add(ui.pushButton({ label: 'СБРОС', onPress() { s.shots = 0; cShots.setValue(0); } }), 0.1, -0.24);
  return {
    id: 'fire', title: 'ОГОНЬ', group,
    update(dt) {
      if (s.flight > 0) { s.flight = Math.max(0, s.flight - dt); gWatch.setValue(s.flight); }
    },
    onLeave() { if (s.alarm) { s.alarm = false; bAlarm.setLit(false); lampAlarm.set(false); audio.alarm(false); } },
    controls: { ready, gWatch, cShots, tArm, guard, trigger, lampAlarm, bAlarm, bRadio, bReset, state: s },
  };
}

// ------------------------------------------------------------------ запуск
(async () => {
  const canvas = document.getElementById('stage');
  const debug = /[?&]debug/.test(location.search);
  const engine = await createEngine(canvas, { debug, antialias: !/[?&]noaa/.test(location.search) });
  const factories = [plotStation, computerStation, loadingStation, traverseStation, elevationStation, fireStation];
  const stations = {};
  const log = [];
  for (const f of factories) {
    const st = f(engine);
    const enter = st.onEnter, leave = st.onLeave;
    st.onEnter = () => { log.push('enter:' + st.id); if (enter) enter(); };
    st.onLeave = () => { log.push('leave:' + st.id); if (leave) leave(); };
    engine.addStation(st);
    stations[st.id] = st;
  }
  const ids = engine.stations.map(s => s.id);
  const step = dir => {
    const i = ids.indexOf(engine.current);
    engine.gotoStation(ids[(i + dir + ids.length) % ids.length]);
  };
  engine.on('swipe', step);
  engine.on('station', id => { log.push('station:' + id); if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); });
  let guides = false;
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'd' || e.key === 'в') { guides = !guides; engine.debug.guides(guides); }
    else if (e.key === 'm' || e.key === 'ь') engine.audio.setMuted(!engine.audio.muted);
  });
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (stations[id] && id !== engine.current) engine.gotoStation(id); });
  const start = location.hash.slice(1);
  if (stations[start]) engine.gotoStation(start, { instant: true });
  engine.audio.ambient(true);
  engine.start();
  window.__dev = { engine, stations, log };
})().catch(e => { console.error(e); });
