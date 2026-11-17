# game/ — игровая логика (фактический API)

Чистый JS без DOM/THREE. Проверяется `cd web && npm test` (бот проходит все 8 заданий по полной процедуре).
Единицы: **км**, **градусы** (пеленг 0° — север, по часовой), **секунды**. Карта 20×20 км, x — восток, y — север.

```js
import { createGame } from '../game/index.js';
const game = createGame({ storage: { get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) } });
```

## Состояние `game.state` (только чтение; меняется методами)
```
phase: 'menu'|'briefing'|'playing'|'won'|'lost'     paused, speed (1|3), difficulty (0 «Курсант» | 1 «Командир»), time (с)
mission: { id, index|null, name, brief, tutorial, skirmish, battery:{x,y},
           map: { seed, coast:[y при x=0,0.25,…,20], coastStep:0.25, islands:[{x,y,rx,ry,rot,name}], battery } }
integrity: 0…100          shells: { he, ap }          shots
targets[]: { id (1…), label 'ЦЕЛЬ 1', name, kind, armored, hp, maxHp, radius, alive, escaped, moving,
             reported: null | { x, y, course, speed (км/ч), time },    // ← показывать игроку ТОЛЬКО это
             x, y, course, speed … }                                    // истинные значения — НЕ показывать
activeTarget: id|null
plot: { pins: { [id]: {x,y} }, alidade: { bearing (0.1°), range (0.01 км) }, recorded: { [id]: { bearing, range, time } } }
computer: { range, charge (1…6), elevation|null, tof|null, stale }
turret: { bearing (0.01°), brake, elevation (0.01°, −2…45) }
breech: { open, shell: null|'he'|'ap', rammed, charges 0…6, busy: null | { kind, t, dur } }
        // busy.kind: 'open'|'close'|'hoist'|'ram'|'charge'|'uncharge'|'unload'; прогресс = t/dur
fire: { armed }
flight[]: { id, t, tof, shell, charges }             // снаряды в полёте
radio[]: { time, from: 'ШТАБ'|'РАЗВЕДКА'|'КОРРЕКТИРОВЩИК', text, kind: 'info'|'recon'|'report'|'good'|'bad' }
lastReport: null | { targetId, over (м, + перелёт), right (м, + вправо), text|null, time, observed }
checklist: { measured, computed, loaded, traversed, elevated, armed }
```

## Действия → `{ ok:true, … }` | `{ ok:false, reason }` (+ событие `denied`)
| Метод | Примечания |
|---|---|
| `startMission(i)`, `startSkirmish()`, `begin()`, `quit()`, `pause(b)`, `setSpeed(1|3)`, `setDifficulty(0|1)`, `setMuted(b)` | `startMission` → фаза `briefing`; `begin()` → `playing` |
| `selectTarget(id)` | только сообщённые разведкой цели |
| `setPin(id, x, y)` | округляет до 0.01 км |
| `setAlidade({ bearing?, range? })` | пеленг до 0.1°, дальность до 0.01 км (0…25) |
| `recordMeasurement()` | пишет показания алидады в `plot.recorded[activeTarget]`, событие `recorded` |
| `predict(id, tAhead=0)` → `{x,y}`|null | прогноз по последнему донесению (для отметок упреждения) |
| `setComputerRange(km)`, `setComputerCharge(n)` | меняют входы; если был расчёт — `stale = true` |
| `chargeStates()` → `['ok'|'out' ×6]` | какие заряды достают на текущей дальности вычислителя |
| `compute()` → `{ ok, elevation, tof }` | при отказе `elevation = null` |
| `setBrake(b)`, `rotateTurret(deltaDeg)` | вращение отказывает при стопоре |
| `elevate(deltaDeg)` | при открытом затворе выше 3° не поднять |
| `openBreech()`, `closeBreech()`, `hoistShell('he'|'ap')`, `ramShell()`, `addCharge()`, `removeCharge()`, `unload()` | длительные операции: ставят `breech.busy`, по завершении — событие `breech` |
| `arm(b)`, `fire()` → `{ ok, tof }`, `fireReadiness()` → `{ shell, charge, breech, brake, armed }` | после выстрела затвор закрыт и пуст, цепь снята |
| `solve(rangeKm, charge)`, `chargeRange(n)` → `{min,max}` | чистые функции |
| `isLand(x,y)`, `coastAt(x)` | для отрисовки карты |
| `fmt.km(v)` → `'07.55'`, `fmt.time(s)` → `'02:15'` | |

`game.C = { LOAD_ANGLE: 3, EL_MIN: -2, EL_MAX: 45, CHARGES: 6, MAP: 20, RANGE_MIN: 0.01, RANGE_MAX: 22 }`,
`game.campaign` (массив заданий: `{ id, name, brief, … }`), `game.save` (`{ unlocked, stars[], difficulty, muted }`),
`game.difficulties` (`['Курсант','Командир']`).

## События `game.on(name, fn)` → функция отписки
`state` (после любого изменения; во время боя — практически каждый кадр), `phase (phase)`, `radio (msg)`,
`denied ({ action, reason })`, `recon (target)` (новое донесение о цели), `recorded ({ targetId, bearing, range })`,
`computed ({ elevation, tof })`, `breech (state.breech)`, `fired ({ id, tof, shell, charges })`,
`impact ({ report, hits:[{ target, damage, destroyed }], x, y, shell })`, `targetDestroyed (target)`,
`batteryHit ({ damage, by })` (damage 0 — промах противника), `missionEnd ({ won, stars, reason, stats:{ shots, par, time, integrity, destroyed, total } })`.

`game.update(dtSeconds)` вызывать каждый кадр (сама учитывает паузу, фазу и ускорение времени).
