/* АРТА — Огневая позиция. Игровая логика и интерфейс. */
(function () {
  'use strict';
  var B = window.Ballistics, MIL = B.MIL, M = window.Missions;
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var DIFF = [
    { name: 'Новобранец', hint: 'Линейка показывает дальность и азимут. Цели, разрывы и снаряды в полёте видны на карте.' },
    { name: 'Наводчик', hint: 'Линейка работает, но разрывов на карте нет — только доклады наблюдателя. Цели в полярных координатах наносите сами.' },
    { name: 'Ветеран', hint: 'Никаких подсказок: только сетка, координаты, таблицы и калькулятор. Всё считаете сами.' }
  ];
  var RELOAD = 5, AZ_RATE = 260, EL_RATE = 130;

  // ---------- сохранение ----------
  var save = { unlocked: 1, stars: [], diff: 0 };
  try { var raw = localStorage.getItem('arta.save'); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* нет хранилища */ }
  function persist() { try { localStorage.setItem('arta.save', JSON.stringify(save)); } catch (e) { /* игнорируем */ } }

  // ---------- форматирование ----------
  function fmtM(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function fmtTime(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ---------- звук ----------
  var actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function boom(vol, dur, freq) {
    var a = audio(); if (!a) return;
    var n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    var g = a.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  function beep(freq, dur) {
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.04;
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* нет вибро */ } }

  // ---------- экраны ----------
  function show(id) { qsa('.screen').forEach(function (s) { s.classList.toggle('active', s.id === id); }); }

  var modalOpen = false, modalDismiss = null;
  function modal(html, buttons, dismissable) {
    $('modalBody').innerHTML = html;
    var box = $('modalBtns'); box.innerHTML = '';
    buttons.forEach(function (b) {
      var el = document.createElement('button');
      el.textContent = b.text; if (b.ghost) el.className = 'ghost';
      el.onclick = function () { closeModal(); if (b.fn) b.fn(); };
      box.appendChild(el);
    });
    $('modal').classList.add('open'); modalOpen = true;
    modalDismiss = dismissable ? closeModal : null;
    $('modalBody').scrollTop = 0;
  }
  function closeModal() { $('modal').classList.remove('open'); modalOpen = false; modalDismiss = null; }

  var HOWTO =
    '<h3>Как играть</h3>' +
    '<p>Вы — командир орудия на закрытой огневой позиции. Цель вы не видите: её координаты сообщает наблюдатель по рации. ' +
    'Ваша задача — <b>рассчитать установки</b> и навести орудие.</p>' +
    '<h4>1. Дальность и азимут</h4><p>По координатам орудия и цели:<br><b>ΔX = Xц − Xо, ΔY = Yц − Yо</b><br><b>Д = √(ΔX² + ΔY²)</b><br>' +
    '<b>A = atan(ΔX ÷ ΔY)</b> (если ΔY &lt; 0 — прибавьте 30-00; если результат отрицательный — 60-00).<br>' +
    'На лёгких уровнях это делает линейка 📏 на карте.</p>' +
    '<h4>2. Углы</h4><p>Все углы — в <b>делениях угломера</b>: круг = 60-00 (6000 дел.), север = 0-00, восток = 15-00, юг = 30-00, запад = 45-00. ' +
    'Одно деление на дальности 1 км — это примерно 1 метр в сторону.</p>' +
    '<h4>3. Таблицы стрельбы</h4><p>Выберите заряд, найдите строку с вашей дальностью и возьмите прицел <b>П</b>. ' +
    'Внесите поправки: на превышение цели (ΔП/10м), деривацию (угломер −Дер.), ветер (Wд, Wб).</p>' +
    '<h4>4. Огонь и корректировка</h4><p>Установите угломер, прицел, заряд и стреляйте. Наблюдатель доложит: ' +
    '«перелёт / недолёт» и «правее / левее» в метрах. Поправка прицела = метры ÷ ΔД/дел. ' +
    'Поправка угломера = метры ÷ дальность в км × 0,955.</p>' +
    '<h4>5. Демаскировка</h4><p>Каждый выстрел выдаёт вашу позицию. Заполнится шкала — прилетит ответ. Берегите снаряды и нервы.</p>';

  // ---------- меню ----------
  function refreshDiff() {
    qsa('#diffSeg button').forEach(function (b) { b.classList.toggle('on', +b.dataset.diff === save.diff); });
    $('diffHint').textContent = DIFF[save.diff].hint;
  }
  function buildMissionList() {
    var box = $('missionList'); box.innerHTML = '';
    M.CAMPAIGN.forEach(function (d, i) {
      var locked = i >= save.unlocked, st = save.stars[i] || 0;
      var el = document.createElement('button');
      el.className = 'mission' + (locked ? ' locked' : '');
      el.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="nm">' + esc(d.name) +
        '<small>' + (locked ? 'Закрыто' : d.targets.length + ' цел. · ' + d.ammo + ' снарядов') + '</small></span>' +
        '<span class="stars">' + '★★★'.slice(0, st) + '<i>' + '★★★'.slice(st) + '</i></span>';
      if (!locked) el.onclick = function () { startMission(d, i); };
      box.appendChild(el);
    });
  }

  // ==================================================================
  //                              ИГРА
  // ==================================================================
  var G = null;
  var view = { cx: 6000, cy: 6000, s: 0.03 };
  var tool = 'pan', showRings = false, curTab = 'map';
  var tblCharge = 0;

  function startMission(def, index) {
    audio();
    var m = M.generate(def);
    m.terrain.render();
    G = {
      m: m, def: def, index: index, diff: save.diff, time: 0, speed: 1,
      ammo: def.ammo, threat: 0, shotsFired: 0,
      gun: { setAz: 0, setEl: 300, curAz: 0, curEl: 300, charge: 0, reload: 0 },
      shells: [], impacts: [], marks: [], markN: 0, ruler: null, probe: null,
      events: [], log: [], shotLog: [], active: 0, over: false, unread: 0, lastTime: 0
    };
    var az0 = Math.round(B.azimuthMil(6000 - m.gun.e, 6000 - m.gun.n) / 100) * 100;
    G.gun.setAz = G.gun.curAz = az0;
    m.targets.forEach(function (t) { t.plot = null; t.shown = false; t.reported = false; });

    show('game');
    switchTab('map');
    setTool('pan');
    showRings = false; $('ringsBtn').classList.remove('on');
    $('radioLog').innerHTML = ''; $('shotLog').innerHTML = ''; $('notes').value = '';
    $('plotE').value = ''; $('plotN').value = ''; updatePlot();
    document.body.dataset.diff = G.diff;
    resizeCanvases();
    fitView();
    buildChargeSegs();
    buildTable();
    renderConditions();
    renderTargets();
    renderShotLog();
    updateGunUI();
    updateHUD();
    setInfo('');
    $('toast').innerHTML = '<span class="dim">Радиоэфир: тишина</span>'; $('toast').className = '';
    $('speedBtn').textContent = '×1'; $('speedBtn').classList.remove('on');
    G.unread = 0; $('radioBadge').style.display = 'none';

    // начальный радиообмен
    var t = 1;
    if (!m.op.atGun) { at(t, function () { radio('НП', 'Я «Сокол». Занял НП: X=' + fmtM(m.op.e) + ', Y=' + fmtM(m.op.n) + ', высота ' + m.op.h + '. Наблюдаю.'); }); t += 2.5; }
    else { at(t, function () { radio('НП', 'Я «Сокол», нахожусь у орудия. Отклонения даю от линии стрельбы.'); }); t += 2.5; }
    if (m.wind.speed > 0) { at(t, function () { radio('Метео', 'Ветер ' + B.fmtMil(m.wind.from) + ' (откуда дует), ' + m.wind.speed + ' м/с.'); }); t += 2.5; }
    m.targets.forEach(function (tg) { at(t, function () { reportTarget(tg, true); }); t += 3; });

    modal('<h3>' + (index != null ? 'Задача ' + (index + 1) + '. ' : '') + esc(def.name) + '</h3><p>' + def.brief + '</p>' +
      '<p class="dim">Сложность: ' + DIFF[G.diff].name + '</p>', [{ text: 'К бою!' }], true);
  }

  function at(t, fn) { G.events.push({ t: G.time + t, fn: fn }); }

  // ---------- рация ----------
  function radio(from, text, cls) {
    var item = { t: G.time, from: from, text: text };
    G.log.push(item);
    var el = document.createElement('div');
    el.className = 'msg ' + (cls || '');
    el.innerHTML = '<span class="t">' + fmtTime(item.t) + '</span> <b>' + esc(from) + ':</b> ' + esc(text);
    var box = $('radioLog'); box.insertBefore(el, box.firstChild);
    if (curTab !== 'radio') { G.unread++; $('radioBadge').textContent = G.unread; $('radioBadge').style.display = 'inline-block'; }
    var toast = $('toast');
    toast.innerHTML = '<b>' + esc(from) + ':</b> ' + esc(text);
    toast.className = '';
    void toast.offsetWidth; // перезапуск анимации вспышки
    toast.className = 'show ' + (cls || '');
    beep(cls === 'bad' ? 330 : 880, 0.07);
  }

  function targetReportText(t) {
    if (t.moving) {
      return 'X=' + fmtM(t.plot.e) + ', Y=' + fmtM(t.plot.n) + ', высота ' + t.plot.h + '. Курс ' + B.fmtMil(t.heading) + ', скорость ' + t.speed + ' м/с';
    }
    if (t.polar) return 'от НП: азимут ' + B.fmtMil(t.polar.az) + ', дальность ' + fmtM(t.polar.d) + ', высота ' + t.h;
    return 'X=' + fmtM(t.e) + ', Y=' + fmtM(t.n) + ', высота ' + t.h;
  }
  function reportTarget(t, first) {
    if (!t.alive) return;
    t.reported = true;
    if (t.moving) {
      t.plot = { e: Math.round(t.e / 10) * 10, n: Math.round(t.n / 10) * 10, h: Math.round(G.m.terrain.height(t.e, t.n)), time: G.time };
      t.shown = true;
    } else {
      t.plot = { e: t.e, n: t.n, h: t.h };
      t.shown = G.diff === 0 || (G.diff === 1 && !t.polar);
    }
    radio('НП', t.label + (first ? ': ' + t.name.toLowerCase() + '. ' : ' — ') + targetReportText(t) + '.');
    renderTargets();
  }

  // ---------- стрельба ----------
  function gunAligned() {
    var g = G.gun;
    return Math.abs(angDiff(g.setAz, g.curAz)) < 0.01 && Math.abs(g.setEl - g.curEl) < 0.01;
  }
  function angDiff(a, b) { var d = (a - b) % 6000; if (d > 3000) d -= 6000; if (d < -3000) d += 6000; return d; }

  function fire() {
    var g = G.gun;
    if (G.over || G.ammo <= 0 || g.reload > 0 || !gunAligned()) return;
    var ch = B.CHARGES[g.charge];
    var v0 = ch.v0 * (1 + gauss() * 0.0015);
    var az = g.curAz + gauss() * 0.3, el = g.curEl + gauss() * 0.3;
    var p0 = { e: G.m.gun.e, n: G.m.gun.n, h: G.m.gun.h + 1.5 };
    var res = B.fly(p0, az, el, v0, G.m.wind, G.m.terrain.height, { path: true, pathEvery: 15 });
    G.ammo--; G.shotsFired++;
    g.reload = RELOAD;
    var mult = G.diff === 0 ? 0.75 : 1;
    G.threat = Math.min(100, G.threat + G.def.threat * mult);
    var tgt = G.m.targets[G.active];
    var shot = { n: G.shotsFired, az: g.setAz, el: g.setEl, charge: g.charge, tof: res.t, result: 'в полёте… ' + res.t.toFixed(0) + ' с', label: tgt && tgt.alive ? tgt.label : '' };
    G.shotLog.unshift(shot);
    var shell = { t0: G.time, res: res, shot: shot };
    G.shells.push(shell);
    at(res.t, function () { impact(shell); });
    boom(0.9, 1.1, 420); vibrate(120);
    document.body.classList.add('shake');
    setTimeout(function () { document.body.classList.remove('shake'); }, 350);
    if (G.threat >= 100 && !G.spotted) {
      G.spotted = true;
      at(2, function () { radio('Штаб', 'Вашу позицию засекли! Ответный огонь противника с минуты на минуту!', 'bad'); });
      at(16, function () { if (!G.over) { boom(1, 1.6, 300); vibrate(500); finish(false, 'Огневая позиция накрыта ответным огнём противника.'); } });
    } else if (G.threat >= 75 && !G.warned) {
      G.warned = true;
      at(2, function () { radio('Штаб', 'Противник ведёт звуковую разведку. Ещё несколько выстрелов — и вас засекут.', 'bad'); });
    }
    renderShotLog(); updateGunUI();
  }

  function impact(shell) {
    var r = shell.res, ts = G.m.targets, op = G.m.op, gun = G.m.gun;
    G.shells.splice(G.shells.indexOf(shell), 1);
    G.impacts.push({ e: r.e, n: r.n, n0: shell.shot.n, time: G.time });
    boom(0.35, 1.4, 220);

    // к какой цели привязать доклад
    var ref = ts[G.active];
    if (!ref || !ref.alive) ref = nearestAlive(r.e, r.n);
    var killed = [], damaged = [];
    ts.forEach(function (t) {
      if (!t.alive) return;
      var d = Math.hypot(t.e - r.e, t.n - r.n);
      if (d <= t.r) { t.hp = 0; }
      else if (d <= t.r * 2) { t.hp -= 1; if (t.hp > 0) damaged.push(t); }
      if (t.hp <= 0) { t.alive = false; killed.push(t); }
    });

    var text;
    if (!ref) text = 'Разрыв наблюдаю.';
    else {
      var de = r.e - ref.e, dn = r.n - ref.n, dist = Math.hypot(de, dn);
      var ue = ref.e - op.e, un = ref.n - op.n;
      if (op.atGun) { ue = ref.e - gun.e; un = ref.n - gun.n; }
      var L = Math.hypot(ue, un) || 1; ue /= L; un /= L;
      var along = Math.round((de * ue + dn * un) / 10) * 10;
      var cross = Math.round((de * un - dn * ue) / 10) * 10;
      if (dist > 1800) text = ref.label + ': разрыв не наблюдаю! Проверьте установки.';
      else if (!ref.alive) text = ref.label + ': прямое попадание!';
      else if (Math.abs(along) < 10 && Math.abs(cross) < 10) text = ref.label + ': разрыв у цели, отклонений нет.';
      else {
        var parts = [];
        if (Math.abs(along) >= 10) parts.push((along > 0 ? 'перелёт ' : 'недолёт ') + Math.abs(along));
        if (Math.abs(cross) >= 10) parts.push((cross > 0 ? 'правее ' : 'левее ') + Math.abs(cross));
        text = ref.label + ': ' + parts.join(', ') + '.';
      }
      shell.shot.result = text.replace(ref.label + ': ', '');
    }
    radio('НП', text);
    damaged.forEach(function (t) { radio('НП', t.label + ' повреждена. Повторить огонь на тех же установках!'); });
    killed.forEach(function (t) { radio('НП', t.label + ' (' + t.name.toLowerCase() + ') уничтожена!', 'good'); vibrate(200); });
    if (killed.length) {
      var cur = ts[G.active];
      if (!cur || !cur.alive) { var nx = ts.filter(function (t) { return t.alive; })[0]; if (nx) G.active = nx.id; }
    }
    renderTargets(); renderShotLog();
    checkEnd();
  }

  function nearestAlive(e, n) {
    var best = null, bd = 1e12;
    G.m.targets.forEach(function (t) { if (!t.alive) return; var d = Math.hypot(t.e - e, t.n - n); if (d < bd) { bd = d; best = t; } });
    return best;
  }

  function checkEnd() {
    if (G.over) return;
    var alive = G.m.targets.filter(function (t) { return t.alive; }).length;
    if (alive === 0) { at(1.5, function () { finish(true); }); return; }
    if (G.ammo <= 0 && G.shells.length === 0) at(2, function () { finish(false, 'Боекомплект израсходован, цели не подавлены.'); });
  }

  function finish(win, reason) {
    if (G.over) return;
    G.over = true;
    var n = G.m.targets.length, par = 0;
    G.m.targets.forEach(function (t) { par += 3 + (t.maxHp - 1) + (t.moving ? 2 : 0); });
    var stars = !win ? 0 : G.shotsFired <= par ? 3 : G.shotsFired <= par + 2 * n ? 2 : 1;
    var idx = G.index;
    if (win && idx != null) {
      save.stars[idx] = Math.max(save.stars[idx] || 0, stars);
      save.unlocked = Math.max(save.unlocked, Math.min(M.CAMPAIGN.length, idx + 2));
      persist();
    }
    var html = '<h3>' + (win ? 'Задача выполнена' : 'Задача провалена') + '</h3>' +
      (win ? '<div class="bigstars">' + '★★★'.slice(0, stars) + '<i>' + '★★★'.slice(stars) + '</i></div>' : '<p class="bad">' + esc(reason || '') + '</p>') +
      '<table class="res"><tr><td>Израсходовано снарядов</td><td>' + G.shotsFired + '</td></tr>' +
      '<tr><td>Норматив на «отлично»</td><td>' + par + '</td></tr>' +
      '<tr><td>Время</td><td>' + fmtTime(G.time) + '</td></tr>' +
      '<tr><td>Уничтожено целей</td><td>' + G.m.targets.filter(function (t) { return !t.alive; }).length + ' / ' + n + '</td></tr></table>';
    var btns = [];
    var def = G.def;
    if (win && idx != null && idx + 1 < M.CAMPAIGN.length) btns.push({ text: 'Следующая задача', fn: function () { startMission(M.CAMPAIGN[idx + 1], idx + 1); } });
    if (def.skirmish) btns.push({ text: 'Новый бой', fn: function () { startMission(M.skirmishDef(save.diff), null); } });
    else btns.push({ text: 'Повторить', ghost: win, fn: function () { startMission(def, idx); } });
    btns.push({ text: 'В меню', ghost: true, fn: toMenu });
    modal(html, btns, false);
  }

  function toMenu() { G = null; closeModal(); buildMissionList(); show('menu'); }

  // ---------- игровой цикл ----------
  function tick(now) {
    requestAnimationFrame(tick);
    if (!G) return;
    var real = Math.min(0.1, (now - (G.lastTime || now)) / 1000);
    G.lastTime = now;
    if (modalOpen || G.over || kpOpen) { draw(); return; }
    var dt = real * G.speed;
    G.time += dt;

    // наводка и заряжание
    var g = G.gun, d = angDiff(g.setAz, g.curAz), stepA = AZ_RATE * dt;
    g.curAz = Math.abs(d) <= stepA ? g.setAz : B.norm6000(g.curAz + Math.sign(d) * stepA);
    var de = g.setEl - g.curEl, stepE = EL_RATE * dt;
    g.curEl = Math.abs(de) <= stepE ? g.setEl : g.curEl + Math.sign(de) * stepE;
    if (g.reload > 0) g.reload = Math.max(0, g.reload - dt);

    // движущиеся цели
    G.m.targets.forEach(function (t) {
      if (!t.moving || !t.alive || !t.reported) return;
      var ds = t.speed * dt;
      t.e += ds * Math.sin(t.heading * MIL); t.n += ds * Math.cos(t.heading * MIL);
      t.pathLeft -= ds;
      var S = G.m.terrain.size;
      if (t.pathLeft <= 0 || t.e < 200 || t.n < 200 || t.e > S - 200 || t.n > S - 200) {
        t.alive = false; t.escaped = true;
        radio('НП', t.label + ' ушла из зоны наблюдения.', 'bad');
        finish(false, 'Колонна противника ушла из-под огня.');
      } else if (G.time - t.plot.time >= 25) reportTarget(t, false);
    });

    // события по времени
    if (G.events.length) {
      var due = G.events.filter(function (e) { return e.t <= G.time; });
      if (due.length) {
        G.events = G.events.filter(function (e) { return e.t > G.time; });
        due.sort(function (a, b) { return a.t - b.t; }).forEach(function (e) { if (G) e.fn(); });
      }
    }
    if (!G) return;
    if (!G.spotted) G.threat = Math.max(0, G.threat - dt * 0.05);
    updateHUD();
    draw();
  }

  function updateHUD() {
    $('hudTime').textContent = fmtTime(G.time);
    $('hudAmmo').textContent = G.ammo;
    var alive = G.m.targets.filter(function (t) { return t.alive; }).length;
    $('hudTargets').textContent = (G.m.targets.length - alive) + '/' + G.m.targets.length;
    var th = $('hudThreat'); th.style.width = G.threat + '%';
    th.className = G.threat >= 75 ? 'hot' : G.threat >= 45 ? 'warm' : '';
    var g = G.gun, st = $('gunStatus'), ready = false;
    if (G.ammo <= 0) { st.textContent = 'СНАРЯДОВ НЕТ'; st.className = 'status bad'; }
    else if (g.reload > 0) { st.textContent = 'ЗАРЯЖАНИЕ ' + g.reload.toFixed(1) + ' с'; st.className = 'status wait'; }
    else if (!gunAligned()) { st.textContent = 'НАВОДКА…'; st.className = 'status wait'; }
    else { st.textContent = 'ГОТОВО К ВЫСТРЕЛУ'; st.className = 'status ok'; ready = true; }
    $('fireBtn').disabled = !ready;
    $('curAz').textContent = B.fmtMil(g.curAz); $('curEl').textContent = B.fmtMil(g.curEl);
  }

  // ---------- вкладки ----------
  function switchTab(tab) {
    curTab = tab;
    qsa('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    qsa('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'p-' + tab); });
    if (tab === 'radio' && G) { G.unread = 0; $('radioBadge').style.display = 'none'; }
    resizeCanvases();
  }

  // ---------- рация: списки ----------
  function renderTargets() {
    var box = $('targetList'); box.innerHTML = '';
    G.m.targets.forEach(function (t) {
      if (!t.reported) return;
      var el = document.createElement('button');
      el.className = 'tgt' + (t.id === G.active ? ' on' : '') + (t.alive ? '' : ' dead');
      var st = !t.alive ? (t.escaped ? 'ушла' : 'уничтожена') : t.hp < t.maxHp ? 'повреждена' : (t.id === G.active ? 'корректировка' : 'не поражена');
      el.innerHTML = '<span class="ic">' + t.icon + '</span><span class="tx"><b>' + t.label + '</b> · ' + esc(t.name) +
        '<small>' + esc(targetReportText(t)) + '</small></span><span class="st">' + st + '</span>';
      el.onclick = function () { if (t.alive) { G.active = t.id; renderTargets(); } };
      box.appendChild(el);
    });
    if (!box.firstChild) box.innerHTML = '<div class="dim">Ожидание донесений наблюдателя…</div>';
  }
  function renderConditions() {
    var m = G.m, h = '';
    h += '<div><span>Орудие (ОП)</span><b>X=' + fmtM(m.gun.e) + ' &nbsp;Y=' + fmtM(m.gun.n) + ' &nbsp;h=' + m.gun.h + '</b></div>';
    h += '<div><span>Наблюдатель (НП)</span><b>' + (m.op.atGun ? 'у орудия' : 'X=' + fmtM(m.op.e) + ' &nbsp;Y=' + fmtM(m.op.n) + ' &nbsp;h=' + m.op.h) + '</b></div>';
    h += '<div><span>Ветер</span><b>' + (m.wind.speed ? 'откуда ' + B.fmtMil(m.wind.from) + ', ' + m.wind.speed + ' м/с' : 'штиль') + '</b></div>';
    h += '<div><span>Отклонения</span><b>' + (m.op.atGun ? 'от линии стрельбы' : 'от линии НП → цель') + '</b></div>';
    $('conditions').innerHTML = h;
  }
  function renderShotLog() {
    $('shotLog').innerHTML = G.shotLog.map(function (s) {
      return '<div><b>№' + s.n + '</b> ' + B.CHARGES[s.charge].short + ' · У ' + B.fmtMil(s.az) + ' · П ' + B.fmtMil(s.el) +
        ' <span>→ ' + esc(s.result) + '</span></div>';
    }).join('') || '<div class="dim">Выстрелов не было.</div>';
  }

  // ---------- орудие: UI ----------
  function buildChargeSegs() {
    ['chargeSeg', 'tblCharge'].forEach(function (id) {
      var box = $(id); box.innerHTML = '';
      B.CHARGES.forEach(function (c, i) {
        var b = document.createElement('button');
        b.textContent = id === 'chargeSeg' ? String(i + 1) : c.name;
        b.onclick = function () {
          if (id === 'chargeSeg') { G.gun.charge = i; updateGunUI(); }
          else { tblCharge = i; buildTable(); }
        };
        box.appendChild(b);
      });
    });
  }
  function updateGunUI() {
    var g = G.gun;
    $('setAz').textContent = B.fmtMil(g.setAz); $('setEl').textContent = B.fmtMil(g.setEl);
    qsa('#chargeSeg button').forEach(function (b, i) { b.classList.toggle('on', i === g.charge); });
    qsa('#tblCharge button').forEach(function (b, i) { b.classList.toggle('on', i === tblCharge); });
  }
  function setAz(v) { G.gun.setAz = B.norm6000(Math.round(v)); updateGunUI(); }
  function setEl(v) { G.gun.setEl = Math.max(B.EL_MIN, Math.min(B.EL_MAX, Math.round(v))); updateGunUI(); }

  // ---------- таблицы ----------
  function buildTable() {
    var tb = B.getTables()[tblCharge], h = '<thead><tr><th>Д, м</th><th>П</th><th>ΔП/10м</th><th>ΔД/дел</th><th>t, с</th><th>Дер.</th><th>Wд</th><th>Wб</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += '<tr data-r="' + r.range + '"><td>' + fmtM(r.range) + '</td><td class="el">' + B.fmtMil(r.el, true) + '</td><td>' +
        (isNaN(r.dEl10) ? '—' : r.dEl10.toFixed(1)) + '</td><td>' + r.dRperMil.toFixed(1) + '</td><td>' + r.tof.toFixed(1) + '</td><td>' +
        r.driftMil.toFixed(1) + '</td><td>' + r.windHead.toFixed(1) + '</td><td>' + r.windCross.toFixed(2) + '</td></tr>';
    });
    $('fireTable').innerHTML = h + '</tbody>';
    updateGunUI();
    findRow();
  }
  function findRow() {
    var v = parseFloat($('tblFind').value);
    qsa('#fireTable tr.hl').forEach(function (r) { r.classList.remove('hl'); });
    if (!(v > 0)) return;
    var rows = qsa('#fireTable tbody tr'), lo = null;
    rows.forEach(function (r) { if (+r.dataset.r <= v) lo = r; });
    if (!lo) lo = rows[0];
    if (!lo) return;
    lo.classList.add('hl');
    if (+lo.dataset.r < v && lo.nextElementSibling) lo.nextElementSibling.classList.add('hl');
    lo.scrollIntoView({ block: 'center' });
  }

  // ---------- вычислитель ----------
  var plotFrom = 'gun';
  function updatePlot() {
    if (!G) return;
    var e = parseFloat($('plotE').value), n = parseFloat($('plotN').value), out = $('plotOut');
    var o = plotFrom === 'gun' ? G.m.gun : G.m.op;
    var head = '<div class="dim">Начало: X=' + fmtM(o.e) + ', Y=' + fmtM(o.n) + ', h=' + o.h + '</div>';
    if (isNaN(e) || isNaN(n)) { out.innerHTML = head + '<div class="dim">Введите координаты точки.</div>'; return; }
    var de = e - o.e, dn = n - o.n;
    var h = head + '<div>ΔX = <b>' + fmtSigned(de) + '</b> &nbsp; ΔY = <b>' + fmtSigned(dn) + '</b></div>';
    if (G.diff < 2) h += '<div>Д = <b>' + fmtM(Math.hypot(de, dn)) + ' м</b> &nbsp; A = <b>' + B.fmtMil(B.azimuthMil(de, dn), true) + '</b></div>';
    else h += '<div class="dim">Дальность и азимут вычислите сами: Д = √(ΔX²+ΔY²), A = atan(ΔX÷ΔY).</div>';
    out.innerHTML = h;
  }
  function fmtSigned(v) { return (v < 0 ? '−' : '+') + fmtM(Math.abs(v)); }

  var calcExpr = '';
  var CALC_KEYS = ['7', '8', '9', '÷', '⌫', '4', '5', '6', '×', 'C', '1', '2', '3', '−', '(', '0', '.', '=', '+', ')', '√', 'x²', 'sin', 'cos', 'atan'];
  function buildCalc() {
    var box = $('calcKeys');
    CALC_KEYS.forEach(function (k) {
      var b = document.createElement('button');
      b.textContent = k;
      if (/[0-9.]/.test(k)) b.className = 'num'; else if (k === '=') b.className = 'eq';
      b.onclick = function () { calcKey(k); };
      box.appendChild(b);
    });
  }
  var calcJustEvaluated = false;
  function calcKey(k) {
    if (k === 'C') calcExpr = '';
    else if (k === '⌫') calcExpr = calcExpr.replace(/(sin\(|cos\(|atan\(|√\(|.)$/, '');
    else if (k === '=') {
      try {
        var v = window.Calc.evaluate(calcExpr);
        if (!isFinite(v)) throw new Error('nan');
        var s = String(Math.round(v * 10000) / 10000).replace('-', '−');
        $('calcRes').textContent = s;
        calcExpr = s; calcJustEvaluated = true;
        $('calcExpr').textContent = calcExpr;
        return;
      } catch (e) { $('calcRes').textContent = 'Ошибка'; return; }
    } else {
      if (calcJustEvaluated && /[0-9.]/.test(k)) calcExpr = '';
      if (k === 'x²') calcExpr += '²';
      else if (k === 'sin' || k === 'cos' || k === 'atan' || k === '√') calcExpr += k + '(';
      else calcExpr += k;
    }
    calcJustEvaluated = false;
    $('calcExpr').textContent = calcExpr;
  }

  // ---------- цифровая клавиатура установок ----------
  var kpOpen = false, kp = { val: '', which: 'az' };
  function openKeypad(which) {
    kp.which = which; kp.val = '';
    $('kpTitle').textContent = which === 'az' ? 'Угломер (азимут)' : 'Прицел (возвышение)';
    $('kpHint').textContent = which === 'az' ? 'Введите 0…5999 делений (например 1234 = 12-34)' : 'Введите ' + B.EL_MIN + '…' + B.EL_MAX + ' делений';
    renderKp();
    $('keypad').classList.add('open'); kpOpen = true;
  }
  function renderKp() { $('kpVal').textContent = kp.val === '' ? '—' : B.fmtMil(parseInt(kp.val, 10)); }
  function kpKey(k) {
    if (k === 'X') { closeKp(); return; }
    if (k === 'OK') {
      if (kp.val !== '') { var v = parseInt(kp.val, 10); if (kp.which === 'az') setAz(v); else setEl(v); }
      closeKp(); return;
    }
    if (k === 'C') kp.val = '';
    else if (k === 'B') kp.val = kp.val.slice(0, -1);
    else if (kp.val.length < 4) kp.val += k;
    renderKp();
  }
  function closeKp() { $('keypad').classList.remove('open'); kpOpen = false; }

  // ==================================================================
  //                              КАРТА
  // ==================================================================
  var mapC = $('mapCanvas'), mctx = mapC.getContext('2d');
  var gunC = $('gunCanvas'), gctx = gunC.getContext('2d');
  var dpr = Math.min(2, window.devicePixelRatio || 1);

  function resizeCanvases() {
    [mapC, gunC].forEach(function (c) {
      var w = c.clientWidth, h = c.clientHeight;
      if (w && h && (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr))) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    });
  }
  function fitView() {
    var w = mapC.clientWidth || 360, h = mapC.clientHeight || 500;
    view.s = Math.min(w, h) / 12600; view.cx = 6000; view.cy = 6000;
  }
  function w2s(e, n) { return { x: (e - view.cx) * view.s + mapC.clientWidth / 2, y: (view.cy - n) * view.s + mapC.clientHeight / 2 }; }
  function s2w(x, y) { return { e: (x - mapC.clientWidth / 2) / view.s + view.cx, n: view.cy - (y - mapC.clientHeight / 2) / view.s }; }
  function clampView() {
    var w = mapC.clientWidth, h = mapC.clientHeight;
    view.s = Math.max(Math.min(w, h) / 14000, Math.min(0.5, view.s));
    view.cx = Math.max(0, Math.min(12000, view.cx)); view.cy = Math.max(0, Math.min(12000, view.cy));
  }
  function zoomAt(f, x, y) {
    var p = s2w(x, y);
    view.s *= f; clampView();
    var q = s2w(x, y);
    view.cx += p.e - q.e; view.cy += p.n - q.n; clampView();
  }

  function draw() {
    if (!G) return;
    if (curTab === 'map') drawMap();
    else if (curTab === 'gun') drawGun();
  }

  function label(ctx, text, x, y, color, align) {
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(240,234,214,.9)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#222'; ctx.fillText(text, x, y);
  }

  function drawMap() {
    var ctx = mctx, W = mapC.clientWidth, H = mapC.clientHeight, m = G.m, S = m.terrain.size, i;
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14170f'; ctx.fillRect(0, 0, W, H);
    var o = w2s(0, S), sz = S * view.s;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(m.terrain.image, o.x, o.y, sz, sz);

    // населённые пункты
    m.terrain.villages.forEach(function (v) {
      ctx.fillStyle = '#5b4a3a';
      var hs = Math.max(1.5, 26 * view.s);
      v.houses.forEach(function (hh) { var p = w2s(hh.e, hh.n); ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs); });
      if (view.s > 0.035) { var p = w2s(v.e, v.n + 260); label(ctx, v.name, p.x, p.y, '#4a3d30', 'center'); }
    });

    // координатная сетка
    var minor = view.s > 0.12;
    for (i = 0; i <= S; i += minor ? 100 : 1000) {
      var km = i % 1000 === 0, a = w2s(i, 0), b = w2s(i, S), c = w2s(0, i), d = w2s(S, i);
      ctx.strokeStyle = km ? 'rgba(40,60,110,.55)' : 'rgba(40,60,110,.16)'; ctx.lineWidth = km ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    for (i = 0; i <= S; i += 1000) {
      var px = w2s(i, 0).x, py = w2s(0, i).y, t = (i / 1000 < 10 ? '0' : '') + i / 1000;
      if (px > 14 && px < W - 14) label(ctx, t, px, Math.max(8, o.y - 8), '#263e7a', 'center');
      if (py > 14 && py < H - 14) label(ctx, t, Math.max(10, o.x - 10), py, '#263e7a', 'center');
    }

    // круг дальностей и азимутов
    var gp = w2s(m.gun.e, m.gun.n);
    if (showRings) {
      for (i = 1; i <= 10; i++) {
        ctx.strokeStyle = 'rgba(150,30,20,.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(gp.x, gp.y, i * 1000 * view.s, 0, 7); ctx.stroke();
        label(ctx, i + ' км', gp.x + i * 1000 * view.s * 0.7071 + 3, gp.y - i * 1000 * view.s * 0.7071, '#8a2a1c');
      }
      for (i = 0; i < 6000; i += 100) {
        var an = i * MIL, r1 = (i % 500 === 0 ? 0 : 9500) * view.s, r2 = 10000 * view.s;
        ctx.strokeStyle = i % 500 === 0 ? 'rgba(150,30,20,.35)' : 'rgba(150,30,20,.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gp.x + Math.sin(an) * r1, gp.y - Math.cos(an) * r1); ctx.lineTo(gp.x + Math.sin(an) * r2, gp.y - Math.cos(an) * r2); ctx.stroke();
        if (i % 500 === 0) label(ctx, B.fmtMil(i), gp.x + Math.sin(an) * (r2 + 16), gp.y - Math.cos(an) * (r2 + 16), '#8a2a1c', 'center');
      }
    }

    // линия ствола
    var ga = G.gun.curAz * MIL, gl = Math.max(24, 400 * view.s);
    ctx.strokeStyle = '#1d2a12'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gp.x, gp.y); ctx.lineTo(gp.x + Math.sin(ga) * gl, gp.y - Math.cos(ga) * gl); ctx.stroke();

    // разрывы и снаряды (только для новобранца)
    if (G.diff === 0) {
      G.impacts.forEach(function (im) {
        var p = w2s(im.e, im.n);
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5); ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x - 5, p.y + 5); ctx.stroke();
        label(ctx, '№' + im.n0, p.x + 8, p.y - 8, '#111');
      });
      G.shells.forEach(function (sh) {
        var tt = G.time - sh.t0, pa = sh.res.path, k = 0;
        while (k < pa.length - 2 && pa[k + 1].t < tt) k++;
        var f = Math.max(0, Math.min(1, (tt - pa[k].t) / ((pa[k + 1].t - pa[k].t) || 1)));
        var p = w2s(pa[k].e + (pa[k + 1].e - pa[k].e) * f, pa[k].n + (pa[k + 1].n - pa[k].n) * f);
        ctx.fillStyle = '#c8281a'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
      });
    }
    // вспышка свежего разрыва у новобранца
    if (G.diff === 0) G.impacts.forEach(function (im) {
      var age = G.time - im.time; if (age > 1.2) return;
      var p = w2s(im.e, im.n); ctx.strokeStyle = 'rgba(220,90,20,' + (1 - age / 1.2) + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6 + age * 30, 0, 7); ctx.stroke();
    });

    // цели
    m.targets.forEach(function (t) {
      if (!t.shown || !t.plot) return;
      var p = w2s(t.plot.e, t.plot.n), act = t.id === G.active && t.alive;
      ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = !t.alive ? 'rgba(60,60,60,.7)' : '#c8281a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 0); ctx.lineTo(0, 9); ctx.lineTo(-9, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t.alive ? t.icon : '×', 0, 0.5);
      if (act) { ctx.strokeStyle = '#c8281a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); }
      ctx.restore();
      label(ctx, t.label, p.x + 13, p.y - 11, t.alive ? '#8a1408' : '#444');
    });

    // НП
    if (!m.op.atGun) {
      var q = w2s(m.op.e, m.op.n);
      ctx.fillStyle = '#1a55a8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(q.x, q.y - 9); ctx.lineTo(q.x + 9, q.y + 7); ctx.lineTo(q.x - 9, q.y + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      label(ctx, 'НП', q.x + 12, q.y, '#12407f');
    }
    // орудие
    ctx.fillStyle = '#243a12'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gp.x, gp.y, 8, 0, 7); ctx.fill(); ctx.stroke();
    label(ctx, 'ОП', gp.x + 12, gp.y + 10, '#1d2a12');

    // метки
    G.marks.forEach(function (mk) {
      var p = w2s(mk.e, mk.n);
      ctx.strokeStyle = '#6a1b9a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke();
      label(ctx, mk.name, p.x + 9, p.y - 9, '#4a126c');
    });

    // линейка
    if (G.ruler) {
      var r = w2s(G.ruler.e, G.ruler.n);
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(gp.x, gp.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      if (!m.op.atGun) { var q2 = w2s(m.op.e, m.op.n); ctx.strokeStyle = '#1a55a8'; ctx.beginPath(); ctx.moveTo(q2.x, q2.y); ctx.lineTo(r.x, r.y); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(r.x, r.y, 3.5, 0, 7); ctx.fill();
    }
    if (G.probe) {
      var pp = w2s(G.probe.e, G.probe.n);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pp.x, pp.y, 7, 0, 7);
      ctx.moveTo(pp.x - 12, pp.y); ctx.lineTo(pp.x + 12, pp.y); ctx.moveTo(pp.x, pp.y - 12); ctx.lineTo(pp.x, pp.y + 12); ctx.stroke();
    }
  }

  // привязка к объектам карты
  function snap(x, y) {
    var best = null, bd = 24, m = G.m;
    function test(e, n, name) { var p = w2s(e, n), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { e: e, n: n, name: name, snapped: true }; } }
    m.targets.forEach(function (t) { if (t.shown && t.plot) test(t.plot.e, t.plot.n, t.label); });
    G.marks.forEach(function (mk) { test(mk.e, mk.n, mk.name); });
    test(m.gun.e, m.gun.n, 'Орудие');
    if (!m.op.atGun) test(m.op.e, m.op.n, 'НП');
    if (G.diff === 0) G.impacts.forEach(function (im) { test(im.e, im.n, 'Разрыв №' + im.n0); });
    if (best) return best;
    var w = s2w(x, y);
    return { e: Math.round(w.e / 10) * 10, n: Math.round(w.n / 10) * 10, name: 'Точка', snapped: false };
  }
  function pointInfo(p) {
    return '<b>' + esc(p.name) + '</b>: X=' + fmtM(p.e) + ' Y=' + fmtM(p.n) + ' h=' + Math.round(G.m.terrain.height(p.e, p.n));
  }
  function polarInfo(from, p, nm) {
    var de = p.e - from.e, dn = p.n - from.n;
    return '<div>' + nm + ': Д = <b>' + fmtM(Math.hypot(de, dn)) + ' м</b>, A = <b>' + B.fmtMil(B.azimuthMil(de, dn), true) + '</b></div>';
  }
  function setInfo(html) { var el = $('mapInfo'); el.innerHTML = html || ''; el.style.display = html ? 'block' : 'none'; }

  function mapTap(x, y) {
    var p = snap(x, y), m = G.m;
    if (p.e < 0 || p.n < 0 || p.e > m.terrain.size || p.n > m.terrain.size) return;
    if (tool === 'ruler') {
      G.ruler = p; G.probe = null;
      var h = '<div>' + pointInfo(p) + '</div>';
      if (G.diff < 2) {
        h += polarInfo(m.gun, p, 'От орудия');
        if (!m.op.atGun) h += polarInfo(m.op, p, '<span class="blue">От НП</span>');
      } else h += '<div class="dim">Ветеран считает дальность и азимут сам.</div>';
      setInfo(h);
    } else if (tool === 'mark') {
      if (p.snapped && G.marks.some(function (mk) { return mk.e === p.e && mk.n === p.n; })) {
        G.marks = G.marks.filter(function (mk) { return !(mk.e === p.e && mk.n === p.n); });
        setInfo('Метка удалена.');
      } else addMark(p.e, p.n);
    } else {
      G.probe = p; G.ruler = null;
      setInfo(pointInfo(p));
    }
  }
  function addMark(e, n) {
    G.markN++;
    var mk = { e: e, n: n, name: 'М' + G.markN };
    G.marks.push(mk);
    setInfo(pointInfo(mk));
    return mk;
  }
  function setTool(t) {
    tool = t;
    qsa('.map-tools [data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
  }

  // жесты на карте
  var ptrs = {}, gesture = null;
  mapC.addEventListener('pointerdown', function (e) {
    if (!G) return;
    mapC.setPointerCapture(e.pointerId);
    ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY };
    var ids = Object.keys(ptrs);
    if (ids.length === 1) gesture = { type: 'tap', x0: e.offsetX, y0: e.offsetY, moved: false };
    else if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  mapC.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId]; if (!p || !gesture) return;
    var dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    var ids = Object.keys(ptrs);
    if (gesture.type === 'pinch' && ids.length >= 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.d > 0 && d > 0) zoomAt(d / gesture.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.d = d;
    } else if (gesture.type === 'tap') {
      if (!gesture.moved && Math.hypot(e.offsetX - gesture.x0, e.offsetY - gesture.y0) > 8) gesture.moved = true;
      if (gesture.moved) { view.cx -= dx / view.s; view.cy += dy / view.s; clampView(); }
    }
  });
  function ptrEnd(e) {
    if (!ptrs[e.pointerId]) return;
    delete ptrs[e.pointerId];
    if (gesture && gesture.type === 'tap' && !gesture.moved && e.type === 'pointerup') mapTap(e.offsetX, e.offsetY);
    if (Object.keys(ptrs).length === 0) gesture = null;
    else if (gesture && gesture.type === 'pinch') gesture = { type: 'none' };
  }
  mapC.addEventListener('pointerup', ptrEnd);
  mapC.addEventListener('pointercancel', ptrEnd);
  mapC.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, { passive: false });

  // ---------- рисунок орудия ----------
  function drawGun() {
    var ctx = gctx, W = gunC.clientWidth, H = gunC.clientHeight, g = G.gun, i;
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // буссоль (азимут)
    var R = Math.min(H / 2 - 14, W / 4 - 12), cx = W * 0.27, cy = H / 2;
    ctx.fillStyle = '#12150e'; ctx.strokeStyle = '#6b6a4a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.stroke();
    ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i < 6000; i += 100) {
      var a = i * MIL, big = i % 500 === 0, r1 = R - (big ? 9 : 5);
      ctx.strokeStyle = big ? '#d9c27a' : '#6b6a4a'; ctx.lineWidth = big ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke();
      if (i % 1500 === 0) { ctx.fillStyle = '#d9c27a'; ctx.fillText(String(i / 100), cx + Math.sin(a) * (R - 19), cy - Math.cos(a) * (R - 19)); }
    }
    var sa = g.setAz * MIL, ca = g.curAz * MIL;
    ctx.strokeStyle = 'rgba(217,194,122,.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(sa) * (R - 10), cy - Math.cos(sa) * (R - 10)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#e0523a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - Math.sin(ca) * 8, cy + Math.cos(ca) * 8); ctx.lineTo(cx + Math.sin(ca) * (R - 12), cy - Math.cos(ca) * (R - 12)); ctx.stroke();
    ctx.fillStyle = '#6b6a4a'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 7); ctx.fill();

    // возвышение (вид сбоку)
    var bx = W * 0.58, by = H - 22, L = Math.min(W * 0.36, H - 40);
    ctx.strokeStyle = '#6b6a4a'; ctx.lineWidth = 1; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(bx - 14, by); ctx.lineTo(bx + L + 6, by); ctx.stroke();
    for (i = 0; i <= 1500; i += 100) {
      var e = i * MIL, bg = i % 500 === 0;
      ctx.strokeStyle = bg ? '#d9c27a' : '#6b6a4a';
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(e) * (L - (bg ? 8 : 4)), by - Math.sin(e) * (L - (bg ? 8 : 4))); ctx.lineTo(bx + Math.cos(e) * L, by - Math.sin(e) * L); ctx.stroke();
      if (bg) { ctx.fillStyle = '#d9c27a'; ctx.fillText(String(i / 100), bx + Math.cos(e) * (L + 10), by - Math.sin(e) * (L + 10)); }
    }
    var se = g.setEl * MIL, ce = g.curEl * MIL;
    ctx.strokeStyle = 'rgba(217,194,122,.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(se) * (L - 10), by - Math.sin(se) * (L - 10)); ctx.stroke(); ctx.setLineDash([]);
    var recoil = g.reload > RELOAD - 0.4 ? (g.reload - (RELOAD - 0.4)) * 30 : 0;
    ctx.strokeStyle = '#8a8f6a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx - Math.cos(ce) * recoil, by + Math.sin(ce) * recoil);
    ctx.lineTo(bx + Math.cos(ce) * (L - 16 - recoil), by - Math.sin(ce) * (L - 16 - recoil)); ctx.stroke();
    ctx.fillStyle = '#4c5338'; ctx.beginPath(); ctx.arc(bx, by, 11, Math.PI, 0); ctx.fill();
    ctx.lineCap = 'butt';
    if (g.reload > RELOAD - 0.25) {
      ctx.fillStyle = 'rgba(255,190,80,' + ((g.reload - (RELOAD - 0.25)) * 4) + ')';
      ctx.beginPath(); ctx.arc(bx + Math.cos(ce) * (L - 6), by - Math.sin(ce) * (L - 6), 16, 0, 7); ctx.fill();
    }
  }

  // ==================================================================
  //                          ОБРАБОТЧИКИ
  // ==================================================================
  var ACTIONS = {
    campaign: function () { buildMissionList(); show('missions'); },
    skirmish: function () { startMission(M.skirmishDef(save.diff), null); },
    howto: function () { modal(HOWTO, [{ text: 'Понятно' }], true); },
    toMenu: function () { show('menu'); },
    pause: function () {
      modal('<h3>Пауза</h3><p class="dim">' + esc(G.def.name) + ' · ' + DIFF[G.diff].name + '</p>', [
        { text: 'Продолжить' },
        { text: 'Задача', ghost: true, fn: function () { modal('<h3>' + esc(G.def.name) + '</h3><p>' + G.def.brief + '</p>', [{ text: 'Закрыть' }], true); } },
        { text: 'Как играть', ghost: true, fn: ACTIONS.howto },
        { text: 'Выйти в меню', ghost: true, fn: toMenu }
      ], true);
    },
    speed: function () { G.speed = G.speed === 1 ? 4 : 1; $('speedBtn').textContent = '×' + G.speed; $('speedBtn').classList.toggle('on', G.speed > 1); },
    rings: function () { showRings = !showRings; $('ringsBtn').classList.toggle('on', showRings); },
    zoomIn: function () { zoomAt(1.5, mapC.clientWidth / 2, mapC.clientHeight / 2); },
    zoomOut: function () { zoomAt(1 / 1.5, mapC.clientWidth / 2, mapC.clientHeight / 2); },
    centerGun: function () { view.cx = G.m.gun.e; view.cy = G.m.gun.n; clampView(); },
    clearMarks: function () { G.marks = []; G.ruler = null; G.probe = null; setInfo(''); },
    editAz: function () { openKeypad('az'); },
    editEl: function () { openKeypad('el'); },
    fire: fire,
    plotMark: function () {
      var e = parseFloat($('plotE').value), n = parseFloat($('plotN').value);
      if (isNaN(e) || isNaN(n) || e < 0 || n < 0 || e > 12000 || n > 12000) { $('plotOut').innerHTML = '<div class="bad">Координаты должны быть в пределах 0…12 000.</div>'; return; }
      addMark(e, n); view.cx = e; view.cy = n; switchTab('map'); clampView();
    },
    plotFill: function () {
      var t = G.m.targets[G.active];
      if (!t || !t.reported) return;
      if (t.polar && G.diff > 0) { $('plotOut').innerHTML = '<div class="bad">Цель дана в полярных координатах от НП — пересчитайте: X = Xнп + Д·sin(A), Y = Yнп + Д·cos(A).</div>'; return; }
      $('plotE').value = Math.round(t.plot.e); $('plotN').value = Math.round(t.plot.n); updatePlot();
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act],[data-tab],[data-tool],[data-diff],[data-d],[data-k],[data-from]');
    if (!el || el.disabled) return;
    audio();
    var ds = el.dataset;
    if (ds.act) { if (ACTIONS[ds.act]) ACTIONS[ds.act](); }
    else if (ds.tab) switchTab(ds.tab);
    else if (ds.tool) { setTool(ds.tool); if (ds.tool === 'ruler' && G.diff === 2) setInfo('<span class="dim">На уровне «Ветеран» линейка не показывает дальность и азимут.</span>'); }
    else if (ds.diff) { save.diff = +ds.diff; persist(); refreshDiff(); }
    else if (ds.d) { var which = el.parentNode.dataset.target; if (which === 'az') setAz(G.gun.setAz + (+ds.d)); else setEl(G.gun.setEl + (+ds.d)); }
    else if (ds.k) kpKey(ds.k);
    else if (ds.from) { plotFrom = ds.from; qsa('#plotFrom button').forEach(function (b) { b.classList.toggle('on', b === el); }); updatePlot(); }
  });
  $('plotE').addEventListener('input', updatePlot);
  $('plotN').addEventListener('input', updatePlot);
  $('tblFind').addEventListener('input', findRow);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal') && modalDismiss) modalDismiss(); });
  window.addEventListener('resize', function () { resizeCanvases(); });

  window.onBackButton = function () {
    if (kpOpen) { closeKp(); return true; }
    if (modalOpen) { if (modalDismiss) modalDismiss(); return true; }
    if ($('game').classList.contains('active')) { ACTIONS.pause(); return true; }
    if ($('missions').classList.contains('active')) { show('menu'); return true; }
    return false;
  };
  window.onAppPause = function () { if (G && !G.over && !modalOpen && $('game').classList.contains('active')) ACTIONS.pause(); };

  // отладочный доступ для автотестов
  window.__arta = { state: function () { return G; }, start: startMission, view: view };

  buildCalc();
  refreshDiff();
  buildMissionList();
  requestAnimationFrame(tick);
})();
