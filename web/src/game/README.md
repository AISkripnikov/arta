# game/ — игровая логика (фактический API)

Чистый JS без DOM/THREE. Проверяется `cd web && npm test` (бот проходит все 30 заданий на обеих сложностях
по полной процедуре + отдельные тесты на каждое правило; ~30 с).
Единицы: **км**, **градусы** (пеленг 0° — север, по часовой), **секунды**. Карта 20×20 км, x — восток, y — север.

```js
import { createGame } from '../game/index.js';
const game = createGame({ storage: { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) } });
```

## Состояние `game.state` (только чтение; меняется методами)
```
phase: 'menu'|'briefing'|'playing'|'won'|'lost'     paused, speed (1|3), difficulty (0 «Курсант» | 1 «Командир»), time (с)
mission: { id, index|null, name, brief, tutorial, skirmish, battery:{x,y},
           survival: bool,                      // режим «ОБОРОНА»
           night: bool,                         // ночь (см. «Ночь»)
           weather: 'clear'|'fog'|'storm',      // погода (см. «Погода»)
           wind: { speed (м/с), from (° откуда дует) },   // в шторм и в обороне МЕНЯЕТСЯ по ходу боя (событие wind)
           areas: [{ targetId, x0, y0, x1, y1 }],         // ночные квадраты 2×2 км живых целей (для карты)
           map: { seed, coast:[y при x=0,0.25,…,20], coastStep:0.25, islands:[{x,y,rx,ry,rot,name}], battery,
                  posts:[{name:'ЗВ-1',x,y}, …] } }         // посты звукометрии ([] если их нет)
integrity: 0…100
shells: { he, ap, illum, smoke, shrap }       // всегда все пять ключей (чего нет в задании — 0)
shots                                          // выпущено снарядов всего (пара «вилки» = 2)
wave: 0 | 1…        // номер текущей волны в обороне (0 — не оборона)
kills               // уничтожено целей за бой (в обороне — за все волны)
targets[]: { id (1…, в обороне растут от волны к волне и не повторяются), label 'ЦЕЛЬ 1', name, kind, armored,
             hp, maxHp, radius, alive, escaped, moving, spotter, locate: 'recon'|'sound',
             reported: null | { x, y, course, speed (км/ч), time,        // ← показывать игроку ТОЛЬКО это
                                rough?: true,                            //   ночью «по вспышке»: x,y кратны 0.5 км
                                sound?: [{name,x,y,bearing}] (тогда x,y = null) },
             area: null | { x0, y0, x1, y1 },   // ночью: квадрат от штаба (может быть при reported === null!)
             lit: bool,                         // ночью: цель сейчас в свете осветительного снаряда
             active: bool,                      // цель уже «в игре» (объявлена штабом/разведкой или слышна)
             x, y, course, speed … }            // истинные значения — НЕ показывать (кроме разбора после боя)
activeTarget: id|null                           // ночью может указывать на цель без reported (есть только area)
plot: { pins: { [id]: {x,y} }, alidade: { bearing (0.1°), range (0.01 км) }, recorded: { [id]: { bearing, range, time } },
        pivot: 0…, lines: [{ from, x, y, bearing }] }
computer: { range, charge (1…6), elevation|null, tof|null, stale, windRange (км), windBearing (°) }
faults: { drive, hoist, lights }      repair: null | { kind, t, dur }
turret: { bearing (0.01°), brake, elevation (0.01°, −2…45) }
breech: { open, shell: null|'he'|'ap'|'illum'|'smoke'|'shrap', rammed, charges 0…6, busy: null | { kind, t, dur } }
        // busy.kind: 'open'|'close'|'hoist'|'ram'|'charge'|'uncharge'|'unload'|'auto'; прогресс = t/dur
fire: { armed, burst (1…3), burstLeft, salvo: bool }     // salvo — «ВИЛКА» включена
flight[]: { id, n, t, tof, shell, charges, x, y, bearing, elevation, pair: null | n напарника }   // снаряды в полёте
impacts[]: { n, x, y, time, shell, hit, targetId, snap, craters, land, pair }   // последние 40 разрывов
lights[]: { x, y, until, n }           // горящие осветительные снаряды (радиус света 1.5 км); погасшие удаляются
smokes[]: { x, y, bearing, until, n }  // дымовые завесы (bearing — пеленг с батареи, прикрывает ±25°); истёкшие удаляются
history[]: { n, time, shell, charges, bearing, elevation, x, y, hit, targetId, reportText, pair, impactTime }
           // ВСЕ выстрелы боя, не обрезается. n = индекс+1. Пока снаряд летит: x = y = null, hit = false.
           // pair — n второго снаряда «вилки» или null. targetId — поражённая цель, иначе цель, по которой шёл доклад.
tracks: { [targetId]: [{ t, x, y }] }  // ИСТИННЫЙ след цели: движущиеся — каждые ~10 с (+ точки поворота и гибели),
                                       // неподвижные — первая и последняя точки (+ переезды кочующей батареи)
radio[]: { time, from: 'ШТАБ'|'РАЗВЕДКА'|'КОРРЕКТИРОВЩИК'|'ЗВУКОМЕТРИЯ'|'МЕТЕО'|'РАСЧЁТ', text, kind: 'info'|'recon'|'report'|'good'|'bad' }
lastReport: null | { targetId|null, over (м, + перелёт), right (м, + вправо), text|null, time, observed,
                     bracket?: bool,    // «вилка»: цель между разрывами (over/right — середина пары)
                     dark?: bool,       // ночью цель не освещена — отклонение не наблюдалось (over = right = 0)
                     special?: 'illum'|'smoke' }   // доклад об осветительном/дымовом (over = right = 0, observed = false)
checklist: { measured, computed, loaded, traversed, elevated, armed }
```

## Действия → `{ ok:true, … }` | `{ ok:false, reason }` (+ событие `denied`)
| Метод | Примечания |
|---|---|
| `startMission(i)`, `startSkirmish()`, **`startSurvival()`**, `begin()`, `quit()`, `pause(b)`, `setSpeed(1|3)`, `setDifficulty(0|1)`, `setMuted(b)` | `start…` → фаза `briefing`; `begin()` → `playing` |
| `selectTarget(id)` | цели с донесением **или с ночным квадратом** (`t.reported || t.area`) |
| `setPin(id, x, y)` | округляет до 0.01 км; условие то же |
| `setAlidade({ bearing?, range? })` | пеленг до 0.1°, дальность до 0.01 км (0…25) |
| `pivots()`, `setPivot(i)`, `drawLine()`, `clearLines()` | ось алидады: 0 — батарея, 1… — посты звукометрии |
| `recordMeasurement()` | пишет показания алидады в `plot.recorded[activeTarget]`, событие `recorded` |
| `predict(id, tAhead=0)` → `{x,y}`\|null | прогноз по последнему донесению; если есть только квадрат — его центр и `area:true` |
| `setComputerRange(km)`, `setComputerCharge(n)` | меняют входы; если был расчёт — `stale = true` |
| `chargeStates()` → `['ok'|'out' ×6]` | какие заряды достают на текущей дальности вычислителя |
| `compute()` → `{ ok, elevation, tof, windRange, windBearing }` | при отказе `elevation = null`; сбрасывает `stale` |
| `windParts(bearing)` → `{ along, cross }`, `firingBearing()` | ветер вдоль/поперёк направления стрельбы |
| `setBrake(b)`, `rotateTurret(deltaDeg, {power}?)` | вращение отказывает при стопоре |
| `elevate(deltaDeg)` | при открытом затворе выше 3° не поднять |
| `openBreech()`, `closeBreech()`, `hoistShell(type)`, `ramShell()`, `addCharge()`, `removeCharge()`, `unload()` | `type` — любой из пяти; длительные операции: ставят `breech.busy`, по завершении — событие `breech` |
| `arm(b)`, `fire()` → `{ ok, tof, salvo }`, `fireReadiness()` → `{ shell, charge, breech, brake, armed }` | после выстрела затвор закрыт и пуст, цепь снята |
| `setBurst(1…3)` | очередь: расчёт сам перезаряжает и стреляет |
| **`setSalvo(bool)`** | «ВИЛКА» — см. ниже; `fire().salvo` говорит, ушла ли пара |
| `repair('drive'|'hoist'|'lights')` | длительность `state.repair.dur` |
| **`rank()`** → `{ index 0…5, name, xp, next (xp следующего звания | null), bonus (0…0.25) }` | звание расчёта |
| **`lit(x, y)`** → bool | точка сейчас освещена осветительным снарядом |
| **`smoked(targetId)`** → bool | батарея сейчас прикрыта дымом от огня этой цели |
| `shellPosition(flightItem)` → `{ f, x, y }` | где снаряд (вид сверху) |
| `solve(rangeKm, charge)`, `chargeRange(n)` → `{min,max}` | чистые функции |
| `isLand(x,y)`, `coastAt(x)` | для отрисовки карты |
| `fmt.km(v)` → `'07.55'`, `fmt.time(s)` → `'02:15'`, `fmt.brg(b)` → `'012.5°'` | |

Константы и справочники:
- `game.C = { LOAD_ANGLE: 3, EL_MIN: -2, EL_MAX: 45, CHARGES: 6, MAP: 20, RANGE_MIN: 0.01, RANGE_MAX: 22 }`
- **`game.SHELLS`** = `{ he:{name:'ОФ',title:'Фугасный',plural:'Фугасные'}, ap:{name:'ББ',title:'Бронебойный',…}, illum:{name:'ОСВ',title:'Осветительный',…}, smoke:{name:'ДЫМ',title:'Дымовой',…}, shrap:{name:'ШРП',title:'Шрапнель',plural:'Шрапнельные'} }` — порядок ключей = порядок показа.
- **`game.ranks`** = `[{name:'МАТРОС',xp:0},{name:'СТАРШИНА',xp:300},{name:'МИЧМАН',xp:800},{name:'ЛЕЙТЕНАНТ',xp:1600},{name:'КАПИТАН-ЛЕЙТЕНАНТ',xp:2800},{name:'КАПИТАН 3 РАНГА',xp:4500}]`
- `game.campaign` — 30 заданий `{ id, name, brief, shells, night?, weather?, wind?, targets, … }`: 0–7 часть I, 8–15 часть II, 16–23 часть III, **24–29 часть IV «НОЧЬ И ТУМАН»** (24 «Свет над водой» ночь; 25 «Конвой в тумане» туман; 26 «Штормовая дуэль» шторм+дым; 27 «Шрапнель» туман+шрапнель; 28 «Дуэль во тьме» ночь+дым+звукометрия; 29 «Ночь и туман» ночь+шторм, финал).
- `game.save` = `{ unlocked, stars[], records[], difficulty, muted, xp, survivalBest: null | { waves, kills } }`
- `game.difficulties` (`['Курсант','Командир']`), `game.FAULTS`.

## События `game.on(name, fn)` → функция отписки
`state` (после любого изменения; во время боя — практически каждый кадр), `phase (phase)`, `radio (msg)`,
`denied ({ action, reason })`, `recon (target)` (новое донесение о цели; ночью также когда цель вошла в свет/вышла из него — смотрите `target.lit`),
`recorded ({ targetId, bearing, range })`, `computed ({ elevation, tof })`, `breech (state.breech)`,
`fired ({ id, n, tof, shell, charges, salvo: bool, ids: [id снарядов в state.flight] })` — одно событие на залп, даже при «вилке»,
`impact ({ report, hits:[{ target, damage, destroyed }], x, y, shell, n, pair })` — **по событию на каждый снаряд**; у пары «вилки»
доклад (`report`) приложен только ко второму событию, у первого `report: null`,
`targetDestroyed (target)`, `incoming ({ by, eta })`, `batteryHit ({ damage, by, escape? })` (damage 0 — промах противника; `escape:true` — в обороне цель прорвалась, −25),
`fault ({ kind, fixed? })`,
**`area ({ targetId, x0, y0, x1, y1 })`** — ночью штаб дал/обновил квадрат цели,
**`light ({ x, y, until, n })`** — загорелся осветительный, **`smoke ({ x, y, bearing, until, n })`** — встала завеса,
**`wind ({ from, speed })`** — ветер сменился (шторм; новая волна обороны),
**`wave ({ wave, cleared })`** — оборона: `cleared:true` — волна отбита (пополнение уже выдано), `cleared:false` — пришла волна `wave`,
`missionEnd ({ won, stars, reason, stats:{ shots, combatShots, par, time, integrity, destroyed, total }, record,
  survival: null | { waves, kills, best:{waves,kills}, isNew, previous }, xpGained, rank: game.rank(), rankUp: bool,
  history: state.history, tracks: state.tracks })`.

`game.update(dtSeconds)` вызывать каждый кадр (сама учитывает паузу, фазу и ускорение времени).

## Правила новых возможностей

### 1. Типы снарядов
| Тип | Действие |
|---|---|
| `he` ОФ | небронированные: прямое (≤ radius) — 2, близкое (≤ 1.8·radius) — 1; броню не берёт |
| `ap` ББ | только прямое: броня — 2, без брони — 1 |
| `illum` ОСВ | урона нет. В точке падения на 60 с загорается свет: `state.lights`, радиус 1.5 км. Доклад `special:'illum'` |
| `smoke` ДЫМ | урона нет. Если лёг в **1–4 км от батареи** — завеса на 60 с (`state.smokes`): орудия противника, чей пеленг с батареи в пределах ±25° от пеленга завесы, попадают с вероятностью ×0.4. Лёг ближе/дальше — завесы нет, корректировщик скажет «слишком близко/далеко» |
| `shrap` ШРП | `kind === 'landing'` — уничтожается в пределах 3·radius; прочие небронированные — урон 1 только прямым попаданием; броню не берёт |

Осветительные и дымовые не помогают противнику пристреляться (обычный выстрел +0.04 к его точности) и не идут
в зачёт звёзд (`stats.combatShots` — только боевые; `stats.shots` — все). Конец боя «боезапас израсходован»
наступает, когда затвор пуст, в воздухе ничего нет и нечем навредить: нет ББ, а ОФ/ШРП либо нет, либо остались только бронированные цели.

### 2. Ночь (`mission.night`)
- Цели разведки (`locate:'recon'`) **не сообщаются автоматически**. В момент появления цели ШТАБ даёт квадрат 2×2 км
  по сетке, кратной 2 км («в квадрате X 10–12, Y 08–10»): `target.area`, запись в `mission.areas`, событие `area`.
  `target.reported` при этом `null`, но цель можно выбрать (`selectTarget`), поставить фишку и записать замер;
  `predict(id)` вернёт центр квадрата. Движущаяся цель, выйдя из квадрата неосвещённой, получает новый квадрат (радио + `area`).
- Цель в свете осветительного снаряда (`target.lit === true`): разведка сразу даёт точное донесение (`reported`, событие `recon`)
  и обновляет его как днём. Свет погас — `lit = false`, последнее донесение остаётся, но не обновляется.
- Цель выстрелила из своего орудия, не будучи освещённой и не имея точного донесения, — «ПО ВСПЫШКЕ»:
  `reported = { x, y (округлены до 0.5 км), course: 0, speed: 0, time, rough: true }`. Точное донесение (после света) заменяет грубое.
- Корректировщик ночью не видит отклонение от неосвещённой цели разведки: доклад `dark:true`, `observed:false`
  («цель не освещена…»). Попадания и уничтожение сообщаются всегда.
- Запись в `mission.areas` живёт, пока цель жива (в т.ч. после точного донесения — интерфейс может гасить квадрат,
  когда `reported && !reported.rough`). Скрытые батареи (`locate:'sound'`) работают как днём.

### 3. «ВИЛКА» (`setSalvo(true)` → `state.fire.salvo`)
`fire()` берёт из погреба второй снаряд того же типа и выпускает ДВА снаряда: точки падения сдвинуты на −0.15 и +0.15 км
вдоль пеленга башни от точки наводки (рассеивание у каждого своё, ветер действует, время полёта общее — падают одновременно).
`state.shots` растёт на 2, в `flight`/`impacts`/`history` — две записи, связанные полем `pair`.
Нет второго снаряда — выстрел одиночный, РАСЧЁТ сообщает по радио, `fire().salvo === false`.
Доклад один на пару: если цель между разрывами по дальности — «ЦЕЛЬ N: ВИЛКА! Цель между разрывами, вправо 120.»
(`lastReport.bracket = true`, `over`/`right` — отклонение середины пары); иначе обычный доклад по ближнему разрыву.
С очередью (`setBurst`) каждый выстрел очереди — пара.

### 4. Расчёт и звания
`save.xp` растёт в `missionEnd`: победа — `stars·100 + 20·destroyed` (кампания и свободный бой); оборона — `50·waves`.
Звание — по порогам `game.ranks`. Бонус: длительности всех операций затвора (`breech.busy.dur`) и ремонта (`repair.dur`)
умножаются на `1 − 0.05·rank.index`. В `missionEnd`: `xpGained`, `rank` (уже новое), `rankUp`.

### 5. «ОБОРОНА» (`startSurvival()` → брифинг → `begin()`)
`mission.survival = true`, `mission.index = null`, `state.wave = 1…`. Волна — 2–4 цели (с ростом волн — опаснее,
скрытые батареи с 3-й волны, ветер со 2-й; ночи и непогоды нет; посты звукометрии есть всегда).
Все цели волны мертвы (уничтожены или прорвались) → сразу +25 прочности (макс. 100), пополнение
+6 ОФ, +3 ББ, +1 ОСВ, +1 ДЫМ, +1 ШРП, радио, событие `wave {cleared:true}`; через 10 с — следующая волна:
мёртвые цели удаляются из `state.targets` (их фишки/замеры/линии тоже), новые получают новые id, `wave {cleared:false}`.
Ушедшая/высадившаяся/погрузившаяся цель стоит 25 прочности (`batteryHit {escape:true}`), бой не кончается.
Конец — только при прочности ≤ 0 (или если нечем стрелять): `missionEnd { won:false, survival:{ waves (отбито волн), kills, best, isNew } }`,
лучший результат — в `save.survivalBest`.

### 6. Погода (`mission.weather`)
- `'fog'`: донесения разведки вдвое реже, координаты в `reported` округлены до 0.1 км, отклонения корректировщика — до 50 м.
- `'storm'`: каждые 80–110 с ветер меняется (направление ±40°, скорость ±3 м/с, в пределах 2…14): `mission.wind` новый,
  радио МЕТЕО, событие `wind`; если на вычислителе было решение — `computer.stale = true` (нужно `compute()` заново, поправка пеленга тоже меняется).

### 7. Журнал боя
`state.history` и `state.tracks` (см. состояние) заполняются весь бой и приходят в `missionEnd` — по ним рисуется карта разбора.
`tracks` — истинные положения целей: во время боя игроку не показывать.

### 8. Вид из амбразуры — что для него есть в состоянии
`turret.bearing`, `mission.night`, `mission.weather`, `mission.wind`, `lights[]` (пеленг/дальность считать от `mission.battery`),
`smokes[]`, события `fired`, `impact {x,y,shell}`, `light`, `smoke`, `incoming`.
