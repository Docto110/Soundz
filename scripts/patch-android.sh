#!/usr/bin/env bash
# Adds what Soundz needs on top of the generated Capacitor Android project:
# mic permission, a version number that rises every build, and a fixed signing key
# (so each new APK installs over the old one and keeps your sounds).
set -euo pipefail

APP=android/app
MANIFEST=$APP/src/main/AndroidManifest.xml
GRADLE=$APP/build.gradle

[ -f "$MANIFEST" ] || { echo "Missing $MANIFEST"; exit 1; }
[ -f "$GRADLE" ] || { echo "Missing $GRADLE"; exit 1; }

# Permissions
for p in RECORD_AUDIO MODIFY_AUDIO_SETTINGS VIBRATE POST_NOTIFICATIONS RECEIVE_BOOT_COMPLETED WAKE_LOCK; do
  if ! grep -q "android.permission.$p\"" "$MANIFEST"; then
    sed -i "s#</manifest>#    <uses-permission android:name=\"android.permission.$p\" />\n</manifest>#" "$MANIFEST"
  fi
done

# Native code for DONT! mode (background random sounds)
JAVA_DIR=$APP/src/main/java/com/docto110/soundz
mkdir -p "$JAVA_DIR"
find "$APP/src/main" -name "MainActivity.*" -delete   # ours replaces the generated one
cp native/*.java "$JAVA_DIR/"
if ! grep -q "DontReceiver" "$MANIFEST"; then
  sed -i 's#</application>#    <receiver android:name=".DontReceiver" android:exported="false">\n            <intent-filter>\n                <action android:name="android.intent.action.BOOT_COMPLETED" />\n                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />\n            </intent-filter>\n        </receiver>\n    </application>#' "$MANIFEST"
fi

# Version number = build number
BUILD="${BUILD_NUMBER:-1}"
sed -i -E "s/versionCode [0-9]+/versionCode $BUILD/" "$GRADLE"
sed -i -E "s/versionName \"[^\"]*\"/versionName \"1.$BUILD\"/" "$GRADLE"

# Signing
cp keystore/soundz.jks $APP/soundz.jks
cat >> "$GRADLE" <<'EOF'

android {
    signingConfigs {
        soundz {
            storeFile file('soundz.jks')
            storePassword 'soundz-key'
            keyAlias 'soundz'
            keyPassword 'soundz-key'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.soundz
        }
    }
}
EOF

echo "Patched: version $BUILD"
grep -E "versionCode|versionName" "$GRADLE"
grep -E "uses-permission|receiver|action" "$MANIFEST"
ls "$JAVA_DIR"
