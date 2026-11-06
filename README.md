# Blue Archive Memorial Lobby (Recollection Lobby)

Interactive 2D live wallpaper featuring over 280+ Blue Archive students and variants, built with PixiJS and Spine WebGL. Designed for [Lively Wallpaper](https://www.rocksdanister.com/lively/) on Windows and modern web browsers.

## ✨ Features

- **Spine 2D WebGL Engine**: Hardware-accelerated skeletal animation powered by PixiJS and Spine-Pixi v7.
- **Interactive Gaze & Headpat**:
  - Hold and drag mouse to have character steer gaze and head towards your cursor.
  - Headpat, cheek pull, and body touch reactions with expressive facial animations.
- **280+ Students & Alts**: Complete searchable in-wallpaper Student Selection Board with real-time switching.
- **Lively Wallpaper IPC Integration**:
  - Change student, target FPS (30 / 60 FPS), or toggle eye tracking and touch directly from the Windows tray Customize panel.
  - Automatic Power Saver: Suspends rendering when a full-screen game or window is active to save CPU/GPU.
- **Responsive Screen Cover**: Scales seamlessly for 16:9, 16:10, and 21:9 ultrawide monitors without distortion.
- **Pure Static Architecture**: Runs completely in the browser with zero backend requirements.

---

## 🚀 How to Install & Run

### 1. In Lively Wallpaper (Windows)
1. Open **Lively Wallpaper**.
2. Click the **+ Add Wallpaper** button.
3. Select **Choose a file** and point to `LivelyInfo.json` (or drag and drop this entire folder into the Lively window).
4. Right-click the wallpaper in your Lively library and select **Customize** to adjust settings.

### 2. In Any Web Browser (Local)
Run any local static server inside this directory:

```bash
# Python 3
python3 -m http.server 8080

# Or Node.js
npx serve .
```

Open `http://localhost:8080` in your browser.

### 3. Deploy to Web (GitHub Pages / Cloudflare Pages / cPanel)
Upload all files in this repository to any static web hosting service:
- **GitHub Pages**: Go to Settings → Pages → Deploy from branch (`main`).
- **Cloudflare Pages**: Connect your repo or upload files directly for instant global CDN hosting.
- **cPanel / Web Hosting**: Upload all files to `public_html/`. Make sure HTTPS/SSL is enabled.

---

## 📂 Project Structure

```text
├── index.html              # Main web application & UI modals
├── LivelyInfo.json         # Lively Wallpaper metadata and pause hooks
├── LivelyProperties.json   # Lively Wallpaper customize panel settings
├── README.md               # Documentation
├── js/
│   ├── main.js             # Core animation loop, Spine controllers, physics & IPC
│   └── students.js         # Comprehensive 280+ student dataset
└── vendor/
    ├── pixi.min.js          # Bundled PixiJS v7.4.3 runtime
    └── spine-pixi-v7.min.js # Bundled Spine Pixi runtime
```

---

## 📜 Credits & Disclaimers

- Character art, animations, and sound assets belong to **NEXON Games Co., Ltd.** & **Yostar, Inc.**
- Assets served via community CDN.
- Powered by [PixiJS](https://pixijs.com/) (MIT License) and [Esoteric Software Spine Runtime](http://esotericsoftware.com/).
