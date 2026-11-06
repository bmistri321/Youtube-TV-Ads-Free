# Youtube-TV-ads-Free

Build an ad-free YouTube TV app for your own TV, from the official
YouTube for Android TV APK (version **7.31.300**, ARMv7).

This repository contains **only the patch** — the JavaScript that filters
ads, the scripts that inject it into the app, and the scripts that
repackage and verify the result. It does **not** contain YouTube itself,
and it does **not** contain any built APK. You build the APK yourself,
from the official APK, on your own machine, with your own signing key.

## What it produces

An installable Android TV app (`local.bishal.ytv.noads`) that looks and
behaves exactly like the stock YouTube TV app — same red icon, same
"YouTube" name, same home screen and playback — except:

1. **No ads.** The app's own ad inventory is removed from its data
   before the interface reads it, so videos play without ad breaks.
2. **A centered buffer spinner.** When a video stalls while loading,
   a small spinning ring appears in the centre of the screen. No text.
3. **It remembers your profile.** YouTube TV asks "Who's watching?"
   again after about two hours, so it shows up on almost every launch.
   This build remembers the profile you picked last time and selects it
   automatically, so the picker is skipped from the second launch on.

It installs **alongside** the stock YouTube TV app (different package
name), so the original stays untouched. Tested on a real TV — a
Changhong AI PONT (Android 11, 32-bit ARM) — where all videos play
without ads.

## What it does not do

- It does not unlock paid features, YouTube Premium, or anything you
  have not paid for. It only removes ads.
- It does not touch playback, networking, DRM, or sign-in. The app
  still signs in with your own Google account exactly as before.
- It does not change the stock YouTube app. The stock app is a
  separate package and is left alone.
- It is not a promise that ads will be gone forever. YouTube changes
  its app and its servers; a future update may need the patch to be
  re-done. Server-stitched ads (ads baked into the video stream
  itself) cannot be removed by a client-side filter.

## How it works

YouTube for Android TV is built on **Cobalt**, a web runtime: the
whole interface is a web app running inside the TV app. This patch
works by injecting a small JavaScript payload into that web app at
document start, so the payload runs before the YouTube interface
loads. Everything the patch does happens in that JavaScript, plus
two small changes to the app package itself.

### 1. The ad filter — `patches/response-filter.js`

The filter wraps `JSON.parse` and cleans YouTube's own JSON responses
before the Cobalt frontend reads them:

- In a player response it empties `adPlacements` and `adSlots` (sets
  them to `[]`) and sets `playerAds` to `false`. Some endpoints nest
  the player response one level down under `playerResponse`, and that
  is cleaned too.
- In a browse response (home screen, shelves) it drops any list item
  that carries an `adSlotRenderer` — the ad slots — from the section
  list and from each horizontal shelf list.
- It never blocks a request and never rewrites a video URL. It only
  removes the ad entries from the data the app already received.
- It is **fail-open**: if anything goes wrong while cleaning a
  response, the original parsed result is returned untouched, so the
  app keeps working.

The filter is installed once (guarded so it cannot be installed
twice) and logs `BISHAL_YTV_FILTER installed` to the console.

### 2. The buffer spinner — `patches/loading-indicator.js`

A loading overlay that shows a centered spinning ring while a video
is stalled. It replaces an earlier version that showed the text
"Video is loading..." in the bottom-left corner.

- A 64 px ring (semi-transparent white border, solid white top
  border, rotating once per second), centred with
  `position: fixed; top: 50%; left: 50%`, no text at all.
- It only appears on watch pages (`#/watch`), only when there is
  exactly one `<video>` element, and only after the video has been
  stalled for 600 ms (its `readyState` is below 2, or its
  `currentTime` is still 0). A short stall never shows it.
- It clears when the video starts playing, on `loadstart`, `pause`,
  `error` or `ended`, and it auto-clears after 30 seconds.
- It is diagnostic UX only. It never touches playback, networking,
  or DRM.

### 3. Remember the last profile — `patches/profile-remember.js`

YouTube TV shows a "Who's watching?" picker at startup. The stock app
re-asks after about two hours (`whos_watching_multi_account_cooldown_
in_minutes: 120`), so if your sessions are hours apart you see the
picker on almost every launch. This patch remembers your pick:

- **Recording:** a document click listener watches the account
  screens. When you pick a profile tile, it stores that account's
  name in `localStorage` under the key `yt.bishal.lastProfile`. It
  never records Guest, "Watch as guest", "Add account", "Add a kid",
  "Manage accounts", sign in/out, or the picker title itself, and it
  refuses the whole-picker container so a background click records
  nothing.
- **Auto-select:** a 500 ms watcher (for at most ~60 seconds per
  launch) looks for the startup picker — the page class
  `WEB_PAGE_TYPE_ACCOUNT_SELECTOR` or the "Who's watching?" title.
  When the picker appears and a profile was recorded, it finds the
  tile whose text is exactly that profile name and clicks it. If the
  click alone does not move the app off the picker after 400 ms, it
  focuses the tile and sends Enter once (some leanback builds
  activate on Enter, not click).
- **Fail-open:** if there is no recorded profile, the picker does not
  appear, or the recorded profile is not on the picker, it does
  nothing and the picker shows normally.
- **It only ever auto-selects on the startup picker**, never on the
  in-app account switcher, so a deliberate profile switch in
  Settings is never overridden.
- **First launch after installing still shows the picker once**
  (nothing is recorded yet). Pick your account once; from the next
  launch on, the picker is skipped and the app goes straight to your
  home screen.

This is DOM automation only — it replays your own click on the
profile tile. It does not read or write your credentials.

### 4. Native injection — `scripts/patch_native.py`

The JavaScript has to get into the app. The Cobalt engine already
registers a small (288-byte) document-start polyfill script that is
stored as an embedded resource inside the native library
`lib/armeabi-v7a/libchrobalt.so`. This script extends that resource
with the payload (the polyfill plus the three patches above) and
re-points the engine's existing resource pointer/length pair at the
longer buffer.

- The new payload lives in a fresh read-only `PT_LOAD` segment
  appended to the ELF. No code is hooked, no executable code is
  added, and no DRM or playback function is changed.
- **Fail-closed:** every expected hash, byte pattern and offset is
  asserted before any byte is written. The library's SHA-256 and the
  resource offset (`0x75b6b8`, measured from the 7.31.300 binary)
  are pinned in the script; any mismatch aborts the build. Nothing
  here is copied from any other version — these are this binary's
  own offsets and hashes.
- The patched library is verified with Capstone (the size
  instruction disassembles to exactly one `movw`) and with Unicorn
  emulation at three ASLR bases (the resource setup must yield the
  right pointer and size). See `scripts/test_native.py`.

### 5. DroidGuard stability fix — `scripts/patch_smali.py`

When the app is re-signed with a different key, the DroidGuard
service connection can be denied with a `SecurityException`, and
that denial used to crash the app. This patch changes one smali
method (`smali_classes2/dou.smali`, the GMS client service-broker
call) so that a denied DroidGuard connection is routed to the
method's own existing failure callback — but **only** when the
client is the DroidGuard client. Every other exception is re-thrown
exactly as before.

A denial is preserved as a failure, never forged into a success.
No attestation, token, signature or DRM behaviour is changed.
The source file hashes are pinned and the method must occur exactly
once, or the script refuses to run.

### 6. Repackaging — `scripts/repackage.py`

The decoded app tree is repackaged as a standalone app with its
own identity:

- Package `com.google.android.youtube.tv` becomes
  `local.bishal.ytv.noads` (so it installs alongside the stock app).
- Label is exactly `YouTube`, and the stock icon, banner and logo
  are untouched — the app looks exactly like stock YouTube TV.
- `versionCode` is bumped (`731300320` → `731300324` for this
  build), so updates install over the previous build.
- Process, `taskAffinity` and authority names are rewritten to the
  new package, the dynamic-receiver permission is renamed,
  `autoVerify` is forced to `false`, and Play Store split/stamp
  metadata is stripped.
- The patched `libchrobalt.so` is swapped in, and `.so` files are
  marked do-not-compress in `apktool.yml`.
- All six original native libraries are kept.

## How to build it

### Prerequisites

- The **official YouTube for Android TV APK, version 7.31.300,
  ARMv7** (`armeabi-v7a`). This patch targets that exact version
  only — the native offsets and hashes are measured from it. Get it
  from your own device or a source you trust; this repository does
  not contain it.
- Python 3.12, with `pyelftools`, `capstone` and `unicorn`
  installed (for `patch_native.py` and `test_native.py`).
- Java 21 (for apktool and apksigner).
- apktool 3.0.3.
- Android SDK Build Tools 36 (for `zipalign` and `apksigner`).
- Node.js (to run the JavaScript tests).
- Your **own signing key**. Never reuse anyone else's key, and
  never commit your key or its password to git. Keep the same key
  for every update, or the TV will refuse to install the update
  over the previous build.

### Working layout

The scripts assume a working directory laid out like this (the
paths are set at the top of each script — adjust `ROOT` to your own
directory):

```
ytv-patch/
  base/      the official APK, as youtube-tv-7.31.300-base.apk
  work/      apktool decode output (created by the build)
  patches/   the three JavaScript patches (this repo)
  scripts/   the build scripts (this repo)
  build/     intermediates (created by the build)
  out/       the finished APK (created by the build)
```

### Build steps

1. **Decode the official APK**
   ```sh
   apktool d base/youtube-tv-7.31.300-base.apk -o work/yt731300
   ```

2. **Build the patched native library**
   ```sh
   python3 scripts/patch_native.py
   ```
   This reads `work/yt731300/lib/armeabi-v7a/libchrobalt.so`, extends
   its embedded document-start resource with the JavaScript payload
   from `patches/`, and writes the patched library to
   `build/native/libchrobalt.so`. It aborts if any expected hash or
   offset does not match.

3. **Repackage the app tree**
   ```sh
   python3 scripts/repackage.py
   ```
   This copies the decoded tree to `build/apk-work`, renames the
   package, sets the label and versionCode, and swaps in the patched
   library. It refuses to run if `build/apk-work` already exists —
   archive or remove it first.

4. **Apply the DroidGuard fix**
   ```sh
   python3 scripts/patch_smali.py
   ```
   This patches `smali_classes2/dou.smali` inside `build/apk-work`.
   It must run **after** `repackage.py`, because it writes into the
   tree that script creates.

5. **Rebuild, align and sign**
   ```sh
   apktool b build/apk-work -o out/youtube-tv-noads-7.31.300-unsigned.apk
   zipalign -f -p 4 out/youtube-tv-noads-7.31.300-unsigned.apk out/youtube-tv-noads-7.31.300-aligned.apk
   apksigner sign --ks <your-keystore> --ks-pass file:<your-password-file> \
     --out out/youtube-tv-noads-7.31.300.apk out/youtube-tv-noads-7.31.300-aligned.apk
   ```
   Sign with **your own** keystore. If your key password differs
   from the keystore password, pass `--key-pass` as well. (One
   gotcha: `apksigner` needs Java on its path — set
   `JAVA_HOME` to your Java 21 install if it complains it cannot
   find a runtime.)

6. **Verify**
   ```sh
   python3 scripts/verify_apk.py out/youtube-tv-noads-7.31.300.apk
   python3 scripts/test_native.py
   apksigner verify --verbose out/youtube-tv-noads-7.31.300.apk
   zipalign -c -v 4 out/youtube-tv-noads-7.31.300.apk
   ```
   `verify_apk.py` checks the ZIP CRCs, that `resources.arsc` and
   every `.so` are stored uncompressed and 16 KiB-aligned, that the
   assets are byte-identical to the official APK, that the
   `libchrobalt.so` inside the APK is the patched one, and that the
   signature files are yours. All checks must pass.

7. **Run the JavaScript tests**
   ```sh
   node test-filter.cjs
   node test-spinner.cjs
   node test-profile.cjs
   ```
   These run the three patches in Node's `vm` against fake DOMs:
   the filter strips ad fields and keeps content (8 checks), the
   spinner shows a centred ring with no text and clears on playing,
   and the profile patch auto-selects only the recorded tile and
   records only real profile picks (8 sections).

8. **Install** (on your own TV, over ADB or however you normally
   sideload):
   ```sh
   adb install -r out/youtube-tv-noads-7.31.300.apk
   ```
   The `-r` keeps the app's data, so an update installs over the
   previous build. The first launch after installing the
   profile-remember build still shows the "Who's watching?" picker
   once — pick your account, and from the next launch it is skipped.

## How it was verified

- **JavaScript tests** (`test-filter.cjs`, `test-spinner.cjs`,
  `test-profile.cjs`) all pass in Node `vm` with fake DOMs.
- **Native patch** verified with Capstone disassembly and Unicorn
  emulation at three ASLR bases (`scripts/test_native.py`).
- **Signing and alignment**: `apksigner verify` (signature v2 and
  v3, one signer) and `zipalign -c` pass.
- **APK structure**: `scripts/verify_apk.py` — all checks pass.
- **Proven on a real TV**: installed on a Changhong AI PONT
  (Android 11, 32-bit ARM) and tested with real videos — all videos
  play without ads. The stock YouTube TV app was left installed
  alongside and untouched.

## Limitations — read this

- **Targets 7.31.300 (ARMv7) only.** The native offsets, hashes
  and smali targets are measured from that exact build. It will not
  work on another version without re-measuring.
- **No guarantee ads stay gone.** YouTube can change its app, its
  responses, or its servers at any time. If the filter stops
  matching, ads may return until the patch is updated.
- **The profile auto-select is DOM-based.** It was verified against
  a fake DOM in Node. If a future YouTube TV update changes the
  picker markup, the patch fails open — the picker simply shows
  normally — and the patch needs a re-look.
- **Personal use only.** This is for your own TV and your own
  account. Do not distribute the built APK, do not sell it, and do
  not publish it as if it were an official YouTube app. This
  project is not affiliated with, endorsed by, or connected to
  Google or YouTube in any way.

## Files

```
patches/
  response-filter.js      ad filter (wraps JSON.parse, strips ad inventory)
  loading-indicator.js    centred buffer spinner while a video stalls
  profile-remember.js     remember last profile, skip "Who's watching?"
scripts/
  patch_native.py         inject the JS payload into libchrobalt.so
  patch_smali.py          DroidGuard stability fix (smali)
  repackage.py            rename package, label, versionCode; swap in the library
  test_native.py          verify the patched library (Capstone + Unicorn)
  verify_apk.py           verify the finished APK structure
test-filter.cjs           Node vm tests for the ad filter
test-spinner.cjs          Node vm tests for the spinner
test-profile.cjs          Node vm tests for profile-remember
README.md
LICENSE
.gitignore
```

## License

MIT — see `LICENSE`. The patch code in this repository is original
work. YouTube and the YouTube logo are trademarks of Google LLC;
the official APK is Google's software and is not included here.
