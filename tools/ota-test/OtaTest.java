import com.arta.game.OtaCore;
import java.io.*;
import java.nio.file.*;

public class OtaTest {
    static int fails = 0;
    static void check(boolean ok, String name) { System.out.println((ok ? "ok   " : "FAIL ") + name); if (!ok) fails++; }
    static boolean throwsIO(String name, ThrowingRunnable r) { try { r.run(); check(false, name + " (no exception)"); return false; } catch (IOException e) { check(true, name + " → " + e.getMessage()); return true; } catch (Exception e) { check(false, name + " (wrong exception " + e + ")"); return false; } }
    interface ThrowingRunnable { void run() throws Exception; }

    public static void main(String[] a) throws Exception {
        String base = a[0]; File root = new File(a[1]);
        // 1. нормальное обновление
        OtaCore.Manifest m = OtaCore.fetchManifest(base + "good/", true);
        check(m.version == 7 && m.orientation.equals("landscape") && m.files.size() == 3 && !m.confirm, "manifest parsed");
        File dir = OtaCore.download(base + "good/", m, root, true);
        check(dir.getName().equals("www-7") && OtaCore.verify(dir, m), "downloaded and verified");
        check(new File(dir, "js/app.js").isFile() && new File(dir, "version.json").isFile(), "nested file + manifest stored");
        check(OtaCore.parse(OtaCore.readText(new File(dir, "version.json"))).version == 7, "stored manifest re-parses");
        // повреждение после загрузки ловится проверкой
        try (FileWriter w = new FileWriter(new File(dir, "index.html"), true)) { w.write("x"); }
        check(!OtaCore.verify(dir, m), "tampered file fails verify");
        // 2. хеш не совпадает (CDN отдал старый файл)
        OtaCore.Manifest bad = OtaCore.fetchManifest(base + "badhash/", true);
        throwsIO("hash mismatch rejected", () -> OtaCore.download(base + "badhash/", bad, root, true));
        check(!new File(root, "www-8").exists() && !new File(root, "www-8.tmp").exists(), "no leftovers after failure");
        // 3. файл длиннее/короче заявленного
        OtaCore.Manifest big = OtaCore.fetchManifest(base + "bigger/", true);
        throwsIO("oversize file rejected", () -> OtaCore.download(base + "bigger/", big, root, true));
        // 4. отсутствующий файл
        OtaCore.Manifest miss = OtaCore.fetchManifest(base + "missing/", true);
        throwsIO("missing file rejected", () -> OtaCore.download(base + "missing/", miss, root, true));
        // 5. опасные манифесты
        String f = "{\"path\":\"index.html\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}";
        throwsIO("path traversal", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + ",{\"path\":\"../evil.js\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("absolute path", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + ",{\"path\":\"/etc/passwd\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("backslash path", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + ",{\"path\":\"a\\\\b\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("hidden/dot path", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + ",{\"path\":\"a/./b\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("no index.html", () -> OtaCore.parse("{\"version\":2,\"files\":[{\"path\":\"app.js\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("bad hash format", () -> OtaCore.parse("{\"version\":2,\"files\":[{\"path\":\"index.html\",\"size\":1,\"sha256\":\"zz\"}]}"));
        throwsIO("too large", () -> OtaCore.parse("{\"version\":2,\"files\":[{\"path\":\"index.html\",\"size\":99999999999,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("duplicate path", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + "," + f + "]}"));
        throwsIO("manifest as file", () -> OtaCore.parse("{\"version\":2,\"files\":[" + f + ",{\"path\":\"version.json\",\"size\":1,\"sha256\":\"" + "a".repeat(64) + "\"}]}"));
        throwsIO("not json", () -> OtaCore.parse("<html>404</html>"));
        throwsIO("version 0", () -> OtaCore.parse("{\"version\":0,\"files\":[" + f + "]}"));
        throwsIO("plain http refused", () -> OtaCore.fetchManifest(base + "good/", false));
        throwsIO("404 manifest", () -> OtaCore.fetchManifest(base + "nope/", true));
        // 6. настоящий канал обновлений по HTTPS (если сеть доступна)
        if (a.length > 2) {
            OtaCore.Manifest real = OtaCore.fetchManifest(a[2], false);
            File rd = OtaCore.download(a[2], real, new File(root, "real"), false);
            check(OtaCore.verify(rd, real), "real channel: version " + real.version + ", " + real.files.size() + " files, " + real.orientation);
        }
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
