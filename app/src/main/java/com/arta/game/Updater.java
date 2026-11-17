package com.arta.game;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Обновление игры без переустановки приложения. Игра — это набор веб-файлов; свежая версия лежит
 * в репозитории (BuildConfig.UPDATE_URLS). Приложение скачивает её во внутреннее хранилище, проверяет
 * целостность и открывает вместо встроенной. Встроенная в APK версия всегда остаётся запасной:
 * если скачанная версия дважды подряд не смогла запуститься, она помечается неисправной и больше
 * не используется.
 *
 * Настройки (SharedPreferences "ota"):
 *   version — самая новая скачанная версия; good — последняя версия, подтвердившая успешный запуск;
 *   bad — версия, признанная неисправной; boot_v / boot_n — версия и число её неподтверждённых запусков;
 *   base — адрес канала, если манифест сообщил о переезде.
 */
final class Updater {
    private static final String TAG = "ArtaUpdater";
    private static final String PREFS = "ota";
    private static final long CHECK_INTERVAL_MS = 2 * 60 * 1000;
    private static final long RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
    private static final int MAX_BOOT_ATTEMPTS = 2;
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static volatile long lastCheck = 0;
    private static volatile int failedVersion = 0;
    private static volatile long failedAt = 0;
    /** Скачанная и проверенная версия, которую ещё не показали (переживает пересоздание Activity). */
    private static volatile Active ready;
    private static volatile Listener listener;

    private Updater() {}

    /** Версия игры, которую можно открыть. */
    static final class Active {
        final String url;
        final int version;
        final String orientation;
        final boolean bundled, confirm;
        Active(String url, int version, String orientation, boolean bundled, boolean confirm) {
            this.url = url; this.version = version; this.orientation = orientation; this.bundled = bundled; this.confirm = confirm;
        }
    }

    interface Listener { void onUpdateReady(Active next); }

    static void setListener(Listener l) { listener = l; }

    /** Готовое к показу обновление, если оно новее показанной версии. */
    static Active readyNewerThan(int version) {
        Active r = ready;
        return r != null && r.version > version ? r : null;
    }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Скачанные версии не попадают в резервную копию: их всегда можно скачать заново. */
    private static File root(Context ctx) { return new File(ctx.getNoBackupFilesDir(), "ota"); }

    private static OtaCore.Manifest bundledManifest(Context ctx) {
        try (InputStream in = ctx.getAssets().open("www/" + OtaCore.MANIFEST)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return OtaCore.parse(new String(out.toByteArray(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            return null;
        }
    }

    private static Active downloaded(File root, int v) {
        if (v <= 0) return null;
        File dir = new File(root, OtaCore.dirName(v));
        try {
            OtaCore.Manifest m = OtaCore.parse(OtaCore.readText(new File(dir, OtaCore.MANIFEST)));
            if (m.version == v && m.minApp <= BuildConfig.VERSION_CODE && OtaCore.verify(dir, m)) {
                return new Active("file://" + new File(dir, "index.html").getAbsolutePath(), v, m.orientation, false, m.confirm);
            }
        } catch (IOException e) {
            Log.w(TAG, "downloaded version " + v + " is unusable: " + e.getMessage());
        }
        return null;
    }

    /**
     * Выбирает версию для показа: самая новая исправная скачанная → последняя подтверждённая → встроенная.
     * keepVersion — версия на экране (её каталог не удаляется при уборке).
     */
    static Active resolve(Context ctx, int keepVersion) {
        OtaCore.Manifest b = bundledManifest(ctx);
        int bundledVersion = b != null ? b.version : 0;
        Active result = new Active("file:///android_asset/www/index.html", bundledVersion, b != null ? b.orientation : "landscape", true, false);

        SharedPreferences p = prefs(ctx);
        File root = root(ctx);
        int newest = p.getInt("version", 0), good = p.getInt("good", 0), bad = p.getInt("bad", 0);
        // версия, не сумевшая запуститься несколько раз подряд, — неисправна
        if (newest != 0 && p.getInt("boot_v", 0) == newest && p.getInt("boot_n", 0) >= MAX_BOOT_ATTEMPTS && newest != good) {
            Log.w(TAG, "version " + newest + " failed to start " + MAX_BOOT_ATTEMPTS + " times, falling back");
            bad = newest;
            p.edit().putInt("bad", bad).remove("version").remove("boot_v").remove("boot_n").commit();
            newest = 0;
        }
        Active a = null;
        if (newest > bundledVersion && newest != bad) a = downloaded(root, newest);
        if (a == null && good > bundledVersion && good != bad && good != newest) a = downloaded(root, good);
        if (a != null) result = a;

        SharedPreferences.Editor ed = p.edit();
        if (newest != 0 && (a == null || a.version != newest)) ed.remove("version");
        if (good != 0 && good <= bundledVersion) ed.remove("good");
        ed.apply();

        // уборка: оставляем показываемую, выбранную и последнюю подтверждённую версии
        File[] kids = running.get() ? null : root.listFiles(); // идёт загрузка — её временный каталог не трогаем
        if (kids != null) {
            for (File k : kids) {
                String n = k.getName();
                boolean keep = (!result.bundled && n.equals(OtaCore.dirName(result.version)))
                        || (good > bundledVersion && n.equals(OtaCore.dirName(good)))
                        || (keepVersion > 0 && n.equals(OtaCore.dirName(keepVersion)));
                if (!keep) OtaCore.deleteTree(k);
            }
        }
        return result;
    }

    /** Перед открытием скачанной версии: считаем попытку запуска (сбрасывается подтверждением). */
    static void noteBootAttempt(Context ctx, Active a) {
        if (a.bundled) return;
        SharedPreferences p = prefs(ctx);
        int n = p.getInt("boot_v", 0) == a.version ? p.getInt("boot_n", 0) : 0;
        p.edit().putInt("boot_v", a.version).putInt("boot_n", n + 1).commit();
    }

    /** Версия запустилась и работает. */
    static void confirmBoot(Context ctx, Active a) {
        if (a == null || a.bundled) return;
        prefs(ctx).edit().remove("boot_v").remove("boot_n").putInt("good", a.version).apply();
    }

    private static String[] bases(Context ctx) {
        String moved = prefs(ctx).getString("base", null);
        String[] conf = BuildConfig.UPDATE_URLS.isEmpty() ? new String[0] : BuildConfig.UPDATE_URLS.split("\\|");
        if (moved == null) return conf;
        String[] all = new String[conf.length + 1];
        all[0] = moved;
        System.arraycopy(conf, 0, all, 1, conf.length);
        return all;
    }

    /** Переезд канала принимается только в пределах того же владельца на raw.githubusercontent.com. */
    private static boolean trustedBase(String url) {
        String first = BuildConfig.UPDATE_URLS.split("\\|")[0];
        int i = first.indexOf('/', "https://".length());
        int j = i < 0 ? -1 : first.indexOf('/', i + 1);
        return j > 0 && url.startsWith(first.substring(0, j + 1)) && url.endsWith("/") && !url.contains("..") && url.length() < 300;
    }

    /** Фоновая проверка обновления. Результат приходит слушателю (setListener) в главном потоке. */
    static void checkAsync(Context context, final int currentVersion) {
        final Context ctx = context.getApplicationContext();
        if (BuildConfig.UPDATE_URLS.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (lastCheck != 0 && now - lastCheck < CHECK_INTERVAL_MS) return;
        if (!running.compareAndSet(false, true)) return;
        lastCheck = now;
        new Thread(() -> {
            try {
                final int bad = prefs(ctx).getInt("bad", 0);
                IOException last = null;
                for (String base : bases(ctx)) {
                    try {
                        OtaCore.Manifest m = OtaCore.fetchManifest(base, false);
                        if (m.moved != null && trustedBase(m.moved) && !m.moved.equals(base)) prefs(ctx).edit().putString("base", m.moved).apply();
                        if (m.version <= currentVersion || m.version == bad) return;
                        if (m.minApp > BuildConfig.VERSION_CODE) { Log.i(TAG, "update " + m.version + " needs a newer app"); return; }
                        if (m.version == failedVersion && System.currentTimeMillis() - failedAt < RETRY_AFTER_FAILURE_MS) return;
                        File dir;
                        try {
                            dir = OtaCore.download(base, m, root(ctx), false);
                            if (!OtaCore.verify(dir, m)) { OtaCore.deleteTree(dir); throw new IOException("verification failed"); }
                        } catch (IOException e) {
                            failedVersion = m.version; failedAt = System.currentTimeMillis();
                            throw e;
                        }
                        prefs(ctx).edit().putInt("version", m.version).commit();
                        final Active next = new Active("file://" + new File(dir, "index.html").getAbsolutePath(), m.version, m.orientation, false, m.confirm);
                        ready = next;
                        Log.i(TAG, "update " + m.version + " downloaded");
                        new Handler(Looper.getMainLooper()).post(() -> { Listener l = listener; if (l != null) l.onUpdateReady(next); });
                        return;
                    } catch (IOException e) {
                        last = e; // пробуем следующий адрес канала
                    }
                }
                if (last != null) Log.i(TAG, "update check failed: " + last.getMessage());
            } catch (Throwable t) {
                Log.w(TAG, "update check crashed", t);
            } finally {
                running.set(false);
            }
        }, "arta-updater").start();
    }
}
