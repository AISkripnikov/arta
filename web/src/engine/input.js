// engine.input — касания и мышь (DESIGN §5.1).
//  * луч бросается только по интерактивным объектам ТЕКУЩЕГО поста (и «глобальным», вне постов);
//  * один активный указатель: второй палец игнорируется и не ломает перетаскивание;
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

  function makeEvent(ev, p, withPoint) {
    const a = active;
    const e = {
      x: p.x, y: p.y,
      dx: a ? p.x - a.lastX : 0, dy: a ? p.y - a.lastY : 0,
      startX: a ? a.startX : p.x, startY: a ? a.startY : p.y,
      totalDx: a ? p.x - a.startX : 0, totalDy: a ? p.y - a.startY : 0,
      dragging: a ? a.dragging : false,
      duration: a ? performance.now() - a.t0 : 0,
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
    if (active) return;                                  // второй палец не мешает первому
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const p = local(ev);
    setRay(p.x, p.y, p.w, p.h);
    let found = null;
    if (api.enabled && !engine.flying) found = pick();
    active = {
      id: ev.pointerId, item: found ? found.item : null, type: ev.pointerType || 'mouse',
      startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, t0: performance.now(), maxDist: 0, dragging: false,
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* не критично */ }
    if (ev.cancelable) ev.preventDefault();
    if (found) {
      const e = makeEvent(ev, p, false);
      e.point = found.hit.point.clone();
      call(found.item, 'onDown', e);
    }
  }

  function onMove(ev) {
    const p = local(ev);
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
    setRay(p.x, p.y, p.w, p.h);
    const dist = Math.hypot(p.x - active.startX, p.y - active.startY);
    if (dist > active.maxDist) active.maxDist = dist;
    if (!active.dragging && dist > (active.type === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH)) active.dragging = true;
    if (active.item) call(active.item, 'onDrag', makeEvent(ev, p, true));
    active.lastX = p.x; active.lastY = p.y;
  }

  function finish(ev, cancelled) {
    if (!active || ev.pointerId !== active.id) return;
    const p = local(ev);
    setRay(p.x, p.y, p.w, p.h);
    const a = active;
    const e = makeEvent(ev, p, true);
    e.cancelled = cancelled;
    active = null;
    try { if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId); } catch (err) { /* не критично */ }
    if (a.item) {
      call(a.item, 'onUp', e);
      if (!cancelled && !a.dragging && e.duration < TAP_MAX_MS && items.has(a.item.object)) call(a.item, 'onTap', e);
    } else if (!cancelled && api.enabled) {
      const dx = e.totalDx, dy = e.totalDy;
      if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.6 && e.duration < SWIPE_MAX_MS) {
        engine.emit('swipe', dx < 0 ? 1 : -1);          // палец влево → следующий пост (+1)
      }
    }
  }

  // страховка: окно потеряло фокус посреди жеста — завершаем его как отменённый
  function cancelActive() {
    if (!active) return;
    const a = active;
    active = null;
    if (a.item) {
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
     * opts: { priority=0 } — при пересечении нескольких объектов побеждает больший приоритет, затем ближний.
     * → remove(); у функции есть поле .item ({ enabled, priority }) для временного отключения.
     */
    add(object, handlers = {}, opts = {}) {
      const item = { object, handlers, priority: opts.priority || 0, enabled: true };
      items.set(object, item);
      const remove = () => { if (items.get(object) === item) items.delete(object); if (active && active.item === item) active.item = null; };
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
    get busy() { return !!(active && active.item); },

    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('blur', cancelActive);
      items.clear(); active = null;
    },
  };
  return api;
}
