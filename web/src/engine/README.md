# engine — движок «АРТА: Башня»

Реализация контракта из `docs/DESIGN.md` §4–§5: рендер (three.js), круглое помещение башни, камера с перелётами между
постами, ввод, материалы, синтезированный звук и все органы управления `engine.ui`.
Ниже — фактические сигнатуры. Всё, чего нет в DESIGN.md, помечено **(расш.)**.

```
engine/
  index.js        createEngine: рендерер, свет, окружение, камера, посты, кадр, события, отладка
  room.js         помещение (стена, настил, потолок, трубы, плафоны, вещи, наклейки) — не более 16 вызовов отрисовки
  materials.js    engine.mat
  input.js        engine.input
  audio.js        engine.audio
  fonts.js        Oswald (встроен), textures.js — canvas-текст/шум, geom.js — геометрические помощники
  controls/       engine.ui (panel, plate, handwheel, drumCounter, lamp, lever, slewLever, rotarySelector,
                  gauge, pushButton, toggle, cover, pipe, cageLamp, rivetRow, cable)
```

Стенд: `node build.mjs --dev gallery` → `.dev/gallery/index.html#<id>` (←/→ и свайп — посты, `D` — рамка зоны
управления, `M` — звук, `?debug` — плашка с к/с и числом вызовов отрисовки).
Тест взаимодействия: `node tools/itest.cjs`; снимки: `node tools/gshot.cjs <префикс> [--ids …] [--w --h --dpr]`;
замер кадра: `node tools/perf.cjs .dev/gallery` (стенд) или `node tools/perf.cjs <сборка игры> --dpr 1 --quality high,mid,low`
(полная игра в бою: мс/кадр, вызовы основного прохода и всех проходов по каждому посту — описание в шапке `tools/perf.cjs`).

## Минимальный пост

```js
import { createEngine } from './engine/index.js';

function createDemoStation({ engine, THREE, ui, mat, audio }) {
  const group = new THREE.Group();
  // корпус: тыл панели на z = 0, лицо на z = d; ставим лицом на z = 0
  const main = ui.panel({ w: 1.7, h: 0.8, d: 0.06 });
  main.object3D.position.set(0, 1.1, -0.06);
  group.add(main.object3D);

  let km = 8.4;
  main.add(ui.plate('ДАЛЬНОСТЬ', { size: 0.03 }), 0, 0.3);            // add(ctrl, x, y) — координаты на лице панели
  const counter = main.add(ui.drumCounter({ digits: 4, decimals: 2, unit: 'КМ', value: km }), 0, 0.18);
  const lamp = main.add(ui.lamp({ color: 'green', label: 'ГОТОВО' }), 0.4, 0.18);
  main.add(ui.handwheel({
    radius: 0.16,
    onTurn(d) { km = Math.max(0, km + d / (2 * Math.PI) * 0.5); counter.setValue(km); lamp.set(km > 10); },
  }), 0, -0.12);

  return {
    id: 'demo', title: 'ПРИМЕР', group,
    camera: { position: [0, 1.42, 1.25], target: [0, 1.08, 0], fov: 46 },   // можно опустить — это значения по умолчанию
    update(dt, time) {}, onEnter() { audio.clunk(); }, onLeave() {},
  };
}

const engine = await createEngine(document.getElementById('stage'), { debug: false });
const ctx = { engine, THREE: engine.THREE, ui: engine.ui, mat: engine.mat, audio: engine.audio, game: null };
engine.addStation(createDemoStation(ctx));
engine.on('swipe', dir => { /* оболочка: перейти к соседнему посту */ });
engine.start();
```

## createEngine(canvas, opts) → Promise<engine>

`opts`: `{ debug=false, maxPixelRatio=2, exposure=1.0, antialias=true }`. Ждёт загрузки Oswald (при неудаче — sans-serif).
Рендерер: ACES, sRGB. Свет — полусферический (холодное заполнение) + тёплый ключевой прожектор от плафона (идёт за текущим
постом, **единственный отбрасывает тень**) + тёплый плафон в центре потолка + холодный контровой сбоку. `scene.environment` —
процедурная PMREM-панорама помещения (день / ночь), интенсивность 0.55, поворачивается вместе с рамкой камеры.
Тени, постобработка и частицы зависят от уровня качества — раздел «Свет, тени, постобработка, эффекты» ниже.

| Член | Описание |
|---|---|
| `THREE, scene, camera, renderer, canvas` | как в DESIGN |
| `mat, ui, audio, input` | см. ниже |
| `addStation(station)` → station | Порядок добавления = порядок по кольцу (по часовой, вид сверху). Движок ставит `group` на кольцо (R = 2.6 м, шаг 45° — `ROOM.ring`, `ROOM.slots` = 8), пишет `station.index`, `station.angle`, `group.userData.stationId`. Первый добавленный пост — текущий. |
| `gotoStation(id, { instant })` → `Promise<boolean>` | **Сразу** (до перелёта): `onLeave()` прежнего → `current = id` → `onEnter()` нового → событие `'station'(id)`. Затем перелёт 0.7 с (+0.16 с за каждый лишний пост) по дуге вокруг центра помещения; по прилёте — событие `'arrive'(id)` **(расш.)**, Promise → `true` (`false`, если перелёт перебит другим). Повторный вызов для текущего поста возвращает основной вид (0.4 с). |
| `current` | id текущего поста. `station` — его объект, `stations`, `getStation(id)` **(расш.)** |
| `flying` **(расш.)** | `true`, пока идёт перелёт между постами. В это время органы на касания не реагируют (свайп работает). |
| `setCameraPose(pose\|null, seconds=0.5)` → Promise | Доп. вид в локальных координатах текущего поста: `{ position, target, fov }`, любое поле можно опустить. `null` — основной вид. |
| `onFrame(fn)` → `off()` | `fn(dt, time)` каждый кадр; `dt` ограничен 0.05 с. |
| `on(name, fn)` → `off()`, `off(name, fn)`, `emit(name, …)` | События: `'station'(id)`, `'swipe'(dir)`, `'arrive'(id)`, `'resize'(w, h)`. |
| `start()` / `stop()` | Цикл кадров. Первый `start()` «входит» в текущий пост (onEnter + `'station'`), если этого ещё не сделал `gotoStation`. |
| `fx` **(расш.)** | Эффекты: `shake, flash, flicker, dust, puff, sparks, clear` — раздел «Свет, тени, постобработка, эффекты». |
| `post`, `setNight(on, amount)`, `shadowsDirty()`, `flagShadows(obj)` **(расш.)** | Там же. |
| `shake(amount=1, seconds=0.6)` | Тряска камеры; заодно мигают лампы помещения. `amount` 1 ≈ выстрел. При `engine.settings.shake === false` (настройка игрока) камера не двигается, лампы мигают. |
| `room` **(расш.)** | `{ group, setLampLevel(0..1), flicker(amount, seconds), lampLevel }` |
| `lights` **(расш.)** | `{ hemi, key (SpotLight с тенью), fillCeil, fillCool (он же rim — контровой; им же светит `fx.flash`) }` — цвет и силу ведёт движок (день/ночь, мигание), новые источники не добавлять. |
| `stationToWorld(id, [x,y,z])` **(расш.)** | Точка из локальных координат поста в мировые. |
| `geom`, `textures`, `fonts` **(расш.)** | Помощники: `geom.slab/lathe/extrude/merge/boxUV/pipeGeometry/hitBox/hitCylinder…`, `textures.canvasTexture/drawLabel/measureLabel/textTexture…`, `fonts.loaded/capRatio`. |
| `debug` **(расш.)** | `stats()` → `{ calls, triangles, frameMs, fps, geometries, textures, programs, tier, auto, autoTier, autoMs, autoUps, autoDowns, shadowCalls, shadowUpdates, postCalls, postPasses, particles }` (`calls` — только основной проход: без теней и без постобработки; `tier` — действующий уровень качества, для счётчика кадров); `step(dt, render=true)` — кадр вручную; `autoFeed(ms, count, cpuMs)` — подать «АВТО» интервалы кадров вручную (для `tools/test-quality.cjs`); `guides(show)` — рамка зоны управления и габарита у текущего поста. |
| `dispose()` **(расш.)** | Снять обработчики, освободить ресурсы. |

Правила для постов:
- `update(dt, time)` вызывается только для **видимых** постов (текущий и два соседних); скрытые не обновляются.
- Камера: если экран уже 16:9, вертикальный угол автоматически увеличивается, чтобы ширина кадра не уменьшалась.
- Декор стены занимает до ~0.1 м от стены: в секторе поста безопасно `z ≥ −0.85`. Плафоны и стояки стоят в простенках (±22.5° от оси поста).
- Посты не добавляют источников света; лампы — `ui.lamp` / `ui.cageLamp` / `mat.emissive`.

## engine.input

```js
const remove = engine.input.add(object3D, { onTap(e), onDown(e), onDrag(e), onUp(e) }, { priority: 0 });
engine.input.planePoint(e, planeNormalWorld, planePointWorld) → Vector3 | null
engine.input.toScreen(worldVec3) → { x, y, behind }      // (расш.) CSS px холста
engine.input.enabled = false                              // (расш.) глобально отключить ввод (меню)
engine.input.busy                                         // (расш.) идёт перетаскивание органа
engine.input.cancel()                                     // (расш.) принудительно завершить текущий жест
```
`e = { x, y, dx, dy, ray, point, object }` + **(расш.)** `startX, startY, totalDx, totalDy, dragging, duration (мс), pointerType, cancelled`.
- `point` — точка попадания в объект (мировая); при перетаскивании за пределами объекта — `null`.
- Луч бросается только по зарегистрированным объектам **текущего** поста (и объектам вне постов); учитывается `visible` всей цепочки родителей. Объект может быть группой — ловятся все её меши; годятся невидимые объёмы `geom.hitBox()/hitCylinder()`.
- `onDrag` приходит на каждое движение; `e.dragging` становится `true` после сдвига на 10 px (мышь — 5 px). `onTap` — при отпускании без такого сдвига и быстрее 0.7 с. Порядок: `onDown` → `onDrag…` → `onUp` → `onTap`.
- Один активный указатель: второй палец игнорируется — кроме случая, когда он попал в другой орган и один из двух органов добавлен с `{ multi: true }` (гашетка зенитки: один палец ведёт прицел, второй давит огонь). `pointercancel` → `onUp` с `e.cancelled = true`.
- `priority` **(расш.)**: из пересечённых объектов берётся больший приоритет, затем ближний (так крышка перекрывает тумблер).
- Свайп: по пустому месту, > 70 px по горизонтали, быстрее 0.6 с → `'swipe'(dir)`; **палец влево → `dir = +1`** (следующий по кольцу пост), вправо → `−1`. Жест, начатый на органе, свайпом не считается.

## engine.mat

Свойства (не функции): `steel`, `darkSteel`, `nickel`, `bakelite`, `ivory`, `copper`, `rubber`, `glass`, `ochre`, `floor`, `wall`,
**(расш.)** `brass`, `greased`, `knurled`.
Функции: `paint(hex='#3d4a57', { wear=0.5 })`, `emissive(hex, intensity=1)`. Одинаковые вызовы возвращают один объект.
Цвет — hex-строка, число или имя (`'green'|'red'|'amber'|'white'|'ochre'|'black'|'ivory'|'steel'|'panel'`).

**Процедурные текстуры** (всё в коде, без файлов; `materials.js`, генераторы — там же). Четыре общих набора, повтор — `mat.WEAR_REPEAT` м:

| набор | содержимое | high / mid / low |
|---|---|---|
| `paint` | RGBA-«пачка» данных: R — оттенок и выгорание краски (0.8 = ×1), G — блеск, B — поле ржавчины и потёков, A — поле износа (сколы, царапины) + карта нормалей (шагрень краски, вмятины листа, края сколов, риски) | 1024 / 512 / 256 |
| `floor` | цвет (sRGB) + блеск в A: вытертые до металла вершины рифления, ржавчина в низинах, масляные пятна, швы листов + нормали | 512 / 256 / 128 |
| `metal` | R — затенение (`aoMap`), G — шероховатость (`roughnessMap`), B — металличность (`metalnessMap`): штрихи шлифовки (на телах вращения — кольца проточки), отпечатки пальцев, побежалость + нормали-микрориски | 512 / 256 / 128 |
| `knurl` | нормали ромбической накатки (16 на повтор) | 256 / 256 / 128 |

Наборы создаются заглушками 4×4 и наполняются **в первом кадре движка** под действующий уровень (`engine.quality.tier`;
подключает `room.js` через `mat.bind(engine)`); смена уровня перегенерирует наборы по одному за кадр. Мелкие карты нормалей
(`mat.setDetail`): high — все, mid — без крашеных поверхностей (они занимают почти весь экран), low — ни одной; износ, ржавчина и
шероховатость остаются на всех уровнях. На этой машине первый
кадр тратит на генерацию ≈ 0.2–0.4 с (high), память — 16.3 МБ (high), 4.3 МБ (mid), 1.1 МБ (low); `mat.stats()` →
`{ tier, startMs, genMs, sets, bytes, mb }`. Атлас наклеек помещения — ещё 2.8 МБ.

- `paint`, `wall` — `MeshPhongMaterial` (крашеные поверхности занимают почти весь экран: Phong примерно вдвое дешевле по
  заливке, карты окружения у них нет). Шейдер износа: скол до голой стали с тёмной кромкой, ржавчина и потёки, грязь у
  настила (мировая высота < 0.6 м) и затемнение под потолком. Порог скола и ржавчины задаёт `wear` — три ступени (<0.34,
  <0.7, выше; одна текстура на все). Геометрии нужны UV «в метрах»: `engine.geom.boxUV(geometry, mat.WEAR_REPEAT)`.
- `ochre` — `MeshStandardMaterial` с тем же износом (редкие сколы до стали — металл в сколе отражает окружение).
- Металлы, бакелит, стекло — `MeshStandardMaterial` с картами набора `metal` (шероховатость, металличность, затенение,
  нормали). UV не обязательны (без них — ровная поверхность). `emissive` — `MeshBasicMaterial`.
- **(расш.)** `brass` — латунь, только мелкие детали орудия (обтюратор, кольца, переговорная труба); оправы приборов — никель (§3).
  `greased` — тёмная сталь в смазке, влажный блеск (затвор, направляющие). `knurled` — бакелит с накаткой (рукоятки маховиков
  и рычагов, ручки галетников; UV тел вращения: u — по окружности).
- **(расш.)** `applyWear(material, { wear=0.5, rust=1, grime=0.35, normalScale=0.45 })` — тот же износ на своём Phong/Standard-материале
  (занимает слот `specularMap` у Phong или `roughnessMap` у Standard). `textures` — `{ paint:{pack,normal}, floor:{pack,normal},
  metal:{pack,normal}, knurl:{normal} }` для своих материалов (например побежалость казённика: `roughnessMap: mat.textures.metal.pack`).
- **(расш.)** `bulbLens(hex, on)` — линза лампы с колбой и нитью накала: горящая — `emissiveMap` (центр и спираль ×2.3, светится
  постобработкой), погашенная — тёмное стекло с нитью. Нужны плоские UV линзы (`ui.lamp` делает их сам). `lens(hex, on)` — прежняя,
  без текстур, для любой геометрии.
- **(расш.)** `PALETTE` (цвета §3 + `brass`, `rust`), `glowTexture`, `glowSprite(hex, opacity)`, `memo(key, make)`, `realize(tier)`, `bind(engine)`, `stats()`.

**Помещение** (`room.js`): все ореолы плафонов — один меш-«билборд» (1 вызов вместо 9 спрайтов), все наклейки — один меш с атласом
1024×512 (`MeshLambertMaterial`, прозрачный, тень не принимает): трафареты «НЕ КУРИТЬ!», «ПЕРЕГОВОРНАЯ ТРУБА», «ЗИП», «380 В»,
дверца аптечки, жёлто-чёрные полосы на цоколе, мягкие контактные тени на стене за каждым пультом, на настиле под ним и вдоль
стыка стены с настилом. В простенках: аптечка, каска на крюке, переговорная труба с заглушкой на цепочке, стеллаж ЗИП (ключи, ломик),
жгуты кабелей вдоль кабель-канала — всё слито в общие меши помещения (0 новых вызовов). Вещи висят не дальше 0.13 м от стены
и не выше ~1.7 м, в простенках (±8° от середины между постами) — пультов не касаются.

## engine.ui

Все фабрики возвращают объект с `object3D`, **(расш.)** `enabled` (false — орган не реагирует) и `dispose()`.
Элемент «смотрит» в `+Z`, начало координат — центр основания на панели. Методы `set(...)` событий **не вызывают**
(для синхронизации с `game.state`); события приходят только от действий игрока. Размеры — в метрах.
Подписи (`label`, `labels`, `plate`) рисуются ПРОПИСНЫМИ; `size`/`labelSize` — высота прописной буквы (0.024–0.026 м ≈ 9 px на экране).

| Фабрика | Параметры (умолчания) | API |
|---|---|---|
| `panel(o)` | `w=1, h=0.6, d=0.05, color='#3d4a57', rivets=true\|false\|шаг, bevel=0.012`, расш.: `radius, wear, material`. Тыл на z=0, лицо на z=d. | `w, h, d`, **`add(child, x, y, rotZ)`** — поставить орган/Object3D на лицо панели (расш.) |
| `plate(text, o)` | `w, h` (по тексту), `style='black'\|'ivory'\|'red'\|'ochre'`, `size=0.026`, расш.: `screws=true, weight` | `setText(t)`, `text, w, h` |
| `handwheel(o)` | `radius=0.16, spokes=4, color` (охра), `knob=true, onTurn(deltaRad), onStart(), onEnd()`, расш.: `standoff, knobAngle=135, tickAngle=15°` | `angle`, `spin(deltaRad)`, расш.: `turning, radius, wheel`, `hold()` |
| `drumCounter(o)` | `digits=4` (всего разрядов, включая дробные), `decimals=0, unit, digitH=0.05, signed=false`, расш.: `value, wrap` (напр. 360), `label, labelSize, sound` | `setValue(v, {instant})`, `value`, расш.: `shown, w, h` |
| `lamp(o)` | `color='green', radius=0.022, label`, расш.: `labelSize, state` | `set(false\|true\|'blink')`, `state` |
| `lever(o)` | `length=0.22, color` (рукоять; по умолч. бакелит), `mode='momentary'\|'toggle', labels, onPull(), onChange(on)`, расш.: `on, labelSide='right'\|'left'\|'ends', labelSize` | `set(on)`, `on`, расш.: `travel` (0 верх … 1 низ), `handle` |
| `slewLever(o)` | `length=0.2, onInput(v)`, расш.: `labels=['ВЛЕВО','ВПРАВО']\|false, deadZone=0.08` | `value`, расш.: `held, position, handle` |
| `rotarySelector(o)` | `positions=6, labels, radius=0.045, value=0, onChange(i)`, расш.: `step` (°), `labelSize` | `set(i)`, `value`, расш.: `positions, labelPoint(i)` |
| `gauge(o)` | `radius=0.09, min=0, max=100, label, unit, zones:[{from,to,color}], majorStep, minorStep`, расш.: `sweep=270, start, wrap, caption, value, numbers, damping, speed` | `setValue(v, {instant})`, `setBug(v\|null)`, расш.: `value, shown` |
| `pushButton(o)` | `radius=0.03, color='black', label, onPress(n), hold=false`, расш.: `labelPos='bottom'\|'top'\|'none', labelSize, lit` | `setLit(b)`, расш.: `lit, pressed` |
| `toggle(o)` | `labels:[a,b], value=0, onChange(i)`, расш.: `orient='v'\|'h', size=1, labelSize` | `set(i)`, `value` |
| `cover(o)` | `w=0.1, h=0.13, onChange(open)`, расш.: `depth=0.1, open, label, guards:[органы]` | `open`, `set(b)`, расш.: `guard(ctrl), lid` |
| `pipe(points, radius=0.02, material=mat.copper, o)` | ломаная `[[x,y,z],…]` со скруглёнными коленами; `o: { flanges=true, bend }` | `object3D` |
| `cable(points, o)` | `radius=0.008, sag=0, material=mat.rubber` | `object3D` |
| `rivetRow(from, to, o)` | `count \| spacing=0.06, radius=0.007, material=mat.steel` | `object3D` |
| `cageLamp(o)` | `color='white', scale=1, on=true` | `set(on)`, `on` |

**`engine.settings = { sens: 1, invert: false, shake: true }`** — настройки игрока, которые читают органы управления (оболочка пишет сюда значение из
`game.settings()`). `sens` (0.6…1.6): `handwheel` умножает на него `delta` в `onTurn` и накопленный `angle` (рукоятка при этом
по-прежнему идёт за пальцем 1:1), `slewLever` — ход пальца до полного отклонения. Свои «площадки» перетаскивания на постах
(труба наблюдения, зенитка и т.п.) должны умножать сдвиг на `engine.settings.sens` сами. При `sens = 1` поведение прежнее.
`invert` (bool, «инверсия маховиков»): `handwheel` меняет знак `delta` в `onTurn` (рукоятка идёт за пальцем как раньше).
`shake` (bool, «тряска камеры при выстреле»): `false` — `engine.shake()` камеру не трогает. Свои эффекты, качающие камеру,
должны читать этот флаг сами.

**Настройки игрока в движке** (ставит оболочка из `game.settings()`, см. `web/src/ui/settings.js`):
- `engine.setQuality('auto'|'high'|'mid'|'low')` → `engine.quality = { tier, pixelRatio, rtScale, samples, shadow, postfx, bloom, grain, particles }`:

  | | high | mid | low |
  |---|---|---|---|
  | предел плотности пикселей `pixelRatio` | 2 | 1.5 | 1 |
  | масштаб текстур-видов `rtScale`, их MSAA `samples` | 1, 4 | 0.75, 4 | 0.5, 0 |
  | карта теней `shadow` (выборок PCF) | 1024 (9) | 512 (4, `shadowSoft: 0.9`) | нет |
  | постобработка `postfx` | свечение ½ + ¼ (`bloom: 2`), виньетка, коррекция, зерно | свечение ¼ (`bloom: 1`), виньетка, коррекция | нет: прямой вывод на экран, как раньше |
  | частицы `particles` | 1 (до 320 + 160) | 0.5 | 0 — `fx.dust/puff/sparks` ничего не создают |

  Шлёт событие `'quality'(q)`. Пост со своим `WebGLRenderTarget` создаёт его размером `база × engine.quality.rtScale` и по
  событию меняет размер (`rt.setSize`) — так сделаны смотровая щель (`fire-slit.js`) и окуляр трубы (`observe.js`).
  `'auto'` (настройка игрока по умолчанию): `engine.qualityAuto = true`, уровень подбирает движок; `engine.quality` всегда
  показывает уровень, действующий сейчас (`tier` — `'high'|'mid'|'low'`, не `'auto'`). Подбор: средний интервал между кадрами
  считается окнами по 1 с (интервал длиннее 3 с — пауза, не в счёт, 1–3 с считается за 1 с; свёрнутое приложение и первые 1.5–2 с после запуска и смены уровня не в счёт); четыре окна
  подряд медленнее ~24 мс (при «30 к/с» — 41 мс) — уровень на ступень ниже; 30 окон подряд не медленнее 18 мс и с временем
  логики кадра < 9 мс — **один раз за запуск** на ступень выше. Подобранный уровень хранится в `localStorage['arta2.autoTier']`
  и действует со следующего запуска. Повторный `setQuality('auto')` подбор не сбрасывает. Любое другое значение ставит
  `qualityAuto = false`. **В headless Chromium на SwiftShader кадр идёт сотни миллисекунд — «АВТО» за ~8 с уходит в `mid`, ещё
  через ~8 с в `low`; для снимков и туров ставьте уровень явно** (`game.setSetting('quality', 'high')` / `engine.setQuality('high')`;
  `tools/tour.cjs` ставит `--quality high` сам). Подбор проверяет `node tools/test-quality.cjs` (вниз — по настоящим кадрам, вверх — через
  `engine.debug.autoFeed`); `engine.debug.stats().autoTier` — уровень, который выбрал бы «АВТО».
  Стенды (`src/dev/harness.js`) настройки не применяют: там `'high'` и `qualityAuto = false`.
- `engine.setFrameCap(30|60|0)` — не чаще 30 кадров в секунду (лишние кадры пропускаются целиком, `dt` остаётся честным).
- `engine.guards.fire(proceed)` — перехватчик выстрела. Пост ОГОНЬ по спуску зовёт `engine.guards.fire(() => game.fire())`,
  если перехватчик задан, иначе `game.fire()` напрямую (стенды без оболочки). Оболочка либо сразу вызывает `proceed()`,
  либо сперва спрашивает игрока («СВОИ В ЗОНЕ. ОГОНЬ?»). Очередь и вилка идут внутри одного `game.fire()` — вопрос один.
- `engine.audio.setBus('fx'|'amb'|'radio'|'music', 0…2)` — громкость эффектов, фона башни, радио и музыки (см. `audio.js`);
  1 — «как записано»: оболочка ставит `volFx/100`, `volAmb/70`, `volRadio/100`, `volMusic/60`. `engine.audio.buses` →
  `{ fx, amb, radio, music }`; `engine.audio.busNode(name)` → `GainNode` шины (или `null`, пока звук не разбужен касанием).
  В шину `music` играет тема меню `engine.audio.music(on)` (молчит, пока включён фон башни — то есть в бою).

Поведение:
- **handwheel** — круговое движение пальца вокруг ступицы; угол считается в плоскости маховика (экран → плоскость, аффинно),
  ход 1:1, рукоятка идёт за пальцем. Внутри 0.3·R от ступицы — «вязкая» зона: проход пальца через центр не даёт скачка.
  `onTurn(delta)`: по часовой для игрока = `+`. `spin()` крутит визуально без события. `hold()` (звать из `onTurn`) отменяет последний шаг целиком — видимый поворот и `angle`:
  маховик на стопоре или упоре стоит при любой чувствительности и при инверсии (`spin(-delta)` для этого не годится).
- **drumCounter** — одометр: младший разряд катится плавно, старшие переносятся на последней десятой. `wrap: 360` — круговая
  величина (359.9 → 0.0 идёт через ноль). Значение обрезается диапазоном разрядов.
- **lever** — торчит к игроку, верх — исходное положение. `momentary`: `onPull()` один раз за протяжку ≥ 88 % хода, взводится
  снова после возврата; касание без протяжки только «качает» рычаг. `toggle`: низ = `on`; перетаскивание или касание.
  `labels: [верх, низ]` — сбоку от прорези; одна подпись (строка) — под основанием.
- **slewLever** — `onInput(v)` каждый кадр, пока рычаг удерживается (`v ∈ [−1, 1]`, вправо `+`, мёртвая зона ±0.08);
  при отпускании — один вызов `onInput(0)`, `value = 0`, рычаг возвращается пружиной.
- **rotarySelector** — круговое перетаскивание ручки (щелчки по фиксаторам), касание подписи — выбор, касание ручки —
  следующее положение по кругу.
- **gauge** — стрелка-пружина с лёгким перебросом и упорами шкалы. `sweep: 360, start: 0` — круговая шкала с нулём сверху
  (стрелка идёт кратчайшим путём). `label`/`unit` — мелкие надписи на циферблате; для читаемой на телефоне подписи — `caption`.
- **pushButton** — `onPress(n)` в момент нажатия (n = 0); при `hold: true` повторяется через 0.42 с, затем с ускорением до ~20/с.
- **toggle** — `orient 'v'`: `labels[0]` снизу (value 0), `labels[1]` сверху; `'h'`: слева/справа. Касание тумблера — переключить,
  касание подписи — выбрать её, перетаскивание — в сторону движения.
- **cover** — ставится в ту же точку, что и элемент под ней. Закрытая крышка перехватывает касания (приоритет) и отключает
  органы из `guards`. Касание — открыть/закрыть, перетаскивание вверх/вниз.

Затраты на отрисовку (вызовов): panel 1, plate 1, handwheel 4, drumCounter 4 (+1 с подписью), lamp 2–4, lever 4–6,
slewLever 4, rotarySelector 4, gauge 4–6, pushButton 2–4, toggle 2–4, cover 3–4.

## engine.audio

`tick()`, `ratchet()`, `clunk()`, `leverPull()`, `switchFlip()`, `buzz()`, `servo(level 0..1)`, `hoist()`, `ram()`, `breech()`,
`fire()`, `impactFar()`, `radio()`, `alarm(on)`, `ambient(on)`, `setMuted(b)`; **(расш.)** `setVolume(0..1)`, `muted`, `ready`,
`unlock()`, `suspend()`, `resume()`. Контекст создаётся при первом касании/клавише; до этого вызовы молча игнорируются
(`ambient(true)`/`alarm(true)` запоминаются и стартуют после разблокировки). Ни одна функция не бросает исключений.
`servo(level)` — непрерывный гул: вызывать каждый кадр или при изменении, `servo(0)` — затихает.
Органы сами издают звук: маховик — `ratchet`, рычаги — `leverPull`/`clunk`, тумблер и крышка — `switchFlip`, кнопки и галетник — `tick`.

**Устройство (расш.).** Код в `audio.js` + `audio/` (kit — синтез, catalogue — рецепты и таблица слоёв, bank — просчёт
в буферы через OfflineAudioContext в фоне после касания, loops — живые петли, ambience — фон, music — тема меню, space —
импульсные отклики). Тракт: голос → шина (`fx` с мягким компрессором, `amb`, `radio` — полоса «динамика», `music`) +
посылы в две свёрточные реверберации («стальная комната» 0.85 с, «открытое море» 3.2 с) → срез 22 Гц → громкость →
лимитер → мягкий ограничитель (потолок −1.9 дБ). Не больше 28 голосов; каждый звук сам освобождает узлы. Полный список
функций с аргументами — в комментариях `api` в `audio.js`; перечень для проверки — `CATALOGUE` там же.
Новые функции: `detent(pitch, vel)`, `gear(speed)`, `slew(level)`, `button`, `selector`, `cover`, `relay`, `drumTick`,
`bell(n)`, `paper`, `pin`, `loupe`, `hoistRun(on)`, `breechOpen/Close`, `charge`, `unload`, `shellWhoosh`,
`impact({ range, kind, pan, delay })`, `enemyGun({ range, pan })`, `whistle(dur, pan)`, `nearMiss`, `turretHit`, `fault`,
`radioMsg(cls, urgent)`, `squelch(open)`, `radioStatic(level)`, `aaFire(on, pan)`, `overheat`, `jam`,
`planeDrone(level, approach, pan)`, `flyby({ dur, from, to })`, `bombWhistle`, `bombBurst`, `sirenRun(on)`,
`ambience({ station, weather, night, tension })`, `tension(v)`, `creak/drip/foghorn/farThunder`, интерфейс (`uiTap`,
`dialogOpen/Close`, `toast`, `saveDone`, `hintNew`, `friendlyFire`, `detected`, `missionWon/Lost`, `rankUp`, `dailyRecord`),
`music(on)`, `play(name, o)`, `prerender()`, `debug()`. Проверка: `node tools/test-audio.cjs`.

## Свет, тени, постобработка, эффекты (расш.)

**Свет.** Четыре источника, все ведёт движок; посты света не добавляют. `lights.key` — прожектор из точки поста
`(−0.78, 2.32, 1.2)` в `(0.2, 1.02, −0.2)`: сверху-слева из-за спины игрока, тени падают вправо-вниз. Его сила идёт за лампами
помещения (`room.flicker`, `room.setLampLevel` — читается по `lights.fillCeil`), поэтому мигание и аварийный свет гасят и его.
`engine.setNight(on, amount=1)` — ночной бой: лампы краснеют за 0.8 с, карта окружения меняется на ночную (строится один раз,
при первом ночном бое), на уровнях с постобработкой кадр получает красную коррекцию силой `amount` (настройка «красный свет
ночью»: 1 / 0.5). Вызывает `web/src/ui/vfx.js`; он же прячет CSS-слой `#night`, пока `engine.post.active` (класс `body.gl-grade`),
— на уровне `low` красный фильтр по-прежнему даёт CSS.

**Тени.** Одна карта от ключевого света (PCF, сила тени 0.6 — подписи в тени остаются читаемыми), `autoUpdate = false`:
карта перерисовывается не чаще 15 раз в секунду и только если что-то сдвинулось. Движок сам сравнивает положения мешей
текущего поста, отбрасывающих тень, и света (контрольная сумма матриц) и следит за вводом (`engine.input.busy`).
`engine.shadowsDirty()` — попросить перерисовку вручную (например, спрятали целую группу: видимость дальних предков сумма не видит).
Флаги ставит движок при `addStation` и заново при каждом входе на пост (`engine.flagShadows(obj)` — вручную, если пост достроил
себя, не уходя с экрана):
- **принимает тень** каждый меш с освещаемым материалом (`MeshStandardMaterial`, `MeshPhongMaterial`, `MeshLambertMaterial`),
  не прозрачным (`transparent: false`). `MeshBasicMaterial` (лампы, `mat.emissive`, виды из щели и окуляра, объёмы касания),
  спрайты, линии и стекло тень не принимают и не отбрасывают;
- **отбрасывает тень** такой же меш, если радиус его габаритной сферы (с учётом собственного `scale`) ≥ 0.03 м и это не
  `InstancedMesh`: стрелки, винты и заклёпки тени не дают. Помещение (`room.group`) тень только принимает;
- отказ: `object3D.userData.noShadow = true` — всё поддерево не принимает и не отбрасывает; `userData.noCast = true` —
  поддерево только принимает; `userData.castShadow = true` на меше — отбрасывать, даже если он мельче 3 см.
- Подписи рисуйте неосвещаемым или освещаемым материалом как раньше: тень их затемняет не больше чем на ~⅓ итоговой яркости
  (есть ещё полусфера, плафон и контровой). Плоскость, обращённая к свету лицом, тени не даёт (в карту идут обратные грани).

**Постобработка** (`post.js`, только уровни с `quality.postfx`). Основной проход идёт в цель с MSAA (`quality.samples`; если
MSAA недоступен — FXAA в сводящем проходе) с тем же ACES и sRGB, что и прямой вывод: до обработки кадр совпадает с уровнем
`low` пиксель в пиксель, `toneMapped: false` у видов из щели и окуляра работает как раньше. Дальше 5–7 полноэкранных
проходов: яркие места → размытие в ½ и ¼ разрешения → сведение (свечение, вспышка, коррекция «холодные тени — тёплые света»,
ночь, виньетка, зерно). `engine.post`: `active`, `bloom` (множитель, 1), `threshold` (`[0.9, 1.0]`), `vignette` (0.28),
`grade` (1), `contrast` (0.1), `grain` (0.035), `night`, `info`. Пост может приглушить свечение у себя:
`station.post = { bloom: 0.5 }` (читается при входе на пост; без поля — 1).
- **Что светится.** Порог — по самой яркой составляющей цвета на экране: ниже 0.9 свечения нет, полная сила — у 1.0.
  Бумага, слоновая кость, охра и подписи под рабочим светом дают 0.6–0.85 и не светятся. Чтобы лампа или подсветка шкалы
  светилась, её цвет после тонального оператора должен упереться в предел: `mat.emissive(hex, intensity ≥ 2)` (в `MeshBasicMaterial`
  цвет умножается на `intensity`), `mat.lens(hex, true)` (emissiveIntensity 1.7 — светится) или у `MeshStandardMaterial`
  `emissive` + `emissiveIntensity ≥ 1.6`. Тусклая «погашенная» лампа (`emissiveIntensity ≤ 0.3`) не светится. Блики на
  никеле и стекле тоже могут дать искру — это задумано. Вид из щели и окуляр (`toneMapped: false`) светятся там, где небо
  ярче 0.9: если это мешает, приглушите `station.post.bloom`.

**Эффекты** `engine.fx` (`fx.js`). Точки и направления — **в координатах поста** `station` (по умолчанию текущего);
`world: true` — мировые; `screen: [x, y]` (−1…1, как NDC: `[0, 0]` — центр кадра, y вверх) и `depth` (м от камеры, по умолчанию 0.8) —
точка «в кадре», видна на любом посту и перед пультом. Внимание: точка за плоскостью пульта (z < 0 у поста) почти всегда
закрыта панелью, а края кадра закрыты оболочкой — видимый кадр при 844×390: `screen` y от −0.7 до 0.78, x до ±0.86. Эффект с `station`, который сейчас не текущий, не создаётся вовсе. Частицы — два `THREE.Points` с
заранее выделенными буферами (дым/пыль и искры), без выделений памяти за кадр; пока частиц нет — ноль вызовов отрисовки.

| Вызов | Что делает |
|---|---|
| `fx.shake(amount=0.4, seconds=0.5)` | Тряска камеры (1 ≈ близкий разрыв: 3 см и 1°). Учитывает `engine.settings.shake`. Лампы не трогает (в отличие от `engine.shake`). |
| `fx.flash({ color='#ffd9a0', intensity=1, dur=0.2, from='slit', station, screen=true })` | Вспышка света: `from: 'slit'` — из амбразуры над пультом, точка `(0, 1.82, −0.42)`; `'lamp'` — всплеск ключевого света; `[x,y,z]` — своя точка. Светит контровой источник (новых нет); `screen` — лёгкая засветка кадра на уровнях с постобработкой. Работает на всех уровнях. |
| `fx.flicker(amount=0.6, seconds=0.5)` | Мигание ламп помещения и ключевого света. |
| `fx.dust({ amount=1, station })` | Пыль с потолка над пультом (≈40 частиц на `amount` 1), оседает 2–4 с. |
| `fx.puff({ position \| screen+depth, kind='smoke'\|'breech'\|'steam', amount=1, dir, station })` | Клуб: пороховой дым из затвора (летит по `dir`, по умолчанию к игроку), струя пара (вверх), тёмный дым. |
| `fx.sparks({ position \| screen+depth, amount=1, dir, station })` | Сноп искр (≈18 на `amount` 1) с короткой вспышкой света; падают и гаснут за 0.3–0.9 с. |
| `fx.clear()`, `fx.particles` | Убрать все частицы; число живых частиц. |

Пост вызывает их прямо из своих обработчиков: `engine.fx.puff({ kind: 'steam', station: 'loading', position: [0.7, 0.5, 0.08] })` (перед пультом) или
`engine.fx.sparks({ station: 'traverse', screen: [0.72, -0.5], depth: 0.75 })`.
События боя (выстрел, попадание, отказ, зенитка, ночь) уже разведены в `web/src/ui/vfx.js` — не дублируйте их на постах.
