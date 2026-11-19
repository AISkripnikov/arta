// Подсказки. Чистая логика без DOM: читает состояние игры, ничего в нём не меняет.
//  • nextStep(game, ui)  — следующий шаг процедуры выстрела (пост, орган управления, текст) — «пошаговые» подсказки;
//  • TOPICS              — темы «НОВОЕ»: по одной на каждую механику игры. У темы есть предикат when (механика сейчас
//                          перед игроком), необязательный done (игрок сделал нужное действие) и intro (механика есть в задании —
//                          для блока «НОВОЕ В ЭТОМ ЗАДАНИИ» и для старых сохранений);
//  • describe(src)       — краткое описание задания (из описания кампании или из состояния боя) для intro.
// Кто и когда показывает тему, как она становится «изученной» — в game/index.js (topicsTick, game.hint()).
import { KINDS } from './missions.js';

const R = Math.PI / 180;
const ang = (a, b) => { let d = ((a - b) % 360 + 360) % 360; if (d > 180) d -= 360; return d; };

/** ui (необязательно): { hasHot(stationId, name) → bool, shellType() → тип, выбранный галетником }. Без него считаем, что все органы есть. */
const uiOf = (ui) => ({ hasHot: ui && ui.hasHot ? ui.hasHot : () => true, shellType: ui && ui.shellType ? ui.shellType : () => null });

// ---------- пошаговые подсказки ----------
/** Подсказка зенитного поста, пока идёт налёт (null — налёта нет или стрелять нечем). */
function raidStep(game, pick) {
  const s = game.state, rd = s.raid, aa = s.aa;
  if (!rd || !aa || rd.phase !== 'inbound') return null;
  const live = (rd.planes || []).filter((p) => p.alive && !p.attacked);
  if (!live.length || aa.ammo <= 0) return null;
  if (aa.jammed) return { st: 'aa', text: 'ЗЕНИТКА: клин — ствол перегрет! Отпустите гашетку, автомат остынет' };
  const cone = game.C.AA_CONE;
  const sep = (p) => Math.acos(Math.max(-1, Math.min(1, Math.sin(p.elevation * R) * Math.sin(aa.elevation * R) + Math.cos(p.elevation * R) * Math.cos(aa.elevation * R) * Math.cos((p.bearing - aa.bearing) * R)))) / R;
  if (live.some((p) => sep(p) < cone)) return { st: 'aa', hot: pick('aa', 'aaFire', 'aaTrigger'), text: 'ЗЕНИТКА: самолёт в кольце — давите гашетку «ОГОНЬ»!' };
  return { st: 'aa', hot: pick('aa', 'aaPad'), text: 'ВОЗДУХ! ЗЕНИТКА: ведите прицел пальцем — самолёт в кольцо, вторым пальцем давите гашетку' };
}
/** Снаряд в полёте: когда корректировщик не поможет, а цель видна в оптику — к трубе. */
function observeStep(game, pick) {
  const s = game.state, m = s.mission, lr = s.lastReport, at = s.targets.find((t) => t.id === s.activeTarget);
  if (!s.flight.some((f) => f.shell !== 'illum' && f.shell !== 'smoke')) {
    if (m.night && s.flight.some((f) => f.shell === 'illum')) return { st: null, text: 'Осветительный в полёте. Дальше: пост НАБЛЮДЕНИЕ — в свете цель и разрывы видны в трубу, поправка по сетке' };
    return null;
  }
  if (!at || !at.alive || !(m.noSpotter || m.night || (lr && (lr.blind || lr.dark))) || !game.visible(at.id)) return null;
  const bat = m.battery, brg = ((Math.atan2(at.x - bat.x, at.y - bat.y) / R) + 360) % 360;
  const off = Math.abs(ang(s.scope.bearing, brg));
  if (off > game.scopeFov() * 0.4) {
    const btn = pick('observe', 'toTargetButton');
    return { st: 'observe', hot: btn || pick('observe', 'scopeWheel'), text: 'НАБЛЮДЕНИЕ: наведите трубу на цель' + (btn ? ' (кнопка «НА ЦЕЛЬ» или маховик)' : ' маховиком') + ' — расчёт доложит, куда лёг снаряд' };
  }
  return { st: 'observe', text: 'НАБЛЮДЕНИЕ: труба на цели — ждите разрыва и снимите поправку по сетке' };
}
/** Линия пеленга с поста проведена: ось стояла на посту, алидада — на его пеленге (±1°). */
export const soundLineDrawn = (s, q) => s.plot.lines.some((l) => l.from === q.name && Math.abs(ang(l.bearing, q.bearing)) <= 1);
/** «Командир»: какой пеленг звукометрии ещё не проведён на планшете и что для этого сделать (null — все линии есть). */
function soundLineStep(game, sound) {
  const s = game.state, q = sound.find((p) => !soundLineDrawn(s, p));
  if (!q) return null;
  const P = game.pivots(), i = P.findIndex((p) => p.name === q.name);
  if (i < 0) return null;
  const brg = game.fmt.brg(q.bearing);
  if (s.plot.pivot !== i) return { st: 'plot', text: 'ПЛАНШЕТ: коснитесь знака поста ' + q.name + ' на карте — ось алидады встанет на пост' };
  if (Math.abs(ang(s.plot.alidade.bearing, q.bearing)) > 0.25) return { st: 'plot', hot: 'bearingWheel', text: 'ПЛАНШЕТ: поверните алидаду на пеленг поста ' + q.name + ' — ' + brg };
  return { st: 'plot', hot: 'btnLine', text: 'ПЛАНШЕТ: нажмите «ЛИНИЯ» — пеленг ' + q.name + ' ляжет на карту' };
}
/** Следующий шаг процедуры: { st: пост | null, hot: орган управления | undefined, text, warn? }. Только в идущем бою. */
export function nextStep(game, ui) {
  const u = uiOf(ui), pick = (stId, ...names) => names.find((n) => u.hasHot(stId, n)) || null;
  const s = game.state, c = s.checklist, b = s.breech, cp = s.computer;
  const shellName = (k) => (game.SHELLS[k] || {}).name || String(k).toUpperCase();
  const air = raidStep(game, pick);
  if (air) return air;
  if (s.flight.length && !b.shell && !b.open && !(b.busy && b.busy.kind === 'auto')) return observeStep(game, pick) || { st: null, text: 'Снаряд в полёте — следите за картой на ПЛАНШЕТЕ и ждите доклада' };
  if (b.busy && b.busy.kind === 'auto') return { st: null, text: 'Очередь: расчёт перезаряжает орудие' };
  if (!s.activeTarget) {
    if (s.mission.survival && !s.targets.some((t) => t.alive)) return { st: null, text: 'Волна отбита — ждите следующую' };
    if (s.targets.some((t) => t.alive && (t.reported || t.area))) return { st: null, text: 'Выберите цель: кнопка «ЦЕЛЬ ▸» вверху' };
    return { st: null, text: 'Ждите донесения разведки или звукометрии' };
  }
  const at = s.targets.find((t) => t.id === s.activeTarget);
  // ночь: о цели известен только квадрат (или грубая засечка по вспышке) — сначала осветительный
  const blind = !!(s.mission.night && at && at.alive && at.locate !== 'sound' && !at.lit && (!at.reported || at.reported.rough));
  const needIllum = blind && s.shells.illum + (b.shell === 'illum' ? 1 : 0) > 0 && !s.flight.some((f) => f.shell === 'illum');
  const wantShell = at && at.armored ? 'ap' : needIllum ? 'illum' : at && at.kind === 'landing' && s.shells.shrap > 0 ? 'shrap' : 'he';
  const rec = s.plot.recorded[s.activeTarget];
  if (!c.measured) {
    const pin = s.plot.pins[s.activeTarget];
    const sound = at && at.reported && at.reported.sound;
    // «Командир»: линии пеленгов звукометрии сами не рисуются — сперва провести их кнопкой «ЛИНИЯ» с каждого поста
    if (!pin && sound && s.difficulty === 1) { const man = soundLineStep(game, sound); if (man) return man; }
    if (!pin) return { st: 'plot', hot: 'pin' + s.activeTarget, text: sound ? 'ПЛАНШЕТ: перетащите фишку на пересечение пеленгов звукометрии'
      : at && !at.reported && at.area ? 'НОЧЬ: цель не видна. ПЛАНШЕТ: поставьте фишку в центр квадрата — туда пойдёт осветительный снаряд'
        : at && at.reported && at.reported.rough ? 'ПЛАНШЕТ: фишку — на засечку «по вспышке» (грубо, ±0,5 км)' : 'ПЛАНШЕТ: перетащите фишку на карту по координатам X и Y из донесения' };
    if (s.plot.pivot) return { st: 'plot', text: 'ПЛАНШЕТ: коснитесь знака «УТЁС», чтобы вернуть ось алидады на батарею' };
    const bat = s.mission.battery, A = s.plot.alidade;
    const sx = bat.x + A.range * Math.sin(A.bearing * R), sy = bat.y + A.range * Math.cos(A.bearing * R);
    if (Math.hypot(sx - pin.x, sy - pin.y) > 0.03) return { st: 'plot', hot: 'sight', text: 'ПЛАНШЕТ: наведите визир алидады на фишку (тяните визир или крутите маховики)' };
    return { st: 'plot', hot: 'btnRecord', text: 'ПЛАНШЕТ: нажмите «ЗАПИСАТЬ»' };
  }
  if (!c.computed) {
    if (Math.abs(cp.range - rec.range) > 0.005) return { st: 'computer', hot: 'rangeWheel', text: 'ВЫЧИСЛИТЕЛЬ: маховиком наберите дальность ' + game.fmt.km(rec.range) + ' км' };
    if (game.chargeStates()[cp.charge - 1] !== 'ok') return { st: 'computer', hot: 'chargeSelector', text: 'ВЫЧИСЛИТЕЛЬ: выберите заряд с зелёной лампой' };
    return { st: 'computer', hot: 'computeLever', text: cp.stale && cp.elevation != null && s.mission.weather === 'storm' ? 'ВЫЧИСЛИТЕЛЬ: ветер сменился — потяните рычаг «ВЫЧИСЛИТЬ» ещё раз' : 'ВЫЧИСЛИТЕЛЬ: потяните рычаг «ВЫЧИСЛИТЬ» вниз' };
  }
  if (!c.loaded) {
    if (!b.open && !b.shell && s.turret.elevation > game.C.LOAD_ANGLE) return { st: 'elevation', hot: 'loadAngleButton', text: 'ПОДЪЁМ: держите «НА УГОЛ ЗАРЯЖАНИЯ» — ствол должен опуститься до ' + game.C.LOAD_ANGLE + '°' };
    if (!b.open && !b.shell) return { st: 'loading', hot: 'breechLever', text: 'ЗАРЯЖАНИЕ: откройте затвор рычагом' };
    if (!b.shell) {
      const why = wantShell === 'ap' ? ' (цель бронирована)' : wantShell === 'illum' ? ' — выпустите осветительный снаряд в район цели' : wantShell === 'shrap' ? ' (шрапнель — по десанту)' : '';
      const picked = u.shellType();
      return { st: 'loading', hot: picked && picked !== wantShell ? 'shellSelector' : 'hoistButton', text: 'ЗАРЯЖАНИЕ: галетником выберите ' + shellName(wantShell) + ' и нажмите «ПОДАТЬ СНАРЯД»' + why };
    }
    if (!b.rammed) return { st: 'loading', hot: 'ramLever', text: 'ЗАРЯЖАНИЕ: дошлите снаряд рычагом «ДОСЛАТЬ»' };
    if (b.charges < cp.charge) return { st: 'loading', hot: 'chargePlus', text: 'ЗАРЯЖАНИЕ: подайте заряды — нужно ' + cp.charge + ', подано ' + b.charges };
    if (b.charges > cp.charge) return { st: 'loading', hot: 'chargeMinus', text: 'ЗАРЯЖАНИЕ: лишний заряд! Нужно ' + cp.charge };
    return { st: 'loading', hot: 'breechLever', text: 'ЗАРЯЖАНИЕ: закройте затвор' };
  }
  if (b.charges !== cp.charge) return { st: 'loading', text: 'Заряжено ' + b.charges + ', а расчёт на заряд ' + cp.charge + ' — пересчитайте или перезарядите' };
  if (!c.traversed) {
    const want = ((rec.bearing + (cp.windBearing || 0)) % 360 + 360) % 360, err = ang(s.turret.bearing, want);
    const wtxt = cp.windBearing ? ' (' + rec.bearing.toFixed(1) + '° ' + (cp.windBearing > 0 ? '+' : '−') + Math.abs(cp.windBearing).toFixed(1) + '° на ветер)' : '';
    if (Math.abs(err) > 0.5) {
      if (s.turret.brake) return { st: 'traverse', hot: 'brakeLever', text: 'ПОВОРОТ: снимите стопор' };
      return { st: 'traverse', hot: Math.abs(err) > 3 && !s.faults.drive ? 'slewLever' : 'fineWheel', text: 'ПОВОРОТ: разверните башню на ' + want.toFixed(1) + '°' + wtxt };
    }
    return { st: 'traverse', hot: 'brakeLever', text: 'ПОВОРОТ: поставьте стопор' };
  }
  if (!c.elevated) return { st: 'elevation', hot: 'elevWheel', text: 'ПОДЪЁМ: поднимите ствол маховиком на ' + cp.elevation.toFixed(2) + '°' };
  if (!c.armed) return { st: 'fire', hot: 'armCover', text: 'ОГОНЬ: откройте красную крышку и взведите цепь стрельбы' };
  if (game.friendsInDanger().length && b.shell !== 'illum' && b.shell !== 'smoke') return { st: 'fire', hot: 'fireLever', warn: true, text: 'ОГОНЬ: СВОИ В ЗОНЕ ПОРАЖЕНИЯ! Проверьте замер на ПЛАНШЕТЕ — или стреляйте на свой риск' };
  return { st: 'fire', hot: 'fireLever', text: b.shell === 'illum' ? 'ОГОНЬ: осветительный в стволе — спуск вниз! Затем пост НАБЛЮДЕНИЕ → поправка по сетке' : blind && needIllum ? 'ОГОНЬ: цель не освещена — лучше сначала осветительный. Спуск — вниз' : 'ОГОНЬ: потяните спуск вниз!' };
}

// ---------- описание задания для intro ----------
/** src — описание задания кампании ({ targets, friends, raids, wind: [от, до], … }) или состояние боя (game.state с mission). */
export function describe(src, difficulty) {
  if (!src) return null;
  const m = src.mission || null;
  const tg = (src.targets || []).map((t) => ({ kind: t.kind, k: KINDS[t.kind] || {}, sound: t.locate === 'sound', relocate: !!(t.relocate || t.relocateEvery), delay: t.delay || 0, hunts: !!t.hunts }));
  const fr = src.friends || [], sh = src.shells || {};
  const def = m || src;
  return {
    tg, shells: sh, difficulty: difficulty != null ? difficulty : src.difficulty != null ? src.difficulty : null,
    night: !!def.night, fog: def.weather === 'fog', storm: def.weather === 'storm',
    wind: m ? !!(m.wind && m.wind.speed > 0) : !!(src.wind && src.wind[1] > 0),
    raids: !!(def.raids && def.raids.length), survival: !!def.survival, noSpotter: !!def.noSpotter,
    friends: fr.length > 0, convoy: fr.some((f) => f.convoy),
  };
}
const any = (d, f) => d.tg.some((t) => f(t.k, t));
const guns = (d) => any(d, (k) => !!k.gun) || d.survival;
const has = (d, kind) => d.tg.some((t) => t.kind === kind);

// ---------- темы «НОВОЕ» ----------
const DANGER = 3, AIM = 2, COMFORT = 1;
const liveT = (c, f) => c.s.targets.some((t) => t.alive && t.active && f(t));
const gunsLive = (c) => liveT(c, (t) => !!t.gun);
const combatFlight = (c) => c.s.flight.some((f) => f.shell !== 'illum' && f.shell !== 'smoke');
const enRoute = (c) => c.s.friends.some((f) => f.convoy && f.alive && !f.arrived);

/**
 * Тема: { id, pri (3 опасность · 2 наводка · 1 удобство), title, brief? (строка для инструктажа: что это и что делать), steps? (механику
 *   объясняют пошаговые подсказки — в режиме шагов тема засчитывается без показа), urgent? (вытесняет тему на экране сразу),
 *   text | (c) → text, st? (пост), hot? ([имена органов] | (c) → [имена]),
 *   dom? (id элемента обвязки HUD для кольца), hold? (с показа, не больше 40), when(c), done?(c), intro?(d), since? (номер задания,
 *   с которого механика считается знакомой ветерану), fresh? (новая механика — ветеранам не засчитывается), menu? (показывает меню) }.
 * d в intro — describe(): { tg, shells, difficulty (0 | 1 | null), night, fog, storm, wind, raids, survival, noSpotter, friends, convoy }.
 * c = { s: state, m: mission, t: time, a: выбранная цель | null, g: game, since: время начала показа темы, d: сложность }.
 * Порядок в списке — порядок срочности внутри одного приоритета.
 */
export const TOPICS = [
  // ----- опасность -----
  { id: 'raid', pri: DANGER, title: 'ВОЗДУШНЫЙ НАЛЁТ', st: 'aa', hot: ['aaPad'], steps: true, urgent: true,
    brief: 'Будет авианалёт: по команде «ВОЗДУХ!» переходите на пост ЗЕНИТКА и сбивайте самолёты.',
    text: 'По команде «ВОЗДУХ!» переходите на пост ЗЕНИТКА: держите самолёт в кольце прицела и давите гашетку — упреждение не нужно.',
    when: (c) => !!(c.s.raidWarn && c.s.raidWarn.until > c.t) || !!(c.s.raid && c.s.raid.phase === 'inbound' && c.s.raid.planes.some((p) => p.alive && !p.attacked)),
    done: (c) => c.s.aa.firing, intro: (d) => d.raids || d.survival },
  { id: 'friendZone', pri: DANGER, title: 'СВОИ В ЗОНЕ ПОРАЖЕНИЯ', st: 'plot', dom: 'ffWarn', urgent: true,
    brief: 'Разрыв ближе 250 м от своего корабля — попадание по своим: не цельтесь ближе 400 м от них.',
    text: 'Точка прицеливания ближе 400 м от своего корабля. Разрыв ближе 250 м — попадание по своим и минус звезда: проверьте замер или дождитесь, пока свой отойдёт.',
    when: (c) => c.g.friendsInDanger().length > 0, intro: (d) => d.friends },
  { id: 'convoySmoke', pri: DANGER, title: 'ДЫМ ДЛЯ КОНВОЯ', st: 'loading', hot: ['shellSelector'],
    brief: 'Если охотник бьёт по транспорту, дымовой снаряд (ДЫМ) рядом с транспортом на минуту собьёт ему прицел.',
    text: 'Охотник бьёт по транспорту. Дымовой снаряд (ДЫМ), положенный не дальше 1,2 км от транспорта, на минуту сбивает охотникам прицел.',
    when: (c) => enRoute(c) && c.s.shells.smoke > 0 && liveT(c, (t) => t.hunts && t.firedAt != null) && !c.s.smokes.some((q) => q.convoy),
    done: (c) => c.s.breech.shell === 'smoke' || c.s.smokes.some((q) => q.convoy), intro: (d) => d.convoy && d.shells.smoke > 0 },
  { id: 'faults', pri: DANGER, title: 'ПОВРЕЖДЕНИЕ БАШНИ', dom: 'faults',
    brief: 'Попадания могут вывести из строя узлы башни: кнопка «ЧИНИТЬ» на красной плашке — ремонт за 25 секунд.',
    text: 'Отказал узел башни. Нажмите «ЧИНИТЬ» на красной плашке — ремонтная команда справится за 25 секунд.',
    when: (c) => Object.keys(c.s.faults).some((k) => c.s.faults[k]) && !c.s.repair, done: (c) => !!c.s.repair, intro: (d) => guns(d) || d.raids },
  { id: 'wounded', pri: DANGER, title: 'БОЕЦ РАНЕН', dom: 'crew',
    brief: 'Раненый боец работает медленнее: коснитесь его значка у края экрана — аптечка вернёт его в строй.',
    text: 'Раненый боец работает в полтора раза медленнее. Коснитесь его значка у края экрана — аптечка вернёт его в строй.',
    when: (c) => c.s.medkits > 0 && Object.keys(c.s.crew).some((k) => c.s.crew[k].state === 'wounded'), intro: (d) => guns(d) || d.raids },
  { id: 'detected', pri: DANGER, title: 'БАТАРЕЯ ЗАСЕЧЕНА', dom: 'detChip', hold: 20, fresh: true,
    brief: 'После первого выстрела противник засечёт батарею по вспышке и начнёт бить прицельно.',
    text: 'Противник увидел вспышку вашего выстрела: глаз у полосы прочности стал красным. Раньше он бил наугад, теперь стреляет прицельно — следите за прочностью батареи.',
    when: (c) => c.s.detected && c.s.detectTold != null && c.t - c.s.detectTold < 60 && c.s.targets.some((t) => t.alive && t.gun), intro: guns },
  { id: 'enemyFire', pri: DANGER, title: 'ОГОНЬ ПО БАТАРЕЕ', dom: 'hInt', hold: 20,
    brief: 'Противник отвечает огнём: кончится прочность батареи — бой проигран. Его орудия подавляйте первыми.',
    text: 'Батарея под огнём: полоса прочности вверху экрана убывает. Кончится прочность — бой проигран. Подавите орудия противника в первую очередь.',
    when: (c) => c.s.integrity < 100 && gunsLive(c), intro: guns },
  { id: 'landing', pri: DANGER, title: 'ДЕСАНТ', st: 'plot', hold: 20,
    brief: 'Десантные катера идут к берегу: высадятся — бой проигран. Бейте их первыми.',
    text: 'Десантные катера идут к нашему берегу. Высадятся — бой проигран (в ОБОРОНЕ — минус 25 прочности). Бейте их первыми, упреждение берите с запасом.',
    when: (c) => liveT(c, (t) => t.kind === 'landing'), intro: (d) => has(d, 'landing') },
  { id: 'aaHeat', pri: DANGER, title: 'ПЕРЕГРЕВ ЗЕНИТКИ', st: 'aa', hot: ['aaFire', 'aaTrigger'],
    brief: 'Ствол зенитки перегревается: бейте короткими очередями, иначе его заклинит.',
    text: 'Ствол зенитки греется: бейте короткими очередями. Заклинило — отпустите гашетку и дайте автомату остыть.',
    when: (c) => c.s.aa.jammed || c.s.aa.heat > 0.6, done: (c) => !c.s.aa.firing && c.t - c.since > 3, intro: (d) => d.raids || d.survival },
  // ----- наводка -----
  { id: 'night', pri: AIM, title: 'НОЧЬ: ОСВЕТИТЕЛЬНЫЙ СНАРЯД', st: 'loading', hot: ['shellSelector'], steps: true,
    brief: 'Ночью известен только квадрат цели: сначала выпустите туда осветительный снаряд (ОСВ).',
    text: 'Ночью известен только квадрат цели. Поставьте фишку в его центр и выпустите туда осветительный снаряд (ОСВ) — в свете разведка даст точные координаты.',
    when: (c) => c.m.night && !!c.a && c.a.locate !== 'sound' && !c.a.lit && (!c.a.reported || !!c.a.reported.rough) && c.s.shells.illum + (c.s.breech.shell === 'illum' ? 1 : 0) > 0,
    done: (c) => c.s.breech.shell === 'illum' || c.s.flight.some((f) => f.shell === 'illum') || c.s.lights.length > 0, intro: (d) => d.night },
  { id: 'flash', pri: AIM, title: 'ЗАСЕЧКА ПО ВСПЫШКЕ', st: 'plot', hold: 20,
    brief: 'Стрелявшую ночью цель засекают по вспышке — грубо, до полукилометра; для точного огня её нужно подсветить.',
    text: 'Ночью стрелявшую цель засекают по вспышке — грубо, с точностью до полукилометра. Для точного огня подсветите её осветительным снарядом.',
    when: (c) => c.s.targets.some((t) => t.alive && t.reported && t.reported.rough), intro: (d) => d.night && (any(d, (k) => !!k.gun) || any(d, (k, t) => t.hunts)) },
  { id: 'armor', pri: AIM, title: 'БРОНИРОВАННАЯ ЦЕЛЬ', st: 'loading', hot: ['shellSelector'], steps: true,
    brief: 'Бронированную цель фугасный не берёт: нужен бронебойный (ББ) и прямое попадание.',
    text: 'Цель бронирована: фугасный её не берёт. На посту ЗАРЯЖАНИЕ выберите галетником ББ — нужно прямое попадание.',
    when: (c) => !!c.a && c.a.alive && c.a.armored && c.s.breech.shell !== 'ap' && c.s.shells.ap > 0, done: (c) => c.s.breech.shell === 'ap', intro: (d) => any(d, (k) => k.armored) },
  { id: 'sound', pri: AIM, title: 'ЗВУКОМЕТРИЯ', st: 'plot', hot: (c) => ['pin' + c.a.id], steps: true,
    brief: 'Скрытую батарею ищут по звуку залпа: фишку ставят в точку пересечения пеленгов постов ЗВ-1 и ЗВ-2.',
    text: 'Скрытую батарею засекли по звуку залпа: посты ЗВ-1 и ЗВ-2 сообщили пеленги. На ПЛАНШЕТЕ поставьте фишку цели в точку пересечения линий пеленгов.',
    when: (c) => !!c.a && c.a.alive && !!(c.a.reported && c.a.reported.sound) && !c.s.plot.pins[c.a.id] && (c.d === 0 || c.s.plot.lines.filter((l) => l.from !== 'scope').length >= 2),
    done: (c) => !!c.s.plot.pins[c.a.id], intro: (d) => any(d, (k, t) => t.sound) },
  { id: 'soundManual', pri: AIM, title: 'ЛИНИИ ПЕЛЕНГОВ ВРУЧНУЮ', st: 'plot', hot: ['btnLine'], steps: true,
    brief: 'На «Командире» линии пеленгов звукометрии проводите на планшете сами — кнопкой «ЛИНИЯ».',
    text: 'На «Командире» линии звукометрии проводите сами: коснитесь знака поста ЗВ-1, поверните алидаду на его пеленг и нажмите «ЛИНИЯ»; то же для ЗВ-2. Потом верните ось на «УТЁС».',
    when: (c) => c.d === 1 && !!c.a && c.a.alive && !!(c.a.reported && c.a.reported.sound) && !c.s.plot.pins[c.a.id] && c.s.plot.lines.filter((l) => l.from !== 'scope').length < 2,
    done: (c) => c.s.plot.lines.filter((l) => l.from !== 'scope').length >= 2, intro: (d) => d.difficulty === 1 && any(d, (k, t) => t.sound) },
  { id: 'relocate', pri: AIM, title: 'КОЧУЮЩАЯ БАТАРЕЯ', st: 'plot', hold: 20,
    brief: 'Батарея противника после нескольких залпов меняет позицию: ждите новой засечки и переставляйте фишку.',
    text: 'Батарея замолчала и меняет позицию на том же острове: старая засечка больше не годится. Дождитесь новой засечки звукометрии и переставьте фишку.',
    when: (c) => c.s.targets.some((t) => t.alive && t.moved === true), intro: (d) => any(d, (k, t) => t.relocate) },
  { id: 'shrap', pri: AIM, title: 'ШРАПНЕЛЬ', st: 'loading', hot: ['shellSelector'], steps: true,
    brief: 'По десантным катерам лучше всего шрапнель (ШРП): она накрывает широкий круг, прямое попадание не нужно.',
    text: 'По десантным катерам — шрапнель (ШРП): она накрывает круг втрое шире цели, прямое попадание не нужно. По кораблям и постройкам шрапнель слаба.',
    when: (c) => !!c.a && c.a.alive && c.a.kind === 'landing' && c.s.shells.shrap > 0 && c.s.breech.shell !== 'shrap', done: (c) => c.s.breech.shell === 'shrap',
    intro: (d) => has(d, 'landing') && d.shells.shrap > 0 },
  { id: 'lead', pri: AIM, title: 'ДВИЖУЩАЯСЯ ЦЕЛЬ', st: 'plot', hot: (c) => ['pin' + c.a.id],
    brief: 'Цель движется: фишку ставят с упреждением — туда, где цель будет к падению снаряда.',
    text: 'Цель движется: ставьте фишку с упреждением — туда, где цель окажется через время подготовки и полёта снаряда. Курс и скорость — в донесении разведки.',
    when: (c) => !!c.a && c.a.alive && c.a.moving && !!c.a.reported && c.a.reported.x != null && !c.a.reported.rough,
    done: (c) => { const r = c.s.plot.recorded[c.a.id]; return !!r && r.time > c.since; }, intro: (d) => any(d, (k) => k.speed > 0) },
  { id: 'escape', pri: AIM, title: 'ЦЕЛЬ УХОДИТ', hold: 20,
    brief: 'Цель идёт вдоль берега и может уйти из зоны огня — тогда задание провалено. Не откладывайте её.',
    text: 'Эта цель идёт вдоль берега и скоро выйдет из зоны огня. Уйдёт — задание провалено (в ОБОРОНЕ — минус 25 прочности). Не откладывайте её.',
    when: (c) => liveT(c, (t) => t.end === 'escape'), intro: (d) => any(d, (k, t) => k.end === 'escape' && !t.hunts) },
  { id: 'submarine', pri: AIM, title: 'ПОДВОДНАЯ ЛОДКА', hold: 20,
    brief: 'Подводная лодка скоро погрузится и будет потеряна: цель мала, нужно точное упреждение.',
    text: 'Лодка пройдёт несколько километров по поверхности и погрузится — тогда она потеряна. Цель мала: точное упреждение, а когда снаряды лягут рядом — очередь.',
    when: (c) => liveT(c, (t) => t.kind === 'submarine'), intro: (d) => has(d, 'submarine') },
  { id: 'radar', pri: AIM, title: 'РЛС ПРОТИВНИКА', hold: 20,
    brief: 'РЛС наводит огонь батарей противника — уничтожьте её первой.',
    text: 'Радиолокационная станция наводит огонь батарей противника: пока она цела, по засечённому «Утёсу» попадают заметно чаще. Уничтожьте её первой.',
    when: (c) => liveT(c, (t) => t.spotter) && c.s.targets.some((t) => t.alive && t.gun), intro: (d) => has(d, 'radar') },
  { id: 'fort', pri: AIM, title: 'БЕРЕГОВОЙ ФОРТ', hold: 20,
    brief: 'Форт берут только бронебойные (ББ), и нужно три прямых попадания.',
    text: 'Форт берут только бронебойные (ББ), и нужно три прямых попадания. Его тяжёлые орудия бьют по батарее больнее всех.',
    when: (c) => liveT(c, (t) => t.kind === 'fort'), intro: (d) => has(d, 'fort') },
  { id: 'tanker', pri: AIM, title: 'ТАНКЕР', hold: 20,
    brief: 'Танкер выдерживает три попадания фугасным — добивайте его очередью.',
    text: 'Танкер выдерживает три попадания фугасным. Попали — не меняйте установки: добивайте очередью, пока он не ушёл.',
    when: (c) => liveT(c, (t) => t.kind === 'tanker'), intro: (d) => has(d, 'tanker') },
  { id: 'wind', pri: AIM, title: 'ПОПРАВКА НА ВЕТЕР', st: 'traverse', hot: ['setCounter', 'fineWheel'], steps: true,
    brief: 'Ветер сносит снаряд: вычислитель даёт поправку, башню наводят по счётчику «ЗАДАНО» на посту ПОВОРОТ.',
    text: 'Ветер сносит снаряд. Вычислитель уже учёл его: на посту ПОВОРОТ счётчик «ЗАДАНО» показывает пеленг с поправкой — наводите башню по нему.',
    when: (c) => c.m.wind.speed > 0 && c.s.computer.elevation != null && !c.s.computer.stale && Math.abs(c.s.computer.windBearing) >= 0.1 && c.s.checklist.measured && !c.s.checklist.traversed,
    done: (c) => c.s.checklist.traversed, intro: (d) => d.wind },
  { id: 'stale', pri: AIM, title: 'ВЕТЕР СМЕНИЛСЯ', st: 'computer', hot: ['computeLever'], steps: true,
    brief: 'Ветер будет меняться: после смены расчёт устаревает — потяните «ВЫЧИСЛИТЬ» ещё раз.',
    text: 'Ветер сменился — расчёт вычислителя устарел. Потяните рычаг «ВЫЧИСЛИТЬ» ещё раз и доверните башню на новый пеленг.',
    when: (c) => c.s.computer.stale && c.s.computer.elevation != null && c.s.windChangedAt != null && c.t - c.s.windChangedAt < 90,
    done: (c) => !c.s.computer.stale, intro: (d) => d.storm || d.survival },
  { id: 'noSpotter', pri: AIM, title: 'БЕЗ КОРРЕКТИРОВЩИКА', st: 'observe', hot: ['toTargetButton', 'scopeWheel'], steps: true,
    brief: 'Корректировщика нет: падение снаряда наблюдайте сами в трубу поста НАБЛЮДЕНИЕ.',
    text: 'Корректировщика нет: об отклонении доложит только свой расчёт. До падения снаряда наведите трубу поста НАБЛЮДЕНИЕ на освещённую цель.',
    when: (c) => c.m.noSpotter, done: (c) => !!c.s.scope.last, intro: (d) => d.noSpotter },
  { id: 'smoke', pri: AIM, title: 'ДЫМОВАЯ ЗАВЕСА', st: 'loading', hot: ['shellSelector'],
    brief: 'Дымовой снаряд (ДЫМ), положенный между батареей и орудиями противника, на минуту сбивает им прицел.',
    text: 'Дымовой снаряд (ДЫМ), положенный в 1–4 км от батареи в сторону орудий противника, на минуту сбивает им прицел.',
    when: (c) => c.s.detected && c.s.shells.smoke > 0 && liveT(c, (t) => !!t.gun && t.firedAt != null) && !c.s.smokes.some((q) => q.cover),
    done: (c) => c.s.breech.shell === 'smoke' || c.s.smokes.some((q) => q.cover), intro: (d) => d.shells.smoke > 0 && guns(d) },
  { id: 'stealth', pri: AIM, title: 'НАС НЕ ВИДЯТ', dom: 'detChip', hold: 25, fresh: true,
    brief: 'До вашего первого выстрела противник не знает, где батарея, и бьёт наугад — первый залп готовьте без спешки.',
    text: 'Противник не знает, где батарея (зелёный зачёркнутый глаз у полосы прочности) и бьёт наугад, без вреда. Вспышка первого выстрела выдаст «Утёс» — готовьте залп без спешки.',
    when: (c) => !c.s.detected && c.s.targets.some((t) => t.alive && t.gun), done: (c) => c.s.shots > 0, intro: guns },
  { id: 'fog', pri: AIM, title: 'ТУМАН', hold: 20,
    brief: 'Туман: донесения приходят реже и округлены — пристреливайтесь, помогут очередь и «ВИЛКА».',
    text: 'Туман: донесения приходят вдвое реже и округлены до 100 м, отклонения разрывов — до 50 м. Пристреливайтесь; очередь или «ВИЛКА» помогут накрыть цель.',
    when: (c) => c.m.weather === 'fog', intro: (d) => d.fog },
  { id: 'convoy', pri: AIM, title: 'КОНВОЙ', st: 'plot', hold: 20,
    brief: 'Наши транспорты идут в порт: потопите охотников или продержитесь, пока конвой дойдёт.',
    text: 'Наши транспорты идут в порт. Потопите охотников или продержитесь, пока конвой дойдёт. Потеряете все транспорты — бой проигран.',
    when: (c) => c.m.convoy && enRoute(c), intro: (d) => d.convoy },
  // ----- удобство -----
  { id: 'friends', pri: COMFORT, title: 'СВОИ В РАЙОНЕ', st: 'plot', hold: 20,
    brief: 'В районе целей ходят свои корабли — на планшете они отмечены как «СВОИ».',
    text: 'В районе целей ходят свои корабли — на планшете они отмечены как «СВОИ», их положение известно всегда. Не стреляйте ближе 400 м от них.',
    when: (c) => c.s.friends.some((f) => f.alive && !f.arrived), intro: (d) => d.friends },
  { id: 'waves', pri: COMFORT, title: 'ЦЕЛИ ПОДХОДЯТ ПО ОЧЕРЕДИ', hold: 20,
    brief: 'Не все цели появляются сразу — не тратьте весь боезапас на первую.',
    text: 'Не все цели появляются сразу: о новых разведка сообщит по ходу боя. Не тратьте весь боезапас на первую.',
    when: (c) => !c.m.survival && c.s.targets.some((t) => t.alive && t.delay > 0), intro: (d) => !d.survival && any(d, (k, t) => t.delay > 0) },
  { id: 'survival', pri: COMFORT, title: 'ОБОРОНА', dom: 'hTimeK', hold: 20,
    brief: 'Противник идёт волна за волной: за отбитую волну — ремонт и снаряды, прорвавшаяся цель стоит 25 прочности.',
    text: 'Противник идёт волна за волной. Отбили волну — батарею подлатают (+25 прочности) и подвезут снаряды; прорвавшаяся цель стоит 25 прочности.',
    when: (c) => c.m.survival, intro: (d) => d.survival },
  { id: 'observe', pri: COMFORT, title: 'СВОЙ ГЛАЗ', st: 'observe', hot: ['toTargetButton', 'scopeWheel'], since: 30,
    text: 'Разрыв можно наблюдать самому: пока снаряд летит, на посту НАБЛЮДЕНИЕ наведите трубу на цель — расчёт сразу доложит, правее или левее, перелёт или недолёт.',
    when: (c) => combatFlight(c) && !!c.a && c.a.alive && c.g.visible(c.a.id) && !c.s.scope.last, done: (c) => !!c.s.scope.last },
  { id: 'burst', pri: COMFORT, title: 'ОЧЕРЕДЬ', st: 'fire', hot: ['burstSelector'], since: 17,
    text: 'Снаряды ложатся у цели — добивайте очередью: переключатель «ОЧЕРЕДЬ» на посту ОГОНЬ даёт 2–3 выстрела на тех же установках, расчёт перезаряжает сам.',
    when: (c) => { const r = c.s.lastReport; return !!c.a && c.a.alive && !!r && r.observed && !!r.text && !r.special && r.targetId === c.a.id && Math.abs(r.over) <= 100 && Math.abs(r.right) <= 100 && c.s.fire.burst === 1; },
    done: (c) => c.s.fire.burst > 1 },
  { id: 'bracket', pri: COMFORT, title: 'ВИЛКА', st: 'fire', hot: ['bracketToggle'], since: 25,
    text: 'Не получается нащупать дальность? Тумблер «ВИЛКА» на посту ОГОНЬ даёт залп двумя стволами: ±150 м по дальности. Цель между разрывами — дальность взята верно.',
    when: (c) => { const r = c.s.lastReport; return c.s.shots >= 2 && !!c.a && c.a.alive && !!r && r.observed && !r.bracket && !r.special && r.targetId === c.a.id && Math.abs(r.over) >= 150 && !c.s.fire.salvo; },
    done: (c) => c.s.fire.salvo },
  { id: 'fatigue', pri: COMFORT, title: 'РАСЧЁТ УСТАЛ', dom: 'crew', since: 30,
    text: 'Уставший боец работает на четверть медленнее. Он отдохнёт сам, когда не занят; двойное касание его значка — аптечка снимет усталость сразу.',
    when: (c) => Object.keys(c.s.crew).some((k) => c.s.crew[k].state === 'tired') },
  // ----- меню -----
  { id: 'upgrades', pri: COMFORT, title: 'ОЧКИ СНАБЖЕНИЯ', menu: true,
    text: 'Хватает очков снабжения на улучшение башни — кнопка «СНАБЖЕНИЕ» в меню.', when: () => false },
];
const BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const topicById = (id) => (Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null);
/** Сколько секунд (настоящего времени) тема держится на экране, если игрок ничего не делает. */
export const TOPIC_HOLD = 40;
/** Тема не гаснет раньше этого, даже если её предикат уже ложен (чтобы подсказка не мелькала). */
export const TOPIC_MIN = 6;
/** В кампании задания с номерами меньше этого идут с пошаговыми подсказками (режим «НОВОЕ»). */
export const STEP_MISSIONS = 3;
