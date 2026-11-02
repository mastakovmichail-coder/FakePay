// Настраивает сгенерированный Capacitor-проект Android для NFC-плагина.
// Запускать ПОСЛЕ `npx cap add android`:   node setup-android.js
// Скрипт безопасно запускать повторно. Зависимостей нет.
const fs = require("fs");
const path = require("path");

const base = path.resolve(process.argv[2] || __dirname);
const cfg = JSON.parse(fs.readFileSync(path.join(base, "capacitor.config.json"), "utf8"));
const pkg = cfg.appId; // local.fakepay.terminal
const pkgDir = pkg.split(".").join(path.sep);

const androidApp = path.join(base, "android", "app", "src", "main");
if (!fs.existsSync(androidApp)) {
  console.error("Папка android не найдена. Сначала выполните: npx cap add android");
  process.exit(1);
}

// 1. Java-плагин
const javaDir = path.join(androidApp, "java", pkgDir);
fs.mkdirSync(javaDir, { recursive: true });
let src = fs.readFileSync(path.join(base, "native", "NfcTapPlugin.java"), "utf8");
src = src.replace(/^package .*;/m, `package ${pkg};`);
fs.writeFileSync(path.join(javaDir, "NfcTapPlugin.java"), src);
console.log("✔ NfcTapPlugin.java скопирован");

// 2. MainActivity с регистрацией плагина
const mainActivity = `package ${pkg};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcTapPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
fs.writeFileSync(path.join(javaDir, "MainActivity.java"), mainActivity);
console.log("✔ MainActivity.java обновлён (плагин зарегистрирован)");

// 3. Разрешения в AndroidManifest.xml
const manifestPath = path.join(androidApp, "AndroidManifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
const add = [];
if (!manifest.includes("android.permission.NFC")) {
  add.push('    <uses-permission android:name="android.permission.NFC" />');
}
if (!manifest.includes("android.hardware.nfc")) {
  add.push('    <uses-feature android:name="android.hardware.nfc" android:required="false" />');
}
if (add.length) {
  manifest = manifest.replace(/(\s*)<application/, `\n${add.join("\n")}\n$1<application`);
  fs.writeFileSync(manifestPath, manifest);
}
console.log("✔ AndroidManifest.xml: разрешение NFC " + (add.length ? "добавлено" : "уже было"));

console.log("\nГотово. Дальше: npx cap sync android && npx cap open android");
