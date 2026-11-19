# Звуки «АРТА: Башня» — записи и лицензии

Все записанные звуки игры лежат в `sfx/pack1.js … pack3.js` (mp3 в base64; так их можно загрузить тегом `<script>`
из `file://` в WebView). Собираются из исходников ниже скриптом `tools/sfx-make.py` (вырезка, сдвиг высоты,
срезы частот, сведение слоёв, нормирование пика −1 дБ FS, короткие края, mp3 моно 96 кбит/с, фон 64–112 кбит/с)
и упаковываются `tools/sfx-pack.mjs`. В игре (`src/engine/audio/samples.js`) — срез тишины, перекрёстная склейка
петель, нормирование, понижение частоты буфера. Всё, чего нет в списке, синтезируется в коде игры.

Лицензии: почти всё — **CC0** (общественное достояние, без условий). Один файл — **CC BY 3.0** (гул винта самолёта),
его автор указан здесь и в игре: «НАСТРОЙКИ → ДАННЫЕ → ВЕРСИЯ ИГРЫ».

«Ниже на 0.6» = замедление ленты (высота и темп ×0.6): лёгкие бытовые металлы так звучат как тяжёлая сталь.

## CC BY 3.0 (нужна подпись)

| файл игры | источник | автор | лицензия | что сделано |
|---|---|---|---|---|
| plane_loop | [Airplane Prop Loop](https://opengameart.org/content/airplane-prop-loop) (airplane_prop.flac) | antumdeluge, по записи «Airplane prop» jakobthiesen | CC BY 3.0 | вырезка 4.6 с, петля; высота и громкость (Допплер) — в игре |

## CC0

| файл игры | источник (страница OpenGameArt) | автор | что сделано |
|---|---|---|---|
| gun_a, gun_c, egun_b | [Tiny Naval Battle Sounds Set](https://opengameart.org/content/tiny-naval-battle-sounds-set) — GunShotGverb.wav (собран автором из записей ВС США — общественное достояние) | qubodup (Iwan Gabovitch) | ниже на 0.82 / 0.74 / 0.7, срез верха 5–6 кГц (у egun — 2.2 кГц), под выстрел подложен лязг листа (metal_slam_01 / slam_03 на 0.4–0.45) −12 дБ |
| gun_b, gun_c, egun_a | [Cannon fire](https://opengameart.org/content/cannon-fire) — cannon_fire_0.ogg | thimras | ниже на 0.9 / 0.8 / 0.75, срезы, лязг листа −13 дБ |
| wat_a, wat_b, wat_c | Tiny Naval Battle Sounds Set — WaterSurfaceExplosion02/04/08.wav | qubodup | срез инфразвука; wat_b ниже на 0.9; wat_c + всплеск cannon_miss_0 −6 дБ |
| wat_c | [Ocean splash](https://opengameart.org/content/ocean-splash) — cannon_miss_0.ogg | thimras | ниже на 0.85, слой −6 дБ |
| steel_a, hit_a | Tiny Naval Battle Sounds Set — ExplosionMetal.wav (по записи автора freesound #67474) | qubodup | ниже на 0.85 / 0.7; hit_a — + лязг, гонг, падающий металл |
| land_a, near_a | [Cannon hit](https://opengameart.org/content/cannon-hit) — cannon_hit_0.ogg | thimras | ниже на 0.9 / 0.8; near_a + осыпь камней −12 дБ |
| land_c, steel_b, hit_b, near_b | [Battle at sea](https://opengameart.org/content/battle-at-sea) — cannon_hit_ship_short.ogg, cannon_hit_cannon_1.ogg, ship_destroyed_1.ogg (2.95–5.95 с) | thimras | ниже на 0.75–0.9, слои камней / гонга / лязга |
| gun_a, gun_b, bclose_b, hoist_stop, hit_a, lever, jam, bopen_a, bclose_a, creak_b, aa_* | [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) — metal_slam_01, metal_open_01, lock_open_01, metal_close_01, metal_hit_01…04, wood_squeak_01 | rubberduck | ниже на 0.4–0.8, срезы, слои |
| gun_c, hit_b, ram_a/b, clunk_a/b, unload, charge_a/b, bclose_a, jam, bell, paper_a/b | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) — slam_01…04, door_close_03, key_open_01, hit_01/02, bell_01, paper_01/02 | rubberduck | ниже на 0.45–0.75, срезы |
| land_c, near_b, thunder_a, relay_a/b, sq_open, sq_close, bed_machine | [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) — stones_01/02, thunder_01, switch_01/02, loop_machine_01 | rubberduck | thunder: срез инфразвука, ≤ 4.5 с; машины: ниже на 0.7, срез 4 кГц, петля |
| near_a, hit_a/b, unload, aa_tail | [75 CC0 breaking / falling / hit sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) — rock_falling_02, metal_falling_01…04 | rubberduck | ниже/выше на 0.7–1.1, слои −4…−12 дБ |
| aa_a/b/c, aa_loop | [25 CC0 bang / firework SFX](https://opengameart.org/content/25-cc0-bang-firework-sfx) — shot_01…03 | rubberduck | ниже на 0.62 + звон металла −16 дБ; очередь — 16 выстрелов через 0.11 с, стволы по очереди |
| bed_tension | [30 CC0 SFX loops](https://opengameart.org/content/30-cc0-sfx-loops) — noise_01 | rubberduck | ниже на 0.5, срез 1.2 кГц, петля |
| hit_a, steel_b, loupe | [Metal Impact Sounds](https://opengameart.org/content/metal-impact-sounds) — bong1.wav, clink3.wav | bmaczero | гонг ниже на 0.38–0.5 (звон брони) |
| lever_b, cover_a/b, drum_a | [Mechanical Sounds](https://opengameart.org/content/mechanical-sounds) — lightclunk1, squeakyclick1/2, typewriter | bmaczero | срез низа |
| lever_a/b, button_a/b | [Metal Interactions](https://opengameart.org/content/metal-interactions) — metal_interaction1/2, metal_button_press1/2 | qubodup | lever ниже на 0.8 |
| bopen_b | [Door Lock Sounds](https://opengameart.org/content/door-lock-sounds) — UnlockDoor.wav | cough-e | ниже на 0.6 |
| tick_*, det_*, drum_b/c, pin | [87 Clickety Clips](https://opengameart.org/content/87-clickety-clips) — click4, 12, 17, 21, 26, 27, 28, 30 | owlishmedia | срез низа 150–200 Гц |
| det_a, sel_b | [10 Clicks and Switches](https://opengameart.org/content/10-clicks-and-switches) — click.9, click.3 | starninjas | срез низа |
| toggle_a/b | [Light Switch Turn On And Off SFX](https://opengameart.org/content/light-switch-turn-on-and-off-sfx-0) | funnydude | срез низа |
| sel_a | [stove switch](https://opengameart.org/content/stove-switch) — switch_strength_stove_01.ogg | tinyworlds | срез низа |
| siren_shot, siren_loop | [Storm & Siren](https://opengameart.org/content/storm-siren) — storm_3_siren.ogg (сирена оповещения, наводнение 2013 г., Германия) | tinyworlds | вырезка 38–44.5 и 39.3–45.8 с, полоса 200–2400 Гц, петля; обороты — в игре |
| hoist_start | [SFX - Circuit breaker](https://opengameart.org/content/sfx-circuit-breaker) — switch on.wav | cleytonkauffman | ниже на 0.7 (контактор) |
| hoist_start, hoist_loop, hoist_stop | [Chain winch sounds](https://opengameart.org/content/chain-winch-sounds) — Marker 2, Marker #5, Marker #9 | bart | вырезки, петля 3.2 с |
| ram_a/b, overheat | [Steam release sounds](https://opengameart.org/content/steam-release-sounds) — Marker #1…#4 | bart | срез 6–7 кГц, вырезки |
| slew_loop | [Generator (loop)](https://opengameart.org/content/generator-loop) — loop_generator_1.mp3 | ycbcr | полоса 70–3000 Гц, петля; обороты — в игре |
| slew_loop | [(defect) motor loop](https://opengameart.org/content/defect-motor-loop) — fan_interval.wav | qubodup | ниже на 0.8, −14 дБ (вой обмотки) |
| ether, sq_open, sq_close | [Radio Noise 1](https://opengameart.org/content/radio-noise-1) — radio_noise_loop.wav (шум настоящего приёмника) | kresiek-the-furry | вырезки 4 с / 0.12 / 0.18 с |
| bed_room | Tiny Naval Battle Sounds Set — BattleShipMovementAmbient.wav | qubodup | срез 2.5 кГц, 7 с, петля |
| bed_air | [Beach Ocean Waves](https://opengameart.org/content/beach-ocean-waves) — wave_01/02 (по записи jasinski, freesound #18363, CC0) | qubodup | стерео, сведено с ветром |
| bed_air, bed_wind | [windy ambient noise](https://opengameart.org/content/windy-ambient-noise) — windy_ambiance_0.ogg | some-weirdo | вырезки 40–50 и 90–96 с, срез 3 кГц, петля |
| bed_storm | [Storm Arwen 2022](https://opengameart.org/content/storm-arwen-2022) — storm_arwen_2022.flac | tsorthan-grove | вырезка 60–68 с, стерео, петля |
| bed_storm | [Rain (loopable)](https://opengameart.org/content/rain-loopable) — 1.mp3 | ylmir | 2–10 с, срез низа 300 Гц, −3 дБ |
| creak_a | [Tree Creaking](https://opengameart.org/content/tree-creaking) — tree_creak.flac | antumdeluge | ниже на 0.7 |
| creak_c | [old elevator door](https://opengameart.org/content/old-elevator-door) | sinny | ниже на 0.8, 1.7 с |

## Синтез (записи не нашлось или синтез и есть «оригинал»)

Свист снаряда и бомбы, шелест уходящего снаряда, ревун неисправности, зуммер, электрический треск, шестерни маховика,
радиопосылки и морзянка (тональные сигналы), капли, ревун в тумане, звуки интерфейса, музыка меню, звуки ролика
(кроме двери и разрывов). Синтез же играет первые секунды после первого касания, пока записи грузятся, и всегда,
если записи не загрузились.
