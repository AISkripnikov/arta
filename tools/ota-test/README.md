# Проверка ядра обновления (OtaCore) на обычной JVM

`OtaTest.java` гоняет `app/src/main/java/com/arta/game/OtaCore.java` против локального HTTP-сервера с набором
каналов-заготовок (`good`, `badhash`, `bigger`, `missing` — у каждого `version.json` и каталог `v<версия>/`)
и, третьим аргументом, против настоящего канала по HTTPS:

```bash
javac -cp json.jar -d cls ../../app/src/main/java/com/arta/game/OtaCore.java OtaTest.java
java -cp cls:json.jar OtaTest http://127.0.0.1:8765/ /tmp/ota-out https://raw.githubusercontent.com/AISkripnikov/arta/HEAD/ota/
```

`json.jar` — org.json с Maven Central (`org/json/json/20240303`).
