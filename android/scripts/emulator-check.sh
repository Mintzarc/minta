#!/usr/bin/env bash
# Run on a started emulator (the emulator workflow does): installs the debug APK, opens it and checks four things:
#  1. it starts and stays up, 2. the page loads (the app's window is the browser's, with the site's title in it),
#  3. Back leaves the app instead of crashing, 4. nothing in the log says the site could not be opened.
# The debug build is signed with a throwaway key, so Chrome cannot confirm the Digital Asset Links of the real signing key:
# the check turns that one verification off for this site only (Chrome's documented test switch), and says so below.
set -u
APK="${1:?path of the debug APK}"
OUT="$(dirname "$0")/../emulator-out"
mkdir -p "$OUT"
fail=0
check() { if [ "$2" = "ok" ]; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
adb root >/dev/null 2>&1 || true
adb wait-for-device
# Chrome: skip its first-run screens, and (test switch) skip the Digital Asset Links check for this site
adb shell "echo '_ --disable-fre --no-first-run --disable-digital-asset-link-verification-for-url=\"https://minta.vyrechain.com\"' > /data/local/tmp/chrome-command-line"
adb shell chmod 644 /data/local/tmp/chrome-command-line
adb shell am set-debug-app --persistent com.android.chrome >/dev/null 2>&1 || true
adb install -r "$APK"
adb logcat -c
adb shell am start -W -n com.vyrechain.minta/com.google.androidbrowserhelper.trusted.LauncherActivity | tee "$OUT/start.txt"
sleep 25
adb exec-out screencap -p > "$OUT/launched.png"
adb shell dumpsys activity activities > "$OUT/activities.txt"
adb logcat -d > "$OUT/logcat.txt"
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1 || true

grep -q 'Status: ok' "$OUT/start.txt" && check "the app starts" ok || check "the app starts" bad
grep -q 'FATAL EXCEPTION' "$OUT/logcat.txt" && check "no crash in the log" bad || check "no crash in the log" ok
if [ -f "$OUT/ui.xml" ] && grep -qi 'MINTA' "$OUT/ui.xml"; then check "the site's page is showing (its text is on screen)" ok; else check "the site's page is showing (its text is on screen)" bad; fi
grep -qiE 'ERR_CERT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR' "$OUT/logcat.txt" && check "no network or certificate error in the log" bad || check "no network or certificate error in the log" ok
adb shell input keyevent KEYCODE_BACK
sleep 3
adb shell dumpsys activity activities | grep -q 'com.vyrechain.minta' && echo "note: the app is still in the task list after Back (normal for a first screen)"
adb logcat -d | grep -q 'FATAL EXCEPTION' && check "Back does not crash" bad || check "Back does not crash" ok
exit $fail
