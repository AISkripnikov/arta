# game/ — игровая логика (фактический API, контракт для интерфейса)

Чистый JS без DOM/THREE. Проверяется `cd web && npm test` (~55 с): бот проходит все **36** заданий на обеих
сложностях по полной процедуре (с зениткой и своими в море) + отдельные тесты на каждое правило
(`test/game.test.js` — старые правила, `test/features.test.js` — восемь новых возможностей, `test/bot.js` — бот).
Единицы: **км**, **градусы** (пеленг 0° — север, по часовой), **секунды**. Карта 20×20 км, x — восток, y — север.

```js
import { createGame } from '../game/index.js';
const game = createGame({ storage: { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) } });
```

Посты после этой версии (порядок кольца/навигации): `plot, computer, loading, traverse, elevation, fire, observe, aa`.

## ГЛАВНЫЕ ЛОВУШКИ (прочтите сначала)

1. **`game.state` — один и тот же объект всегда**, но его поля-массивы и поля-объекты ЗАМЕНЯЮТСЯ целиком:
   при запуске задания (`start…`) и при `restore()` — все; по ходу боя — `targets` (оборона), `flight`, `lights`, `smokes`,
   `plot.lines` (после `clearLines`), `raid` (новый объект на каждый налёт), `mission.wind`. Не держите ссылок на
   `state.targets`, `state.raid.planes`, `state.crew` и т.п. между кадрами — читайте от `game.state` каждый раз.
   Объекты целей внутри боя живут долго (кроме обороны и `restore()`), но после `restore()` — все новые.
2. **Часто `null`**: `state.mission` (в меню), `state.raid` (нет налёта), `state.scope.last`, `state.lastReport`,
   `state.reportDue`, `target.reported`, `target.area`, `target.sinking`, `target.firedAt`, `friend.path`, `friend.sinking`,
   `breech.busy`, `breech.busy.arg`, `repair`, `save.daily`, `save.resume`, `mission.daily`, `mission.index`,
   `scope.last.dBearing/over/targetId` (разрыв виден, а целей рядом нет).
3. **Идентификаторы**: цели — числа `1…` (в обороне растут, не повторяются); свои — строки `'F1'…`; самолёты — числа
   `1…` (растут за бой, `state.raid.planes[i].id`); снаряды в полёте — `flight[i].id`, номер выстрела — `n`.
   `game.visible(id)` различает цель и своего по типу id (число / строка).
4. **Убитая цель не исчезает**: `alive = false`, `sinking = { since, dur: 18 }`, через 18 с `sunk = true` (объект `sinking`
   остаётся). Рисовать, пока `!sunk`. `escaped = true` (ушла/высадилась/погрузилась) — `sinking` нет, не рисовать.
   В обороне потопленные убираются из `targets` при приходе следующей волны, а ещё тонущие — когда дотонут.
5. **Доклад корректировщика приходит с задержкой** (3 с; улучшение и состояние радиста меняют). В событии `impact` поле
   `report` — это БУДУЩИЙ доклад (с полем `delay`); `state.lastReport` и строка в эфире появятся через `delay` секунд,
   тогда же событие `report`. Пока доклад в пути — `state.reportDue` (время прихода), иначе `null`.
   Попадания/уничтожения сообщаются сразу (радио + `impact.hits` + `targetDestroyed`).
6. **Скорости наводки при уставшем/раненом наводчике логика уменьшает сама**: `rotateTurret(d)` и `elevate(d)` делят `d`
   на `game.crewFactor('gunner')` (1 / 1.25 / 1.6). Интерфейсу НЕ нужно замедлять ещё раз — только показать состояние.
   Следствие: `rotateTurret(16)` может повернуть на 10°; «доехать до значения» — только в цикле по `state.turret`.
7. **`quit()` из идущего боя (`playing`) стирает сохранённый бой** (`save.resume`); из `briefing`/`won`/`lost` — не трогает. Выход с сохранением: `game.suspend(); game.quit({ keep: true })`.
8. `state.aa.firing` — это «гашетка нажата»; автомат реально стреляет только если `!jammed && ammo > 0`.
   При клине и пустой ленте `fireAA(true)` отказывает и сам снимает `firing`.
9. Истинные `x, y, course, speed` целей игроку не показывать, **кроме** оптики: то, для чего `game.visible(id) === true`,
   рисуется в трубе/амбразуре по истинному положению. Свои (`state.friends`) известны точно всегда — их на планшет.

## Состояние `game.state` (только чтение; меняется методами)
```
phase: 'menu'|'briefing'|'playing'|'won'|'lost'     paused, speed (1|3), difficulty (0 «Курсант» | 1 «Командир»), time (с)
mission: null | { id, index|null, name, brief, tutorial, skirmish, battery:{x,y},
           survival: bool,                      // режим «ОБОРОНА»
           daily: null | 'YYYY-MM-DD',          // задание дня;  title: null | 'ЗАДАНИЕ ДНЯ · 18.11'
           convoy: bool,                        // в задании есть корабли конвоя (свои условия победы)
           noSpotter: bool,                     // корректировщика нет: об отклонениях — только свой глаз (труба)
           raids: [{ at (с), planes, from (°) }],   // расписание налётов задания ([] — нет; ночью всегда [])
           night: bool, weather: 'clear'|'fog'|'storm',
           wind: { speed (м/с), from (° откуда дует) },   // в шторм и в обороне МЕНЯЕТСЯ (объект новый, событие wind)
           areas: [{ targetId, x0, y0, x1, y1 }],         // ночные квадраты 2×2 км живых целей
           map: { seed, coast:[…], coastStep:0.25, islands:[{x,y,rx,ry,rot,name}], battery,
                  posts:[{name:'ЗВ-1',x,y}, …] } }         // посты звукометрии ([] если их нет)
integrity: 0…100
shells: { he, ap, illum, smoke, shrap }       // всегда все пять ключей
shots, wave (0 — не оборона), kills
targets[]: { id, label 'ЦЕЛЬ 1', name, kind, armored, hp, maxHp, radius, alive, escaped, moving, spotter,
             locate: 'recon'|'sound',
             reported: null | { x, y, course, speed (км/ч), time, rough?: true, sound?: [{name,x,y,bearing}] (тогда x,y = null) },
             area: null | { x0, y0, x1, y1 },   lit: bool,   active: bool,
             heading: 0…359 целое,              // НОВОЕ: куда смотрит нос; у движущихся = course, у неподвижных — постоянный случайный
             sinking: null | { since, dur: 18 },// НОВОЕ: убита, уходит под воду / догорает (прогресс = (time − since)/dur)
             sunk: bool,                        // НОВОЕ: скрылась совсем
             burning: bool,                     // НОВОЕ: hp < maxHp у многопрочных (остаётся true и у тонущей)
             firedAt: null | time,              // НОВОЕ: когда последний раз стреляла (вспышка видна 6 с)
             hunts: bool,                       // НОВОЕ: охотник на конвой (идёт на ближайший транспорт, бьёт по нему)
             x, y, course, speed … }            // истинные — см. ловушку 9
activeTarget: id|null
plot: { pins: { [id]: {x,y} }, alidade: { bearing, range }, recorded: { [id]: { bearing, range, time } }, pivot: 0…,
        lines: [{ from: 'УТЁС'|'ЗВ-1'|…|'scope', x, y, bearing }] }     // не больше 6, старые выпадают; 'scope' — пеленг трубы
computer: { range, charge (1…6), elevation|null, tof|null, stale, windRange (км), windBearing (°) }
faults: { drive, hoist, lights }      repair: null | { kind, t, dur }
turret: { bearing (0.01°), brake, elevation (0.01°, −2…45) }
breech: { open, shell: null|'he'|'ap'|'illum'|'smoke'|'shrap', rammed, charges 0…6,
          busy: null | { kind, t, dur, arg } }
        // busy.kind: 'open'|'close'|'hoist'|'ram'|'charge'|'uncharge'|'unload'|'auto'; прогресс = t/dur
        // busy.arg: null | { type } (hoist) | { shell, charges } (auto)   ← функций в состоянии больше нет
fire: { armed, burst (1…3), burstLeft, salvo }
flight[]: { id, n, t, tof, shell, charges, x, y, bearing, elevation, pair }
impacts[]: { n, x, y, time, shell, hit, targetId, snap, craters, land, pair,
             observed: bool }          // НОВОЕ: разрыв видел свой наблюдатель в трубу. Последние 40
lights[]: { x, y, until, n }           // радиус света 1.5 км; погасшие удаляются
smokes[]: { x, y, bearing, until, n,
            cover: bool,               // НОВОЕ: лежит в 1–4 км от батареи — прикрывает БАТАРЕЮ (±25° по пеленгу)
            convoy: bool }             // НОВОЕ: поставлена у корабля конвоя (≤ 1.2 км) — прикрывает его от охотников
history[]: { n, time, shell, charges, bearing, elevation, x, y, hit, targetId, reportText, pair, impactTime }
tracks: { [targetId]: [{ t, x, y }] }
radio[]: { time, from, text, kind: 'info'|'recon'|'report'|'good'|'bad' }
         // from: 'ШТАБ'|'РАЗВЕДКА'|'КОРРЕКТИРОВЩИК'|'ЗВУКОМЕТРИЯ'|'МЕТЕО'|'РАСЧЁТ'
         //       + НОВЫЕ голоса: 'НАВОДЧИК'|'ЗАРЯЖАЮЩИЙ'|'РАДИСТ' (члены расчёта), 'КОНВОЙ'|'ДОЗОР' (свои корабли)
lastReport: null | { targetId|null, over (м), right (м), text|null, time, observed, delay (с),
                     bracket?, dark?, special?: 'illum'|'smoke',
                     blind?: bool }    // НОВОЕ: корректировщика нет (mission.noSpotter): over = right = 0, text = null
reportDue: null | time                 // НОВОЕ: доклад корректировщика в пути, придёт в этот момент
checklist: { measured, computed, loaded, traversed, elevated, armed }

// ---------- НОВОЕ ----------
scope: { bearing (0.01°), zoom: 4|10,
         last: null | { n, dBearing (°, + разрыв правее цели) | null, over: +1|−1|0 | null, targetId | null, t } }
friends[]: { id: 'F1'…, label: 'СВОИ 1', name: 'Транспорт «Онега»', kind: 'patrol'|'transport',
             x, y, heading, speed (км/ч; 0 — стоит/дошёл), hp, maxHp (транспорт 3, катер 2), alive,
             path: null | [{x,y}, …], leg, dir, loop,     // маршрут; loop — ходит туда-обратно
             convoy: bool, arrived: bool,                 // корабль конвоя; дошёл до конца маршрута
             sinking: null | { since, dur: 18 }, sunk, burning }
raid: null | { phase: 'inbound'|'over', from,
               planes: [{ id, bearing, elevation, range (км), alive, attacked, hit (с под огнём), downAt? }] }
aa: { bearing, elevation (0…80), firing, heat 0…1, jammed, ammo (400 на бой) }
crew: { gunner, loader, radio } — каждый { role, title: 'НАВОДЧИК'|'ЗАРЯЖАЮЩИЙ'|'РАДИСТ', name: 'Громов'|'Седых'|'Вяткин',
                                           state: 'ok'|'tired'|'wounded', fatigue 0…1, woundedUntil (time) }
medkits: 0…3
stats: { friendlyHits, friendlyKills, convoyLost, convoyArrived, planesDown, bombs }     // счётчики текущего боя
```

## Действия → `{ ok:true, … }` | `{ ok:false, reason }` (+ событие `denied`)
| Метод | Примечания |
|---|---|
| `startMission(i)`, `startSkirmish()`, `startSurvival()`, **`startDaily('YYYY-MM-DD')`**, `begin()`, `quit({keep}?)`, `pause(b)`, `setSpeed(1|2|3)`, `setDifficulty(0|1)`, `setMuted(b)` | `start…` → `briefing`; `begin()` → `playing` (стирает старый `save.resume`, ставит `state.speed = settings.speed`); `quit()` из фазы `playing` стирает `save.resume` (из `briefing|won|lost` — не трогает), `quit({keep:true})` — никогда |
| `selectTarget(id)`, `setPin(id, x, y)` | только живые цели (`'F1'`, уничтоженная или ушедшая — отказ) с донесением или ночным квадратом |
| `setAlidade({ bearing?, range? })`, `pivots()`, `setPivot(i)`, `drawLine()`, `clearLines()`, `recordMeasurement()` | как раньше |
| `predict(id, tAhead=0)` → `{x,y}`\|null | прогноз по последнему донесению |
| `setComputerRange(km)`, `setComputerCharge(n)`, `chargeStates()`, `compute()`, `windParts(b)`, `firingBearing()` | как раньше |
| `setBrake(b)`, `rotateTurret(deltaDeg, {power}?)`, `elevate(deltaDeg)` | **дельта делится на `crewFactor('gunner')`** (ловушка 6) |
| `openBreech()`, `closeBreech()`, `hoistShell(type)`, `ramShell()`, `addCharge()`, `removeCharge()`, `unload()` | длительности × `crewFactor('loader')` × улучшение |
| `arm(b)`, `fire()`, `fireReadiness()`, `setBurst(1…3)`, `setSalvo(bool)`, `repair(kind)` | как раньше |
| **`setScope({ bearing?, zoom? })`** | пеленг трубы (до 0.01°), увеличение 4 или 10 |
| **`scopeFov()`** → ° | поле зрения трубы по горизонту: 16 при ×4, 6.4 при ×10 |
| **`visible(id)`** → bool | видна ли цель (число) / свой (`'F1'`) в оптику — правила ниже |
| **`scopeMark()`** | линия пеленга трубы на планшет (`plot.lines`, `from:'scope'`) + радио РАСЧЁТ + событие `scopeMark` |
| **`aimAA({ bearing?, elevation? })`**, **`slewAA(dB, dE)`**, **`fireAA(bool)`** | зенитка: абсолютная наводка / приращение / гашетка |
| **`treat(role)`** | аптечка: `'gunner'|'loader'|'radio'`; отказ, если боец `ok` или аптечек нет |
| **`crewFactor(role)`** → 1 \| 1.25 \| 1.6 | для показа; логика уже учла |
| **`upgrades()`** → `[{ id, title, desc, level, max: 3, cost: 2|3|4|null, effect, next }]` | `effect` — что даёт текущий уровень (строка), `next` — что даст следующий (`null` на максимуме) |
| **`buyUpgrade(id)`**, **`resetUpgrades()`**, **`points()`** | только вне боя (`menu|won|lost`) и пока нет сохранённого боя (`save.resume` — отказ «Сначала закончите или сбросьте сохранённый бой»: «ПОГРЕБ» уже лежит в снимке); сброс возвращает все очки |
| **`dailyInfo(dateKey)`** → `{ date, title, name, brief, best: {score,stars}|null }` \| `null` (плохая дата) | не меняет состояние |
| **`settings()`** → копия всех настроек, **`setSetting(key, value)`** → `{ok}` | ключи и области — раздел 8; неизвестный ключ или значение вне области — отказ `{ok:false}` + `denied`, ничего не меняется; событие `settings` |
| **`resetSettings()`** → `{ok}` | все настройки по умолчанию + `save.muted = false`; сложность и прогресс не трогает; события `settings`, `state` |
| **`resetProgress({ settings: false }?)`** → `{ok}` | стирает весь прогресс; в любой фазе (бой сначала бросается); события `phase` (если была не `menu`), `save`, `upgrades`, `settings` (только при `settings: true`), `state` — раздел 8 |
| **`friendsInDanger()`** → `friend[]`, **`friendInDanger()`** → id \| `null`, `FRIEND_ZONE` = 0.4 | свои в зоне поражения — раздел 8 |
| `SETTINGS` | `{ key: { def, list } }` — значение по умолчанию и список допустимых значений (`list: null` у булевых и числовых) |
| **`snapshot()`** → JSON \| `null` (не в бою) | весь идущий бой |
| **`restore(snap?)`** → `{ok}` | без аргумента — из `save.resume`; фаза сразу `playing`, пауза снята; скорость времени (`state.speed`) и пост (`state.station`) — те, что были в момент записи |
| **`setStation(id)`** → `{ok}` | интерфейс сообщает id поста, на котором игрок (`state.station`, по умолчанию `'plot'`); логика его только хранит — он попадает в снимок боя, и оболочка после `restore()` открывает тот же пост |
| **`suspend()`** | записать `save.resume` сейчас (выход с сохранением, уход приложения в фон) |
| **`discardResume()`**, **`resumeInfo()`** → `{ title, time, integrity, kind }` \| `null` | `kind`: `'campaign'|'skirmish'|'survival'|'daily'` |
| `rank()`, `lit(x,y)`, `smoked(targetId)`, `shellPosition(f)`, `solve`, `chargeRange`, `isLand`, `coastAt`, `fmt.km/time/brg` | как раньше |

Константы и справочники:
- `game.C = { LOAD_ANGLE: 3, EL_MIN: -2, EL_MAX: 45, CHARGES: 6, MAP: 20, RANGE_MIN: 0.01, RANGE_MAX: 22,`
  `AA_EL_MAX: 80, AA_CONE: 2.2, AA_RANGE: 4.5, AA_AMMO: 400, SCOPE_ZOOMS: [4, 10], VIS_CLEAR: 16, VIS_FOG: 4, FRIEND_HIT: 0.25 }`
- `game.SHELLS`, `game.ranks`, `game.difficulties`, `game.FAULTS` — как раньше.
- **`game.UPGRADES`** = `{ hoist|range|spotter|armor|magazine|repair: { title, desc, eff(level) → строка } }`, **`game.CREW`** = `{ gunner|loader|radio: { title, name } }`.
- `game.campaign` — **36** заданий: 0–7 часть I, 8–15 II, 16–23 III, 24–29 IV «НОЧЬ И ТУМАН», **30–35 часть V «КОНВОЙ»**:
  30 «Проводка» (чистый эскорт: 3 транспорта, охотники эсминец + подлодка) · 31 «Воздух!» (конвой + два налёта + батарея) ·
  32 «Свой в тумане» (туман, сторожевой катер ходит у самой баржи-цели) · 33 «Рейдеры во тьме» (ночь, конвой, охотники,
  `noSpotter` — только свой глаз) · 34 «Дозор у берега» (десант + скрытая гаубица + налёт, катер вдоль берега) ·
  35 «Конвой прорвался» (финал: крейсер и эсминец-охотники, скрытая батарея, два налёта, конвой + катер).
  В описании задания новые поля: `friends: [{ kind, convoy?, path: [[dx,dy],…] | near: i, loop? }]`, `raids`, `noSpotter`, у цели `hunts`.
  Налёт добавлен в три старых задания: 19 «Танкеры», 23 «Генеральное сражение», 26 «Штормовая дуэль».
- `game.save` = `{ unlocked, stars[], records[], difficulty, muted, xp, survivalBest,`
  `upgrades: { hoist, range, spotter, armor, magazine, repair } (0…3), points (производное, пересчитывается),`
  `settings: { …18 ключей, раздел 8 }, daily: null | { date, score, stars }, resume: null | { snap, title, savedAt, kind, integrity } }`.
  Старые сохранения загружаются: чего нет — по умолчанию; мусор в новых полях заменяется значениями по умолчанию.

## События `game.on(name, fn)` → функция отписки
Прежние: `state`, `phase`, `radio`, `denied`, `recon`, `recorded`, `computed`, `breech`, `fired`, `targetDestroyed`, `incoming`,
`fault`, `area`, `light`, `smoke`, `wind`, `wave`.

Изменились:
- `impact ({ report, hits, x, y, shell, n, pair, **observed**: bool, **friendly**: [{ id, damage, destroyed }] })` —
  `report` здесь будущий (см. ловушку 5), у него есть `delay`; `friendly` — попадания по своим этим снарядом.
- `batteryHit ({ damage, by, escape?, plane? })` — `by: 'air'` и `plane: id` для бомб.
- `missionEnd ({ won, stars, reason, stats, record, survival, **daily**, xpGained, rank, rankUp, **points**, history, tracks })`:
  `stats` += `{ friendlyHits, friendlyKills, convoyLost, convoyArrived, convoyTotal, planesDown, bombs }`;
  `daily: null | { date, score, best: {score,stars}|null, isNew, previous }`; `points` — очков снабжения после боя.

Новые:
| Событие | Данные |
|---|---|
| `report` | объект доклада корректировщика — в момент, когда он дошёл (тогда же `state.lastReport` и радио) |
| `observed` | `state.scope.last` — свой наблюдатель увидел разрыв |
| `scopeMark` | `{ bearing }` |
| `crew` | `{ role, state }` — боец устал / ранен / снова в строю |
| `friend` | `{ id, hit: true, by: 'own'|'enemy' }` · `{ id, miss: true, by: 'enemy' }` · `{ id, sunk: true, by }` · `{ id, arrived: true }` |
| `friendFire` | `{ by: targetId, at: friendId, eta: 2 }` — охотник выстрелил по кораблю конвоя (вспышка) |
| `raid` | `{ phase: 'warning', from, eta: 10 }` (на эти 10 с `state.raidWarn = {from, until}`; после `restore()` внутри них тревога повторяется с `restored: true` и оставшимся `eta`) → `{ phase: 'start', planes, from }` → `{ phase: 'end', shot, bombed }` |
| `plane` | `{ id, down: true }` · `{ id, bombed: true }` |
| `aa` | `{ jammed: true|false }` — клин / остыл |
| `upgrades` | `game.upgrades()` после покупки/сброса |
| `settings` | `game.settings()` (после `setSetting`, `resetSettings`, `resetProgress({settings:true})`) |
| `save` | `game.save` — прогресс стёрт (`resetProgress`): перерисовать меню, звание, рекорды, «ПРОДОЛЖИТЬ БОЙ» |
| `restored` | `resumeInfo()` на момент восстановления (после него сразу `phase` и `state`) |

`game.update(dtSeconds)` вызывать каждый кадр (сама учитывает паузу, фазу и ускорение времени).

## Правила — прежние (кратко)
Снаряды: `he` — небронированные (≤ radius — 2, ≤ 1.8·radius — 1); `ap` — только прямое (броня 2, без брони 1); `illum` — свет
1.5 км на 60 с; `smoke` — завеса на 60 с; `shrap` — `landing` в пределах 3·radius, прочие небронированные — 1 прямым.
Ночь: квадраты 2×2 км → свет → точное донесение; «по вспышке» — грубо. «Вилка»: пара ±0.15 км, один доклад. Туман: донесения
вдвое реже, координаты до 0.1 км, отклонения до 50 м. Шторм: ветер меняется каждые 80–110 с, расчёт устаревает.
Оборона: волны, +25 прочности и пополнение за волну, прорыв −25. Звания: `xp`, длительности × `(1 − 0.05·rank.index)`.
Подробности не изменились, кроме перечисленного ниже.

## Правила — новое

### 1. Наблюдательный пост (`observe`)
- `state.scope = { bearing, zoom, last }`, `setScope`, `scopeFov()`.
- **`visible(id)`**: днём в ясную погоду и в шторм — не дальше 16 км от батареи; в тумане — не дальше 4 км; ночью — только если
  объект в свете осветительного (`lit`) или не позже 6 с после выстрела своего орудия (`firedAt`). Никогда: `sunk`, `escaped`
  (в т.ч. погрузившаяся лодка), ещё не появившаяся цель (`!active`), скрытая батарея (`locate:'sound'`), не стрелявшая
  последние 6 с. Тонущая (`sinking && !sunk`) — видна. Свои — по тем же правилам расстояния/ночи.
- **Что рисовать в трубе**: цели и свои с `visible(id)`; всплески своих снарядов (`impact {x,y}` — если в поле зрения);
  вспышки (`incoming {by}`, `friendFire {by}`, `target.firedAt`); свет (`lights`), дым (`smokes`); самолёты (`raid.planes`:
  пеленг и угол места уже посчитаны от батареи).
- **Свой глаз**: когда снаряд (кроме ОСВ и ДЫМ) падает и разрыв попадает в поле зрения трубы
  (`|пеленг разрыва − scope.bearing| ≤ scopeFov()/2`), не дальше предела видимости, а ночью — в свете осветительного:
  запись `impacts[]` и событие `impact` получают `observed: true`, пишется
  `scope.last = { n, dBearing, over, targetId, t }` — относительно ближайшей к разрыву ВИДИМОЙ цели противника
  (`dBearing` до 0.1°, + правее; `over` +1 перелёт / −1 недолёт / 0 попадание в неё); сразу, без задержки, идёт строка
  РАСЧЁТА «НАБЛЮДАЮ: разрыв № 3 — ЦЕЛЬ 2: правее на 0,4°, перелёт.» и событие `observed`.
  Видимых целей нет — `dBearing = over = targetId = null`, текст «…целей рядом не вижу».
  Величины перелёта свой глаз не даёт — только знак. Для пары «вилки» наблюдается каждый снаряд, `last` — последний.
- `mission.noSpotter` (задание 33): корректировщик молчит всегда — доклад `{ blind: true, observed: false, text: null }`,
  попадания объявляет РАЗВЕДКА. Отклонения — только из `scope.last`.
- `scopeMark()` — линия `{ from: 'scope', x, y (батарея), bearing }` в `plot.lines` (общий предел 6 линий).

### 2. Корабли как модели
`heading`, `sinking`, `sunk`, `burning`, `firedAt` — см. состояние. Виды для силуэтов: цели `barge, depot, battery, bunker,
transport, landing, destroyer, cruiser, minelayer, howitzer, radar, fort, submarine, tanker, battleship`; свои `patrol, transport`.
Для построек на островах `sinking` означает «разрушена, догорает» (те же 18 с).

### 3. Улучшения башни
Очки снабжения: `points() = floor(save.xp / 150) − потрачено`. Уровни 0–3, цена следующего уровня 2, 3, 4 (всего 9 за улучшение).
| id | Название | Действие за уровень |
|---|---|---|
| `hoist` | БЫСТРЫЙ ЭЛЕВАТОР | длительность `hoist`, `ram` и автоперезарядки очереди (`auto`) −12% |
| `range` | ДАЛЬНОМЕР | ошибка донесений −25%: шаг координат в тумане 0.1 → 0.075 / 0.05 / 0.025 км; засечка «по вспышке» 0.5 → 0.375 / 0.25 / 0.125 км; ошибка пеленгов звукометрии на «Командире». (Днём в ясную погоду донесения и так точные.) |
| `spotter` | ВТОРОЙ КОРРЕКТИРОВЩИК | задержка доклада об отклонении (3 с) −25% |
| `armor` | БРОНЯ | урон батарее от снарядов и бомб −10% (прорыв в обороне — без скидки) |
| `magazine` | ПОГРЕБ | в начале боя +2 ОФ, +1 ББ, +1 ОСВ (в любом режиме) |
| `repair` | РЕМОНТНАЯ ПАРТИЯ | время ремонта −20% |
Покупка и сброс — только вне боя. Хранится в `save.upgrades`.

### 4. Расчёт
`state.crew`, `state.medkits` (2 на бой; в обороне 3 и +1 за отбитую волну, не больше 3).
- Усталость: заряжающий +0.06 за каждый досланный снаряд (включая автоперезарядку); наводчик +0.02 за секунду, в которую
  вызывались `rotateTurret`/`elevate` с ненулевой дельтой; радист +0.03 за каждое сообщение КОРРЕКТИРОВЩИКА/РАЗВЕДКИ/ЗВУКОМЕТРИИ.
  Отдых −0.01/с, когда не занят (заряжающий — затвор не `busy`; наводчик — не крутит; радист — нет доклада в пути).
- `fatigue > 0.8` → `'tired'`, работа ×1.25 медленнее: заряжающий — все длительности затвора; наводчик — дельты наводки;
  радист — задержка доклада корректировщика.
- Каждое попадание по батарее (снаряд или бомба с уроном > 0): 20% — ранен случайный боец на 45 с → ×1.6.
- `treat(role)`: снимает рану сразу и обнуляет усталость, тратит аптечку.
- Голоса: смена состояния — реплика в эфире от имени бойца (`from` = `title`); РАДИСТ кричит «ВОЗДУХ!»; ЗАРЯЖАЮЩИЙ
  предупреждает о последнем снаряде типа. Событие `crew { role, state }`.

### 5. Свои силы
- `state.friends` известны точно всегда; это не цели (выбрать/поставить фишку нельзя).
- Свой боевой снаряд (ОФ, ББ, ШРП), разорвавшийся ближе **0.25 км** от своего (живого, не дошедшего): попадание
  (урон 1, ближе 0.1 км — 2), `stats.friendlyHits++`, возмущение в эфире (КОНВОЙ/ДОЗОР), событие `friend {hit, by:'own'}`;
  потоплен — `stats.friendlyKills++`, `friend {sunk, by:'own'}`.
- Охотники (`target.hunts`): идут на ближайший корабль конвоя (ближе 2 км — ложатся на его курс), с 6 км бьют по нему каждые
  14–20 с (первый выстрел через 25–35 с после появления): `friendFire`, через 2 с — попадание с вероятностью 0.35
  (×0.4, если в 1.2 км от этого корабля стоит живая завеса). Попадание −1 hp. Ночью выстрел охотника даёт засечку «по вспышке».
  У охотника нет «ухода из зоны» (подлодка-охотник не погружается); своё орудие по батарее, если есть, работает как обычно.
- Дымовой снаряд, упавший не дальше 1.2 км от корабля конвоя в пути, ставит завесу (`convoy: true`) на любой дальности от батареи.
- Конвой (`mission.convoy`): **победа**, когда все цели уничтожены ИЛИ все уцелевшие корабли конвоя дошли (`arrived`), хотя бы один;
  **поражение**, когда потоплены все корабли конвоя («Конвой уничтожен.»). Пока конвой в пути, бой не кончается из-за пустого погреба.
- Звёзды: −1, если потерян хоть один корабль конвоя; ещё −1 за каждого своего, потопленного вашим огнём; при победе не меньше 1.

### 6. Налёт и зенитка (`aa`)
- За 10 с до `raid.at`: радио РАДИСТ «ВОЗДУХ! …», `raid {phase:'warning'}`. В момент `at`: `state.raid = { phase:'inbound', planes }`,
  `raid {phase:'start'}`. Самолёты стартуют с 7 км (каждый следующий на 0.5 км дальше, пеленги расходятся на ~5°), идут 0.22 км/с,
  угол места растёт с 6° до 35°: `elevation = 6 + 29·(1 − (range − 0.4)/6.6)`.
- Дошёл до 0.4 км — бомбы: 12 урона (× броня; от сложности не зависит), 35% — отказ узла башни, `plane {bombed}`,
  `batteryHit {by:'air'}`; дальше `attacked = true`, пеленг переворачивается на 180° (прошёл над головой), `range` растёт.
- Когда каждый самолёт сбит или отбомбился: `raid.phase = 'over'`, через 6 с `state.raid = null` и `raid {phase:'end', shot, bombed}`.
  Второй налёт во время первого добавляет самолёты в тот же `state.raid`.
- Зенитка: `aimAA`/`slewAA`, `fireAA`. Пока стреляет: `heat += 0.16/с`, расход 8 патронов/с из 400; не стреляет — остывает 0.12/с.
  `heat ≥ 1` → `jammed` до `heat < 0.4` (событие `aa`). Самолёт в пределах 4.5 км, у которого угол между направлением на него и
  осью автомата `< 2.2°` (кольцевой прицел, упреждение не нужно), набирает `hit`; 1.2 с суммарно — сбит (`plane {down}`, +15 опыта
  в `missionEnd`). Отбомбившийся самолёт тоже можно сбить, пока он в 4.5 км.
- Главный калибр во время налёта работает как обычно. Ночью налётов нет. Конец боя налёт не задерживает.
- Оборона: на каждой третьей волне (3, 6, 9…) через 10 с после прихода волны — предупреждение, через 20 с — налёт: 2 самолёта, +1 за
  каждые три волны, не больше 4.

### 7. Задание дня
`dailyInfo(dateKey)`, `startDaily(dateKey)` — задание строится ГПСЧ с зерном от даты: 3–5 целей разных видов, ветер, погода
(ясно 60% / туман 20% / шторм 20%), 40% — один налёт (2–3 самолёта), 30% — свой сторожевой катер у первой цели; ночи нет.
Расстановка целей и ветер тоже от даты — на всех устройствах одинаково. `mission.daily = dateKey`, `mission.index = null`,
`mission.title = 'ЗАДАНИЕ ДНЯ · ДД.ММ'`, `mission.name` — сгенерированное имя («Северный маяк»).
Счёт (только при победе, иначе 0):
`1000·звёзды + 6·прочность + max(0, 600 − время, с) + max(0, 400 − 20·боевых выстрелов) − 300·попаданий по своим − 100·бомб по батарее`.
`missionEnd.daily = { date, score, best, isNew, previous }`; `save.daily = { date, score, stars }` — только лучший результат
одной (последней сыгранной с победой) даты: новая дата затирает старую. Опыт — как за свободный бой. Дату даёт интерфейс
(местная дата устройства, `'YYYY-MM-DD'`).

### 8. Настройки и сохранение боя
- `save.settings` — 18 ключей. Логика их хранит и проверяет; применяет интерфейс (кроме `autosave` и `speed`).
  Типы строгие: булевы — только `true/false`, числа — только числа (строка `'30'` — отказ).

  | Ключ | Область | По умолчанию | Смысл |
  |---|---|---|---|
  | `sens` | число 0.6…1.6, шаг 0.05 (вне границ — обрезается, не отказ) | 1 | чувствительность маховиков |
  | `invert` | bool | false | инверсия маховиков |
  | `lefty` | bool | false | режим для левши |
  | `vibro` | bool | true | вибрация |
  | `vibroPower` | `'low'` \| `'high'` | `'high'` | сила вибрации |
  | `hints` | bool | true | подсказки обучения (текст + кольцо) |
  | `autosave` | bool | true | запись боя каждые 15 с; `suspend()` работает всегда |
  | `speed` | 1 \| 2 | 1 | скорость боя по умолчанию: ставится в `begin()` и `restore()` |
  | `confirmFriendly` | bool | true | спрашивать «СВОИ В ЗОНЕ. ОГОНЬ?» (спрашивает интерфейс, `fire()` не блокируется) |
  | `crewPanel` | `'full'` \| `'compact'` \| `'off'` | `'full'` | плашки расчёта |
  | `volFx`, `volAmb`, `volRadio` | число 0…100 (округляется до целого) | 100, 70, 100 | громкость эффектов / фона башни / радио |
  | `text` | 1 \| 1.15 \| 1.3 | 1 | размер надписей |
  | `quality` | `'high'` \| `'mid'` \| `'low'` | `'high'` | качество графики |
  | `fps` | 60 \| 30 | 60 | ограничение кадров |
  | `nightTint` | `'normal'` \| `'soft'` | `'normal'` | яркость ночного красного фильтра |
  | `showFps` | bool | false | счётчик кадров |

  Общий звук вкл/выкл — по-прежнему `save.muted` / `setMuted(b)` (не в `settings`; события не шлёт). Сложность — `save.difficulty` / `setDifficulty`.
  Старое сохранение: недостающие и негодные значения — по умолчанию, лишние ключи отбрасываются.
  Смена `speed` посреди боя текущую скорость не трогает (её меняет `setSpeed`); `setSpeed` принимает 1, 2, 3.
- `resetSettings()` — `save.settings` по умолчанию, `save.muted = false`. Сложность не трогает.
- `resetProgress({ settings })` — `unlocked: 1`, `stars: []`, `records: []`, `xp: 0`, `survivalBest: null`, `upgrades` — все 0, `points: 0`,
  `daily: null`, `resume: null`; лишние поля прежних версий удаляются. Без `settings: true` остаются `settings`, `muted`, `difficulty`;
  с ним — и они по умолчанию (`difficulty: 0`, `muted: false`). В фазах `briefing|playing|won|lost` сначала `quit()` (событие `phase: 'menu'`).
  Флагов «обучение пройдено / ролик показан / что нового» в логике нет — ключи `localStorage` интерфейса он чистит сам (по событию `save`).
- Свои в зоне поражения — один источник правды: `friendsInDanger()` → свои (объекты из `state.friends`, ближайший к прицелу первым)
  ближе `FRIEND_ZONE` = 0.4 км к одной из точек прицеливания: замер выбранной цели; тот же пеленг на дальности вычислителя (расчёт не устарел);
  фактическая наводка заряженного орудия (`turret.bearing − windBearing`, `computer.range`). Вид снаряда не учитывает — для плашки
  «СВОИ В ЗОНЕ ПОРАЖЕНИЯ». `friendInDanger()` → id ближайшего или `null`; при заряженном ОСВ/ДЫМ — всегда `null` (своим они не вредят) —
  для вопроса перед выстрелом. Вне боя — `[]` / `null`.
- `snapshot()` — обычный JSON `{ v, state, sys }` (без функций; `JSON.parse(JSON.stringify(snap))` — без потерь): состояние целиком
  (цели, свои, снаряды в полёте, налёт, расчёт, журнал) и служебная часть — отложенные действия `sys.events = [{ t, a, p }]`
  (`a` — имя: `radio, windShift, activate, finish, nextWave, enemyShell, friendShell, report, raidWarn, raidStart, raidEnd`), счётчики.
  Внутрь снимка интерфейсу лезть не нужно.
- `restore(snap)` — в любой фазе, в т.ч. в свежесозданной игре: фаза `playing`, события `phase`, `restored`, `state`.
  Случайность после восстановления новая (исход боя не предопределён). Снимок другой версии (`v`) — отказ.
- `save.resume = { snap, title, savedAt (время боя), kind, integrity }` пишется `suspend()` и автоматически каждые 15 с боя (если `settings.autosave`);
  стирается в `missionEnd`, `discardResume()`, `quit()` без `keep` из идущего боя, и при `begin()` нового боя. Размер — 15–30 КБ: `state.radio` хранит последние 150 строк, в ОБОРОНЕ следы (`state.tracks`) убранных целей удаляются (`state.history` растёт по записи на выстрел).
- Сценарий интерфейса: при запуске `game.resumeInfo()` → предложить «ПРОДОЛЖИТЬ БОЙ» → `game.restore()`;
  уход в фон (`visibilitychange`) → `game.suspend()`; «выйти с сохранением» → `suspend(); quit({ keep: true })`.

### Вид из амбразуры / трубы — что есть в состоянии
`turret.bearing`, `scope`, `mission.night/weather/wind`, `targets[]` + `visible(id)` (heading, burning, sinking, sunk, firedAt),
`friends[]`, `lights[]`, `smokes[]`, `raid.planes[]`, `aa`, события `fired`, `impact {x,y,shell,observed}`, `light`, `smoke`,
`incoming`, `friendFire`, `plane`, `raid`.
