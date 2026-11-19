// engine.input — касания и мышь (DESIGN §5.1).
//  * луч бросается только по интерактивным объектам ТЕКУЩЕГО поста (и «глобальным», вне постов);
//  * один активный указатель: второй палец игнорируется и не ломает перетаскивание — кроме пары, где один из двух
//    органов объявлен { multi: true } (гашетка зенитки: один палец ведёт прицел, второй давит огонь);
//  * касание (tap) = отпускание без заметного сдвига; свайп по пустому месту → событие 'swipe'.
import * as THREE from 'three';

const TAP_SLOP_TOUCH = 10, TAP_SLOP_MOUSE = 5, TAP_MAX_MS = 700;
const SWIPE_MIN_PX = 70, SWIPE_MAX_MS = 600;

export function createInput(engine, canvas) {
  const items = new Map();                     // object3D → { object, handlers, priority, enabled }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const _v = new THREE.Vector3();
  let active = null;                           // { id, item, startX, startY, lastX, lastY, t0, maxDist, type }
  let second = null;                           // второй палец на другом органе (см. opts.multi) — та же запись
  let hoverItem = null;

  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  canvas.style.webkitTapHighlightColor = 'transparent';

  function local(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width || 1, h: r.height || 1 };
  }
  function setRay(x, y, w, h) {
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    // кадр мог быть пропущен (рисование по требованию) — мировые матрицы освежаем перед лучом
    if (api._stale) { api._stale = false; engine.scene.updateMatrixWorld(); }
    engine.camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, engine.camera);
  }

  // объект участвует во вводе, если он видим и принадлежит текущему посту (или не принадлежит никакому)
  function usable(obj) {
    let station;
    for (let o = obj; o; o = o.parent) {
      if (!o.visible) return false;
      if (station === undefined && o.userData && o.userData.stationId !== undefined) station = o.userData.stationId;
      if (!o.parent && o !== engine.scene) return false;   // не в сцене
    }
    return station === undefined || station === engine.current;
  }
  function itemOf(obj) {
    for (let o = obj; o; o = o.parent) { const it = items.get(o); if (it) return it; }
    return null;
  }

  function pick() {
    const list = [];
    items.forEach(it => { if (it.enabled && usable(it.object)) list.push(it.object); });
    if (!list.length) return null;
    const hits = raycaster.intersectObjects(list, true);
    let best = null;
    for (const h of hits) {
      const it = itemOf(h.object);
      if (!it || !it.enabled) continue;
      if (!best || it.priority > best.item.priority) best = { item: it, hit: h };   // hits отсортированы по дальности
    }
    return best;
  }

  // время касания — по метке события (когда палец коснулся/отпустил экран), а не по моменту, когда до него дошёл JS: на
  // медленном телефоне долгий кадр между touchstart и touchend не должен превращать быстрое касание в долгое нажатие
  const evTime = (ev) => { const now = performance.now(), t = ev && ev.timeStamp; return t > 0 && t <= now + 1 && t > now - 10000 ? t : now; };
  function makeEvent(ev, p, withPoint, a = active) {
    const e = {
      x: p.x, y: p.y,
      dx: a ? p.x - a.lastX : 0, dy: a ? p.y - a.lastY : 0,
      startX: a ? a.startX : p.x, startY: a ? a.startY : p.y,
      totalDx: a ? p.x - a.startX : 0, totalDy: a ? p.y - a.startY : 0,
      dragging: a ? a.dragging : false,
      duration: a ? Math.max(0, evTime(ev) - a.t0) : 0,
      pointerType: ev.pointerType || 'mouse',
      ray: raycaster.ray.clone(),
      point: null,
      object: a && a.item ? a.item.object : null,
      cancelled: false,
    };
    if (withPoint && a && a.item) {
      const h = raycaster.intersectObject(a.item.object, true)[0];
      if (h) e.point = h.point.clone();
    }
    return e;
  }

  function call(item, name, e) {
    const fn = item && item.handlers[name];
    if (!fn) return;
    try { fn(e); } catch (err) { console.error('[engine.input] ошибка в ' + name + ':', err); }
  }

  function onDown(ev) {
    if (active) { secondDown(ev); return; }              // второй палец не мешает первому
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const p = local(ev);
    setRay(p.x, p.y, p.w, p.h);
    let found = null;
    if (api.enabled && !engine.flying) found = pick();
    active = {
      id: ev.pointerId, item: found ? found.item : null, type: ev.pointerType || 'mouse',
      startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, t0: evTime(ev), maxDist: 0, dragging: false,
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* не критично */ }
    if (ev.cancelable) ev.preventDefault();
    if (found) {
      const e = makeEvent(ev, p, false);
      e.point = found.hit.point.clone();
      call(found.item, 'onDown', e);
    }
  }

  // второй палец: принимается, только если попал в ДРУГОЙ орган и хотя бы один из двух органов — multi
  function secondDown(ev) {
    if (second || ev.pointerId === active.id || ev.pointerType === 'mouse' || !api.enabled || engine.flying) return;
    const p = local(ev);
    setRay(p.x, p.y, p.w, p.h);
    const found = pick();
    if (!found || found.item === active.item || !(found.item.multi || (active.item && active.item.multi))) return;
    second = {
      id: ev.pointerId, item: found.item, type: ev.pointerType || 'touch',
      startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, t0: evTime(ev), maxDist: 0, dragging: false,
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* не критично */ }
    if (ev.cancelable) ev.preventDefault();
    const e = makeEvent(ev, p, false, second);
    e.point = found.hit.point.clone();
    call(found.item, 'onDown', e);
  }
  function track(a, ev, p) {
    setRay(p.x, p.y, p.w, p.h);
    const dist = Math.hypot(p.x - a.startX, p.y - a.startY);
    if (dist > a.maxDist) a.maxDist = dist;
    if (!a.dragging && dist > (a.type === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH)) a.dragging = true;
    if (a.item) call(a.item, 'onDrag', makeEvent(ev, p, true, a));
    a.lastX = p.x; a.lastY = p.y;
  }

  function onMove(ev) {
    const p = local(ev);
    if (second && ev.pointerId === second.id) { track(second, ev, p); return; }
    if (!active) {
      if (ev.pointerType === 'mouse' && api.enabled) {     // курсор-подсказка на ПК
        setRay(p.x, p.y, p.w, p.h);
        const f = engine.flying ? null : pick();
        const it = f ? f.item : null;
        if (it !== hoverItem) { hoverItem = it; canvas.style.cursor = it ? 'pointer' : ''; }
      }
      return;
    }
    if (ev.pointerId !== active.id) return;
    track(active, ev, p);
  }

  function finish(ev, cancelled) {
    const isSecond = !!second && ev.pointerId === second.id;
    if (!isSecond && (!active || ev.pointerId !== active.id)) return;
    const p = local(ev);
    setRay(p.x, p.y, p.w, p.h);
    const a = isSecond ? second : active;
    const e = makeEvent(ev, p, true, a);
    e.cancelled = cancelled;
    if (isSecond) second = null;
    else { active = second; second = null; }             // первый палец ушёл — второй становится основным
    try { if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* не критично */ }
    if (a.item) {
      call(a.item, 'onUp', e);
      if (!cancelled && !a.dragging && e.duration < TAP_MAX_MS && items.has(a.item.object)) call(a.item, 'onTap', e);
    } else if (!cancelled && api.enabled && !isSecond) {
      const dx = e.totalDx, dy = e.totalDy;
      if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.6 && e.duration < SWIPE_MAX_MS) {
        engine.emit('swipe', dx < 0 ? 1 : -1);          // палец влево → следующий пост (+1)
      }
    }
  }

  // страховка: окно потеряло фокус посреди жеста — завершаем его как отменённый
  function cancelActive() {
    const list = [active, second];
    active = null; second = null;
    for (const a of list) if (a && a.item) {
      call(a.item, 'onUp', {
        x: a.lastX, y: a.lastY, dx: 0, dy: 0, startX: a.startX, startY: a.startY, totalDx: a.lastX - a.startX, totalDy: a.lastY - a.startY,
        dragging: a.dragging, duration: performance.now() - a.t0, pointerType: a.type, ray: raycaster.ray.clone(), point: null,
        object: a.item.object, cancelled: true,
      });
    }
  }
  window.addEventListener('blur', cancelActive);

  const onUp = ev => finish(ev, false);
  const onCancel = ev => finish(ev, true);
  const onCtx = ev => ev.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);
  canvas.addEventListener('contextmenu', onCtx);

  const api = {
    /** Глобальный выключатель ввода (например, пока открыто меню). */
    enabled: true,

    /**
     * Сделать объект интерактивным. handlers: { onTap(e), onDown(e), onDrag(e), onUp(e) }.
     * opts: { priority=0, multi=false } — при пересечении нескольких объектов побеждает больший приоритет, затем ближний;
     * multi — орган можно нажать вторым пальцем, пока первый держит другой орган (и наоборот).
     * → remove(); у функции есть поле .item ({ enabled, priority }) для временного отключения.
     */
    add(object, handlers = {}, opts = {}) {
      const item = { object, handlers, priority: opts.priority || 0, multi: !!opts.multi, enabled: true };
      items.set(object, item);
      const remove = () => { if (items.get(object) === item) items.delete(object); if (active && active.item === item) active.item = null; if (second && second.item === item) second = null; };
      remove.item = item;
      return remove;
    },

    /** Пересечение луча события с плоскостью (нормаль и точка — в мировых координатах). */
    planePoint(e, planeNormalWorld, planePointWorld) {
      const n = _v.copy(planeNormalWorld).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, planePointWorld);
      return e.ray.intersectPlane(plane, new THREE.Vector3());
    },

    /** Мировая точка → экранные координаты холста (CSS px). */
    toScreen(world, out = {}) {
      const r = canvas.getBoundingClientRect();
      engine.camera.updateMatrixWorld();
      _v.copy(world).project(engine.camera);
      out.x = (_v.x + 1) / 2 * (r.width || 1);
      out.y = (1 - _v.y) / 2 * (r.height || 1);
      out.behind = _v.z > 1;
      return out;
    },

    /** Принудительно завершить текущий жест (например, при открытии меню поверх сцены). */
    cancel: cancelActive,

    /** Идёт ли сейчас перетаскивание какого-либо органа. */
    get busy() { return !!((active && active.item) || second); },

    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('blur', cancelActive);
      items.clear(); active = null; second = null;
    },
  };
  return api;
}
