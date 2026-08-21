# iPhone sideload (SideStore)

Alte' Budgeting is a **hosted PWA**. This folder is a thin iOS shell
(`WKWebView`) that opens the live site so you can install it with
**SideStore + WireGuard** (or AltStore Classic). You do **not** need a Mac
that can run modern Xcode.

## Why a 15-year-old Mac cannot build this

A Mac from around 2011 tops out at OS X El Capitan or High Sierra. The last
Xcode those systems can run is **Xcode 10**, which only ships the **iOS 12**
SDK.

iPhone 14 requires **iOS 16**. iPhone 15 requires **iOS 17**. This wrapper
targets iOS 16+ and is compiled with a current Xcode on GitHub-hosted
`macos-14` runners. That cloud Mac is what produces the `.ipa`.

Pairing SideStore / generating a pairing file can still use an old computer.
Compiling for iPhone 14/15 cannot.

## Install with SideStore

1. Keep SideStore and its WireGuard / StosVPN profile running (needed to
   refresh the 7-day free Apple ID signature).
2. After this workflow has published on `main`, either:
   - In SideStore: **Sources → +** and add
     `https://github.com/Alteoziel/Budget-App/releases/download/ios-sideload/sidestore.json`
   - Or download
     [`AlteBudgeting.ipa`](https://github.com/Alteoziel/Budget-App/releases/tag/ios-sideload)
     on the iPhone, then **Share → SideStore**.
3. Trust the developer in **Settings → General → VPN & Device Management** if
   iOS asks.
4. Sign in with email/password. Passkeys and some bank-link flows are more
   reliable from Safari **Add to Home Screen** than from this wrapper.

Free Apple IDs: **3 apps** and a **7-day** refresh. SideStore refreshes over
the VPN tunnel so the old Mac does not need to stay on the same Wi-Fi.

## What the IPA is

| | |
| --- | --- |
| Bundle ID | `app.alteoziel.budgeting` |
| Loads | `https://budget-app-mauve-five.vercel.app` (`ALTStartURL` in `Info.plist`) |
| Signed by | Your Apple ID, via SideStore |
| Built by | [`.github/workflows/ios-ipa.yml`](../.github/workflows/ios-ipa.yml) |

Change the start URL in `AlteBudgeting/Info.plist` if the Vercel host changes,
then re-run **Actions → iOS IPA (SideStore) → Run workflow**.

## Safari Home Screen (no sideload)

Open the site in Safari → Share → **Add to Home Screen**. That path does not
expire every 7 days, keeps the PWA service worker, and is the better offline /
passkey install. Use SideStore when you specifically want an App Library icon
from an `.ipa`.
