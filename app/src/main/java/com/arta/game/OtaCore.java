package com.arta.game;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Ядро обновления игры «по воздуху»: манифест версии, загрузка файлов, проверка целостности.
 * Не зависит от Android (кроме org.json) — проверяется обычным JVM-тестом.
 *
 * Манифest version.json:
 * { "version": 3, "minApp": 2, "orientation": "landscape",
 *   "files": [ { "path": "app.js", "size": 123, "sha256": "…" }, … ] }
 */
public final class OtaCore {
    public static final String MANIFEST = "version.json";
    static final int MAX_MANIFEST_BYTES = 256 * 1024;
    static final int MAX_FILES = 300;
    static final long MAX_TOTAL_BYTES = 40L * 1024 * 1024;
    private static final Pattern SAFE_PATH = Pattern.compile("[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

    private OtaCore() {}

    public static final class Entry {
        public final String path, sha256;
        public final long size;
        Entry(String path, long size, String sha256) { this.path = path; this.size = size; this.sha256 = sha256; }
    }

    public static final class Manifest {
        public int version, minApp;
        public String orientation;
        public final List<Entry> files = new ArrayList<>();
        public String raw;
    }

    /** Разбор и строгая проверка манифеста. Любое отклонение — IOException. */
    public static Manifest parse(String json) throws IOException {
        try {
            JSONObject o = new JSONObject(json);
            Manifest m = new Manifest();
            m.raw = json;
            m.version = o.getInt("version");
            m.minApp = o.optInt("minApp", 1);
            m.orientation = "portrait".equals(o.optString("orientation")) ? "portrait" : "landscape";
            if (m.version < 1) throw new IOException("bad version");
            JSONArray arr = o.getJSONArray("files");
            if (arr.length() == 0 || arr.length() > MAX_FILES) throw new IOException("bad file count");
            long total = 0;
            boolean hasIndex = false;
            Set<String> seen = new HashSet<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject f = arr.getJSONObject(i);
                String path = f.getString("path");
                long size = f.getLong("size");
                String sha = f.getString("sha256").toLowerCase(Locale.ROOT);
                if (!SAFE_PATH.matcher(path).matches() || path.contains("..") || path.length() > 200) throw new IOException("unsafe path: " + path);
                if (path.equals(MANIFEST)) throw new IOException("manifest listed as file");
                if (!seen.add(path)) throw new IOException("duplicate path: " + path);
                if (size < 0 || size > MAX_TOTAL_BYTES) throw new IOException("bad size: " + path);
                if (!SHA256.matcher(sha).matches()) throw new IOException("bad hash: " + path);
                total += size;
                if (total > MAX_TOTAL_BYTES) throw new IOException("update too large");
                if (path.equals("index.html")) hasIndex = true;
                m.files.add(new Entry(path, size, sha));
            }
            if (!hasIndex) throw new IOException("no index.html");
            return m;
        } catch (JSONException e) {
            throw new IOException("bad manifest: " + e.getMessage());
        }
    }

    private static HttpURLConnection open(String url, boolean allowHttp) throws IOException {
        if (!(url.startsWith("https://") || (allowHttp && url.startsWith("http://")))) throw new IOException("insecure url");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("Accept-Encoding", "identity");
        int code = c.getResponseCode();
        if (code != 200) { c.disconnect(); throw new IOException("HTTP " + code + " for " + url); }
        return c;
    }

    /** Загрузка небольшого текстового файла с ограничением размера. */
    public static String fetchText(String url, int maxBytes, boolean allowHttp) throws IOException {
        HttpURLConnection c = open(url, allowHttp);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (out.size() + n > maxBytes) throw new IOException("response too large");
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    public static Manifest fetchManifest(String baseUrl, boolean allowHttp) throws IOException {
        return parse(fetchText(baseUrl + MANIFEST + "?t=" + System.currentTimeMillis(), MAX_MANIFEST_BYTES, allowHttp));
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        return sb.toString();
    }

    public static String sha256(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return hex(md.digest());
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    /** Файл назначения внутри dir; отказ, если путь выходит за пределы каталога. */
    static File resolve(File dir, String path) throws IOException {
        File f = new File(dir, path);
        String root = dir.getCanonicalPath() + File.separator;
        if (!f.getCanonicalPath().startsWith(root)) throw new IOException("path escapes dir: " + path);
        return f;
    }

    /** Все файлы манифеста на месте, размеры и хеши совпадают. */
    public static boolean verify(File dir, Manifest m) {
        try {
            for (Entry e : m.files) {
                File f = resolve(dir, e.path);
                if (!f.isFile() || f.length() != e.size || !sha256(f).equals(e.sha256)) return false;
            }
            return true;
        } catch (IOException ex) {
            return false;
        }
    }

    public static String readText(File f) throws IOException {
        if (f.length() > MAX_MANIFEST_BYTES) throw new IOException("file too large");
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    public static String dirName(int version) { return "www-" + version; }

    /**
     * Скачивает версию m в root/www-&lt;version&gt;. Сначала во временный каталог, каждый файл сверяется
     * по размеру и SHA-256; при любой ошибке временный каталог удаляется и бросается IOException.
     */
    public static File download(String baseUrl, Manifest m, File root, boolean allowHttp) throws IOException {
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("cannot create " + root);
        File tmp = new File(root, dirName(m.version) + ".tmp");
        File dst = new File(root, dirName(m.version));
        deleteTree(tmp);
        if (!tmp.mkdirs()) throw new IOException("cannot create " + tmp);
        try {
            for (Entry e : m.files) {
                File out = resolve(tmp, e.path);
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);
                HttpURLConnection c = open(baseUrl + e.path + "?v=" + m.version, allowHttp);
                long got = 0;
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        got += n;
                        if (got > e.size) throw new IOException("file larger than declared: " + e.path);
                        md.update(buf, 0, n);
                        os.write(buf, 0, n);
                    }
                } finally {
                    c.disconnect();
                }
                if (got != e.size) throw new IOException("size mismatch: " + e.path);
                if (!hex(md.digest()).equals(e.sha256)) throw new IOException("hash mismatch: " + e.path);
            }
            try (OutputStream os = new FileOutputStream(new File(tmp, MANIFEST))) {
                os.write(m.raw.getBytes(StandardCharsets.UTF_8));
            }
            deleteTree(dst);
            if (!tmp.renameTo(dst)) throw new IOException("cannot move update into place");
            return dst;
        } catch (java.security.NoSuchAlgorithmException ex) {
            deleteTree(tmp);
            throw new IOException(ex);
        } catch (IOException | RuntimeException ex) {
            deleteTree(tmp);
            throw ex;
        }
    }
}
