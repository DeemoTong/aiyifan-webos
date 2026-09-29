# aiyifan-webos

**English** | [简体中文](README.zh-CN.md)

An unofficial TV interface for iyf.tv on LG webOS. The current custom UI is **v0.1.22** and has been installed and tested on an LG G4. This is a personal learning and device-testing project. Videos, accounts, membership entitlements, and stream URLs come from iyf.tv's services.

## Features

| Area | Current support |
| --- | --- |
| Home and browsing | Recommendations, movies, TV series, variety shows, anime, documentaries, short dramas, and sports. Category filters and titles load dynamically from the site, with pagination. |
| Search and details | Search, synopsis, language and episode selection, and paginated site comments. Comments are read-only. |
| Watch history | Recent account and local history on the home screen; a separate sidebar category with a five-column, paginated poster grid; resume a selected episode from its saved position. |
| Sign-in | In-app QR sign-in and an official account sign-in option. Session tickets are stored on the TV for account and playback requests. The app does not save passwords. |
| Custom player | HLS playback using streams returned by the site, available quality choices, loading feedback, pause and progress controls, short-press and long-press seeking, and a fallback to the original site player. |
| Danmu | Display timed on-screen comments, turn them on or off, and choose 18, 22, 26, or 30 px text. Preferences are saved locally. |
| Remote control | Direction keys move focus, OK activates a control, and Back returns to the previous view. Comments can be focused and read one by one. |

On the LG G4, playback speed is currently limited to **1×**: higher rates could be selected in testing but the picture continued at approximately 1×. The desktop browser version offers speed choices, but that does not establish TV support. Progress from the custom player is saved locally and is not yet written back to the site's cloud history. Posting or replying to comments is not implemented. Available quality levels, ads, and playback rights depend on the site's response for each title. `shell-app/` contains a simpler site-wrapper alternative; installing it replaces the custom UI because both use the same app ID.

## Prerequisites

1. An LG webOS TV that supports Developer Mode and a computer on the same local network. Development has mainly been verified on an **LG G4**; other models need their own testing.
2. Install LG's **Developer Mode** app on the TV and sign in with an LG Developer account. Turn on **Dev Mode Status**, restart when prompted, and enable **Key Server** in the app. Initial pairing uses the one-time passphrase shown on the TV. Renew or restart Developer Mode when its session expires. See [LG's Developer Mode guide](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).
3. Install Node.js 24 or newer, including npm. The project includes [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) as a development dependency, so `npm ci` supplies the CLI without a global install.

## Run tests and preview on a computer

From the repository root in PowerShell:

```powershell
npm ci
npm test
```

To preview the web interface in a desktop browser:

```powershell
npx ares-server .\app --open
```

Desktop preview is useful for layout and basic navigation checks. The webOS QR service bridge, TV remote behavior, and media playback still require TV testing.

## Package and sideload to the TV

On the TV, confirm that **Dev Mode Status** and **Key Server** are enabled, and note its local IP address. For the first connection, run these commands from the repository root, replacing `TV_IP` with the TV's address:

```powershell
npx ares-setup-device --add tv -i "host=TV_IP" -i "port=9922" -i "username=prisoner"
npx ares-novacom --device tv --getkey
```

When `ares-novacom` prompts for a passphrase, enter the one shown in the TV's Developer Mode app. The `tv` device profile only needs to be set up once. If its connection stops working after a TV restart or a Key Server change, retrieve the key again. LG also documents the [device pairing procedure](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

Package, install, and launch the current custom UI:

```powershell
.\tools\install.ps1 -Device tv
```

The script runs `npm run package`, creates `dist/com.personal.iyftv_0.1.22_all.ipk`, then runs `ares-install` and `ares-launch`. To perform those steps separately:

```powershell
npm run package
npx ares-install --device tv .\dist\com.personal.iyftv_0.1.22_all.ipk
npx ares-launch --device tv com.personal.iyftv
```

The generated IPK in `dist/` is not committed to Git. To inspect the running TV app:

```powershell
npx ares-inspect --device tv --app com.personal.iyftv
```

## Repository layout

- `app/`: Custom TV interface, browsing, and playback logic.
- `auth-service/`: TV-side bridge for QR sign-in.
- `tools/`: Installation script and automated tests.
- `shell-app/`: Alternative app that opens the original site.
- `fallback/`: Earlier web fallback prototype.

This project is not affiliated with iyf.tv or LG. It contains no account passwords, TV pairing keys, or locally stored session data.
