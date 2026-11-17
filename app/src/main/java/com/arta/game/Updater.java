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
 * в репозитории (BuildConfig.UPDATE_URL). Приложение скачивает её во внутреннее хранилище, проверяет
 * целостность и при следующей загрузке страницы открывает уже новую версию. Встроенная в APK версия
 * всегда остаётся запасной.
 */
final class Updater {
    private static final String TAG = "ArtaUpdater";
    private static final String PREFS = "ota";
    private static final String KEY_VERSION = "version";
    private static final long MIN_CHECK_INTERVAL_MS = 10 * 60 * 1000;
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static long lastCheck = 0;

    private Updater() {}

    /** Какая версия игры сейчас должна открываться. */
    static final class Active {
        final String url;
        final int version;
        final String orientation;
        final boolean bundled;
        Active(String url, int version, String orientation, boolean bundled) { this.url = url; this.version = version; this.orientation = orientation; this.bundled = bundled; }
    }

    interface Listener { void onUpdateReady(Active next); }

    private static File root(Context ctx) { return new File(ctx.getFilesDir(), "ota"); }

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

    /** Выбирает между встроенной и скачанной версией; повреждённые и устаревшие загрузки удаляет. */
    static Active resolve(Context ctx) {
        OtaCore.Manifest b = bundledManifest(ctx);
        int bundledVersion = b != null ? b.version : 0;
        Active bundled = new Active("file:///android_asset/www/index.html", bundledVersion, b != null ? b.orientation : "landscape", true);

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int v = prefs.getInt(KEY_VERSION, 0);
        File root = root(ctx);
        Active result = bundled;
        if (v > bundledVersion) {
            File dir = new File(root, OtaCore.dirName(v));
            try {
                OtaCore.Manifest m = OtaCore.parse(OtaCore.readText(new File(dir, OtaCore.MANIFEST)));
                if (m.version == v && m.minApp <= BuildConfig.VERSION_CODE && OtaCore.verify(dir, m)) {
                    result = new Active("file://" + new File(dir, "index.html").getAbsolutePath(), v, m.orientation, false);
                }
            } catch (IOException e) {
                Log.w(TAG, "downloaded version " + v + " is unusable: " + e.getMessage());
            }
        }
        if (result.bundled && v != 0) prefs.edit().remove(KEY_VERSION).apply();
        // уборка: всё, кроме действующей версии
        File[] kids = running.get() ? null : root.listFiles(); // идёт загрузка — её временный каталог не трогаем
        if (kids != null) {
            String keep = result.bundled ? null : OtaCore.dirName(result.version);
            for (File k : kids) if (!k.getName().equals(keep)) OtaCore.deleteTree(k);
        }
        return result;
    }

    /** Фоновая проверка обновления. listener вызывается в главном потоке, когда новая версия скачана и проверена. */
    static void checkAsync(Context context, final int currentVersion, final Listener listener) {
        final Context ctx = context.getApplicationContext();
        final String base = BuildConfig.UPDATE_URL;
        if (base == null || base.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (now - lastCheck < MIN_CHECK_INTERVAL_MS && lastCheck != 0) return;
        if (!running.compareAndSet(false, true)) return;
        lastCheck = now;
        new Thread(() -> {
            try {
                OtaCore.Manifest m = OtaCore.fetchManifest(base, false);
                if (m.version <= currentVersion) return;
                if (m.minApp > BuildConfig.VERSION_CODE) { Log.i(TAG, "update " + m.version + " needs a newer app"); return; }
                File dir = OtaCore.download(base, m, root(ctx), false);
                if (!OtaCore.verify(dir, m)) { OtaCore.deleteTree(dir); return; }
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_VERSION, m.version).commit();
                final Active next = new Active("file://" + new File(dir, "index.html").getAbsolutePath(), m.version, m.orientation, false);
                Log.i(TAG, "update " + m.version + " downloaded");
                new Handler(Looper.getMainLooper()).post(() -> listener.onUpdateReady(next));
            } catch (IOException | RuntimeException e) {
                Log.i(TAG, "update check failed: " + e.getMessage());
                lastCheck = 0; // при следующем случае попробовать снова
            } finally {
                running.set(false);
            }
        }, "arta-updater").start();
    }
}
