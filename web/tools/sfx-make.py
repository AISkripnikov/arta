#!/usr/bin/env python3
# Сборка записанных звуков (web/.dev/sfx-src/*.mp3, не в репозитории) из скачанных исходников CC0/CC-BY (см. web/static/CREDITS-AUDIO.md).
#   python3 -I tools/sfx-make.py <каталог-со-скачанным> [имя …]
# Исходники в репозиторий не кладутся (их сотни мегабайт); список, ссылки и лицензии — в CREDITS-AUDIO.md.
# Обработка: ffmpeg (вырезка, сдвиг высоты через asetrate, срезы), сведение слоёв и нормирование — numpy;
# вывод — mp3 моно 96 кбит/с (фон — 112 кбит/с, стерео там, где помечено). Пик −1 дБ FS, короткие края.
# Затем: node tools/sfx-pack.mjs — упаковать mp3 в static/sfx/*.js (WebView на file:// не даёт XHR/fetch к файлам).
import os, subprocess, sys
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.environ.get('SFX_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.dev', 'sfx-src')
SR = 44100

def load(f, start=0.0, dur=None, pitch=1.0, lp=None, hp=None, ch=1):
    """Слой: файл → float32 [n, ch] при SR. pitch < 1 — ниже и длиннее (как замедленная лента)."""
    af = []
    if pitch != 1.0: af.append(f'asetrate={int(SR * pitch)},aresample={SR}')
    if hp: af.append(f'highpass=f={hp}')
    if lp: af.append(f'lowpass=f={lp},lowpass=f={lp}')
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(start)]
    if dur: cmd += ['-t', str(dur / pitch if pitch != 1.0 else dur)]
    cmd += ['-i', os.path.join(SRC, f), '-ac', str(ch), '-ar', str(SR)]
    if af: cmd += ['-af', ','.join(af)]
    cmd += ['-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).copy()
    if dur: x = x[: int(dur * SR)]
    return x

def mix(layers, ch=1):
    """layers: [(x, offset_s, gain_dB)] → сумма."""
    n = max(int(o * SR) + len(x) for x, o, g in layers)
    out = np.zeros((n, ch), np.float32)
    for x, o, g in layers:
        i = int(o * SR)
        if x.shape[1] != ch: x = np.repeat(x.mean(axis=1, keepdims=True), ch, axis=1)
        out[i:i + len(x)] += x * (10 ** (g / 20))
    return out

def trim(x, thr_db=-60, pre=0.003):
    a = np.abs(x).max(axis=1); thr = a.max() * 10 ** (thr_db / 20)
    idx = np.where(a > thr)[0]
    if not len(idx): return x
    s = max(0, idx[0] - int(pre * SR)); e = min(len(x), idx[-1] + int(0.01 * SR))
    return x[s:e]

def fades(x, fi=0.003, fo=0.03):
    n = len(x); a = min(n // 2, int(fi * SR)); b = min(n // 2, int(fo * SR))
    if a: x[:a] *= np.linspace(0, 1, a)[:, None]
    if b: x[-b:] *= np.linspace(1, 0, b)[:, None] ** 2
    return x

def write(name, x, loop=False, kbps=96, maxdur=None):
    x = x - x.mean(axis=0)                       # без постоянной составляющей
    if not loop:
        x = trim(x, -50)
        if maxdur and len(x) > maxdur * SR:      # длинный хвост: обрезать с плавным затуханием последней трети
            x = x[: int(maxdur * SR)].copy(); k = len(x) // 3
            x[-k:] *= np.linspace(1, 0, k)[:, None] ** 1.5
        x = fades(x)
    else: x = fades(x, 0.002, 0.002)
    pk = np.abs(x).max()
    x = x * (10 ** (-1 / 20) / pk)              # пик −1 дБ FS
    ch = x.shape[1]
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + '.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', '-ar', '44100' if ch == 1 and kbps <= 96 else '44100', p],
                   input=x.astype(np.float32).tobytes(), check=True)
    print(f'{name:16s} {len(x) / SR:5.2f} s  {ch}ch  {os.path.getsize(p) / 1024:6.1f} КБ')

L = load
NB = 'x/qubodup-NavalBattleSoundSet-cc0_0/qubodup-NavalBattleSoundSet-cc0/'
MW = 'x/100-CC0-wood-metal-SFX/'
S1 = 'x/100-CC0-SFX_0/'
S2 = 'x/sfx_100_v2/sfx100v2_'
BF = 'x/sfx_breaking_and_falling/bfh1_'
CC = 'x/Click_Clips/'
TC = 'x/10_clicks_and_switches/10 Clicks and Switches/'
BG = 'x/25-CC0-bang-sfx/'
MI = 'x/metal_interactions/metal_interactions/'
MS = 'x/mechanical-sounds/'
IM = 'x/metal-impact-sounds/'
WI = 'x/winch/winch - '

R = {}
def rec(name, **kw):
    def deco(fn): R[name] = (fn, kw); return fn
    return deco

# ---------------- главный калибр (изнутри башни): выстрел + низкий лязг брони (тот же лист металла, на полторы октавы ниже)
@rec('gun_a')
def _(): return mix([(L(NB + 'GunShotGverb.wav', pitch=0.82, lp=6000, hp=25), 0, 0),
                     (L(MW + 'metal_slam_01.ogg', pitch=0.42, lp=2500), 0.012, -12)])
@rec('gun_b')
def _(): return mix([(L('cannon_fire_0.ogg', pitch=0.9, lp=6000, hp=25), 0, 0),
                     (L(MW + 'metal_slam_01.ogg', pitch=0.38, lp=2200), 0.01, -13)])
@rec('gun_c')
def _(): return mix([(L(NB + 'GunShotGverb.wav', pitch=0.74, lp=5000, hp=25), 0, 0),
                     (L('cannon_fire_0.ogg', pitch=0.8, lp=3000), 0.015, -6),
                     (L(S1 + 'slam_03.ogg', pitch=0.45, lp=2000), 0.01, -12)])

# ---------------- разрывы
@rec('wat_a')
def _(): return L(NB + 'WaterSurfaceExplosion02.wav', hp=25)
@rec('wat_b')
def _(): return L(NB + 'WaterSurfaceExplosion04.wav', hp=25, pitch=0.9)
@rec('wat_c')
def _(): return mix([(L(NB + 'WaterSurfaceExplosion08.wav', hp=25), 0, 0), (L('cannon_miss_0.ogg', pitch=0.85), 0.05, -6)])
@rec('land_a')
def _(): return L('cannon_hit_0.ogg', hp=25, pitch=0.9)
@rec('land_c')
def _(): return mix([(L('cannon_hit_ship_short.ogg', hp=25, pitch=0.85), 0, 0), (L(S2 + 'stones_01.ogg', pitch=0.8, lp=4000), 0.45, -14)])
@rec('steel_a')
def _(): return L(NB + 'ExplosionMetal.wav', hp=25, pitch=0.85)
@rec('steel_b')
def _(): return mix([(L('cannon_hit_cannon_1.ogg', hp=25, pitch=0.9), 0, 0), (L(IM + 'bong1.wav', pitch=0.5), 0.02, -10)])
@rec('egun_a')
def _(): return L('cannon_fire_0.ogg', pitch=0.75, lp=2500, hp=25)
@rec('egun_b')
def _(): return mix([(L(NB + 'GunShotGverb.wav', pitch=0.7, lp=2200, hp=25), 0, 0), (L(NB + 'GunShotGverb.wav', pitch=0.66, lp=1500), 0.7, -9)])
@rec('near_a')
def _(): return mix([(L('cannon_hit_0.ogg', hp=25, pitch=0.8), 0, 0), (L(BF + 'rock_falling_02.ogg', pitch=0.8, lp=5000), 0.5, -12)])
@rec('near_b')
def _(): return mix([(L('ship_destroyed_1.ogg', 2.95, 3.0, hp=25, pitch=0.85), 0, 0), (L(S2 + 'stones_02.ogg', lp=5000), 0.6, -14)])
@rec('hit_a')
def _(): return mix([(L(NB + 'ExplosionMetal.wav', hp=25, pitch=0.7), 0, 0), (L(MW + 'metal_slam_01.ogg', pitch=0.5), 0.0, -4),
                     (L(IM + 'bong1.wav', pitch=0.45), 0.02, -6), (L(BF + 'metal_falling_02.ogg', pitch=0.8), 0.5, -12)])
@rec('hit_b')
def _(): return mix([(L('cannon_hit_cannon_1.ogg', hp=25, pitch=0.75), 0, 0), (L(S1 + 'slam_03.ogg', pitch=0.5), 0, -4),
                     (L(IM + 'bong1.wav', pitch=0.38), 0.03, -7), (L(BF + 'metal_falling_04.ogg', pitch=0.85), 0.6, -12)])
@rec('thunder_a', maxdur=5.0)
def _(): return L(S2 + 'thunder_01.ogg', hp=25)

# ---------------- заряжание: лёгкие бытовые металлы на 0.5–0.7 ниже — тяжёлая сталь
@rec('bopen_a')
def _(): return mix([(L(MW + 'metal_open_01.ogg', pitch=0.6, hp=60), 0, 0), (L(MW + 'lock_open_01.ogg', pitch=0.7, hp=60), 0.35, -4)])
@rec('bopen_b')
def _(): return mix([(L('x/DoorLockSounds/DoorLockSounds/UnlockDoor.wav', pitch=0.6, hp=60), 0, 0), (L(MW + 'metal_open_01.ogg', pitch=0.55, hp=60), 0.25, -3)])
@rec('bclose_a')
def _(): return mix([(L(MW + 'metal_close_01.ogg', pitch=0.6, hp=50), 0, -2), (L(S1 + 'door_close_03.ogg', pitch=0.6, hp=40), 0.3, 0), (L(S1 + 'key_open_01.ogg', pitch=0.75, hp=200), 0.6, -8)])
@rec('bclose_b')
def _(): return mix([(L(MW + 'metal_slam_01.ogg', pitch=0.55, hp=40), 0, 0), (L(MW + 'metal_close_01.ogg', pitch=0.7, hp=100), 0.3, -6)])
@rec('ram_a')
def _(): return mix([(L('x/steam_hisses/steam hisses - Marker #1.wav', 0, 0.5, lp=6000), 0, -6), (L(S1 + 'slam_03.ogg', pitch=0.55, hp=30), 0.22, 0)])
@rec('ram_b')
def _(): return mix([(L('x/steam_hisses/steam hisses - Marker #3.wav', 0, 0.45, lp=6000), 0, -7), (L(S1 + 'slam_02.ogg', pitch=0.55, hp=30), 0.2, 0)])
@rec('charge_a')
def _(): return L(S1 + 'hit_01.ogg', pitch=0.6, lp=3000, hp=40)
@rec('charge_b')
def _(): return L(S1 + 'hit_02.ogg', pitch=0.6, lp=3000, hp=40)
@rec('unload')
def _(): return mix([(L(BF + 'metal_falling_01.ogg', pitch=0.7), 0, 0), (L(S1 + 'slam_04.ogg', pitch=0.6), 0.75, -4)])
@rec('hoist_start')
def _(): return mix([(L('x/Circuit%20Breaker/switch on.wav', pitch=0.7, hp=100), 0, 0), (L(WI + 'Marker #5.wav', 0.0, 0.5), 0.12, -3)])
@rec('hoist_loop', loop=True)
def _(): return L(WI + 'Marker 2.wav', 0.3, 3.2, hp=40)
@rec('hoist_stop')
def _(): return mix([(L(MW + 'metal_slam_01.ogg', pitch=0.6, hp=40), 0, 0), (L(WI + 'Marker #9.wav', 2.2, 0.5), 0.05, -8)])

# ---------------- органы управления: настоящие щелчки
@rec('tick_a')
def _(): return L(CC + 'click21.wav', hp=200)
@rec('tick_b')
def _(): return L(CC + 'click27.wav', hp=200)
@rec('tick_c')
def _(): return L(CC + 'click26.wav', hp=200)
@rec('det_a')
def _(): return L(TC + 'click.9.ogg', hp=150)
@rec('det_b')
def _(): return L(CC + 'click28.wav', hp=150)
@rec('det_c')
def _(): return L(CC + 'click4.wav', hp=150)
@rec('clunk_a')
def _(): return L(S1 + 'door_close_03.ogg', pitch=0.7, hp=40)
@rec('clunk_b')
def _(): return L(S1 + 'slam_04.ogg', pitch=0.7, hp=40)
@rec('lever_a')
def _(): return L(MI + 'metal_interaction2.wav', pitch=0.8, hp=60)
@rec('lever_b')
def _(): return mix([(L(MI + 'metal_interaction1.wav', pitch=0.8, hp=60), 0, 0), (L(MS + 'lightclunk1.wav', pitch=0.8, hp=60), 0.15, 0)])
@rec('toggle_a')
def _(): return L('x/lightswitch_1/light_switch_turn_on.mp3', hp=150)
@rec('toggle_b')
def _(): return L('x/lightswitch_1/light_switch_turn_off.mp3', hp=150)
@rec('button_a')
def _(): return L(MI + 'metal_button_press1.wav', hp=100)
@rec('button_b')
def _(): return L(MI + 'metal_button_press2.wav', hp=100)
@rec('sel_a')
def _(): return L('switch_strength_stove_01.ogg', hp=150)
@rec('sel_b')
def _(): return L(TC + 'click.3.ogg', hp=150)
@rec('relay_a')
def _(): return L(S2 + 'switch_01.ogg', hp=200)
@rec('relay_b')
def _(): return L(S2 + 'switch_02.ogg', hp=200)
@rec('cover_a')
def _(): return L(MS + 'squeakyclick1.wav', hp=150)
@rec('cover_b')
def _(): return L(MS + 'squeakyclick2.wav', hp=150)
@rec('drum_a')
def _(): return L(MS + 'typewriter.wav', hp=200)
@rec('drum_b')
def _(): return L(CC + 'click17.wav', hp=200)
@rec('drum_c')
def _(): return L(CC + 'click12.wav', hp=200)
@rec('bell')
def _(): return L(S1 + 'bell_01.ogg', hp=300)
@rec('paper_a')
def _(): return L(S1 + 'paper_01.ogg', hp=300)
@rec('paper_b')
def _(): return L(S1 + 'paper_02.ogg', hp=300)
@rec('pin')
def _(): return L(CC + 'click30.wav', hp=200)
@rec('loupe')
def _(): return L(IM + 'clink3.wav', hp=300)

# ---------------- зенитка: короткие хлопки (петарды) на 0.6 ниже + звон металла; очередь собрана из них
def aashot(i):
    s = [BG + 'shot_01.ogg', BG + 'shot_02.ogg', BG + 'shot_03.ogg'][i % 3]
    return mix([(L(s, pitch=0.62, hp=40), 0, 0), (L(MW + 'metal_hit_0%d.ogg' % (1 + i % 4), pitch=0.8, hp=200), 0.04, -16)])
@rec('aa_a')
def _(): return aashot(0)
@rec('aa_b')
def _(): return aashot(1)
@rec('aa_c')
def _(): return aashot(2)
@rec('aa_loop', loop=True)
def _():
    shots = [trim(aashot(i)) for i in range(4)]
    period = 0.11; n = 16                           # 9 выстрелов/с, спарка: стволы по очереди
    layers = [(shots[i % 4], i * period + (0.006 if i % 2 else 0), -1.5 if i % 2 else 0) for i in range(n + 6)]
    x = mix(layers)
    return x[: int((n * period + 0.3) * SR)]       # петля n·period + запас на склейку
@rec('aa_tail')
def _(): return mix([(L(BF + 'metal_falling_03.ogg', pitch=1.1), 0, 0), (L(BF + 'metal_falling_05.ogg', pitch=1.2), 0.25, -4)])
@rec('jam')
def _(): return mix([(L(MW + 'metal_hit_03.ogg', pitch=0.7), 0, 0), (L(S1 + 'slam_01.ogg', pitch=0.7), 0.03, -4)])
@rec('overheat')
def _(): return mix([(L('x/steam_hisses/steam hisses - Marker #2.wav', 0, 1.0, lp=7000), 0, 0), (L('x/steam_hisses/steam hisses - Marker #4.wav', 0, 1.0, lp=7000), 0.6, -2)])

# ---------------- петли механизмов
@rec('slew_loop', loop=True)
def _(): return mix([(L('loop_generator_1.mp3', 0.3, 4.0, lp=3000, hp=70), 0, 0), (L('fan_interval.wav', 0, 3.0, pitch=0.8, lp=3000, hp=100)[:int(4.0 * SR)], 0, -14)])
@rec('plane_loop', loop=True)
def _(): return L('airplane_prop.flac', 0.2, 4.6)
@rec('siren_shot', maxdur=6.5)
def _(): return L('storm_3_siren.ogg', 38.0, 6.5, hp=200, lp=2400)
@rec('siren_loop', loop=True)
def _(): return L('storm_3_siren.ogg', 39.3, 6.5, hp=200, lp=2400)

# ---------------- радио
@rec('ether', loop=True, kbps=64)
def _(): return L('radio_noise_loop.wav', 10.0, 4.0)
@rec('sq_open')
def _(): return mix([(L(S2 + 'switch_01.ogg', hp=300), 0, -6), (L('radio_noise_loop.wav', 20.0, 0.12), 0.01, 0)])
@rec('sq_close')
def _(): return mix([(L('radio_noise_loop.wav', 30.0, 0.18), 0, 0), (L(S2 + 'switch_02.ogg', hp=300), 0.17, -6)])

# ---------------- фон (стерео — уличные слои)
@rec('bed_room', loop=True, kbps=64)
def _(): return L(NB + 'BattleShipMovementAmbient.wav', 1.0, 7.0, lp=2500, hp=25)
@rec('bed_machine', loop=True, kbps=64)
def _(): return L(S2 + 'loop_machine_01.ogg', 0, 6.5, pitch=0.7, hp=25, lp=4000)
@rec('bed_air', loop=True, kbps=112, ch=2)
def _():
    w = L('wave_01_cc0-18363__jasinski__alkaibeach.flac', ch=2); w2 = L('wave_02_cc0-18363__jasinski__alkaibeach.flac', ch=2)
    wind = L('windy_ambiance_0.ogg', 40, 10.0, ch=2, lp=3000)
    return mix([(wind, 0, -4), (w, 0.3, 0), (w2, 4.4, -2)], ch=2)[: int(8.0 * SR)]
@rec('bed_storm', loop=True, kbps=112, ch=2)
def _(): return mix([(L('storm_arwen_2022.flac', 60.0, 8.0, ch=2, hp=30), 0, 0), (L('x/Rain%20MP3/1.mp3', 2.0, 8.0, ch=2, hp=300), 0, -3)], ch=2)
@rec('bed_tension', loop=True, kbps=64)
def _(): return L('x/sfx_loops/noise_01.ogg', 0, 3.5, pitch=0.5, lp=1200, hp=25)
@rec('bed_wind', loop=True, kbps=64)
def _(): return L('windy_ambiance_0.ogg', 90, 6.0)
@rec('creak_a')
def _(): return L('tree_creak.flac', 1.8, 1.6, pitch=0.7, hp=60)
@rec('creak_b')
def _(): return L(MW + 'wood_squeak_01.ogg', pitch=0.55, hp=60)
@rec('creak_c')
def _(): return L('old_elevator_door.mp3', 0.0, 1.7, pitch=0.8, hp=60)

if __name__ == '__main__':
    only = set(sys.argv[2:])
    for name, (fn, kw) in R.items():
        if only and name not in only: continue
        x = fn()
        ch = kw.get('ch', 1)
        if x.shape[1] != ch: x = np.repeat(x.mean(axis=1, keepdims=True), ch, axis=1)
        write(name, x, loop=kw.get('loop', False), kbps=kw.get('kbps', 96), maxdur=kw.get('maxdur', 3.0))
