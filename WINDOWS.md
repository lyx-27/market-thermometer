# 在 Windows 上运行 · Windows Guide

市场温度计原本是 macOS 桌面组件，现已做跨平台适配，可在 **Windows 10/11** 上运行，
界面与 macOS 基本一致。核心逻辑、数据源、刷新节奏、页面与交互都没有改动。

---

## 快速开始（Windows）

前置：安装 [Node.js 18+](https://nodejs.org/)。

**方式一 · 双击即用（推荐）**
双击项目根目录的 **`start.bat`**。首次会自动 `npm install`，随后组件在后台启动，
命令行窗口会自动关闭（等同于 macOS 的 `启动组件.command`）。

**方式二 · PowerShell**
右键 **`start.ps1`** → “使用 PowerShell 运行”，或：
```
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

**方式三 · 通用命令（跨平台都一样）**
```
npm install
npm start
```
这种方式会保留一个命令行窗口，关掉它组件也会退出。

组件出现在屏幕**右上角**；鼠标悬停显示「置顶 / 刷新 / 关闭」三个按钮。数据每 45 秒刷新。

> **代理**：若 CoinGecko / DexScreener / GeckoTerminal 在你的网络被墙，先设代理再启动：
> - cmd：`set MARKET_PROXY=http://127.0.0.1:7897`
> - PowerShell：`$env:MARKET_PROXY='http://127.0.0.1:7897'`
> DefiLlama / 腾讯行情 / alternative.me 始终直连。

---

## 哪些地方在 Windows 上会不同，做了哪些适配

| 方面 | macOS 原状 | 在 Windows 上的问题 | 适配做法 |
|---|---|---|---|
| **字体** | SF / PingFang | 缺 SF/PingFang，回退到 Arial，观感与排版走样 | 字体栈加 `Segoe UI`（西文）+ `Microsoft YaHei`（中文）兜底，两端统一为干净无衬线 |
| **标题栏按钮** | 📌 emoji + `↻`/`✕` 符号 | emoji 在 Windows 是彩色 Segoe UI Emoji，字形/颜色不同 | 三个按钮改为**内联 SVG**（`currentColor`），两端像素级一致 |
| **置顶 / 跨桌面** | `setVisibleOnAllWorkspaces`、`'floating'` 层级 | Windows 不支持这些 macOS/Linux 概念 | 用 `process.platform` 判断包裹，仅 macOS/Linux 调用；Windows 用普通 `alwaysOnTop`（已在窗口构造里设置） |
| **启动脚本** | `启动组件.command`（bash，`pgrep`/`nohup`） | `.command` / `.sh` 在 Windows 不可用 | 新增 `start.bat` 与 `start.ps1` |
| **毛玻璃背景** | 半透明面板 | — | 本来就是**纯 CSS 半透明**（未用原生 vibrancy），两端表现一致，无需改动 |

**本来就一致、无需适配的部分**（都由 Electron 内置的 Chromium 渲染，两端相同）：
透明无边框窗口、拖拽移动（`-webkit-app-region`）、细滚动条（`::-webkit-scrollbar`）、
圆角与阴影、涨跌红绿、等宽数字、48h sparkline 走势图、透明度滑块、翻页交互。

---

## 已知的细微差异（可接受，非走样）

- **字体渲染**：Windows 用 ClearType、macOS 用灰度抗锯齿，笔画粗细观感会略有不同。
  这是系统级差异，无法完全消除；已用 `Segoe UI` 贴近 Windows 原生观感。
- **滚动条**：macOS 是悬浮式（不占位、滑动才出现），Windows 为常驻的 3px 细条；已尽量做细。
- **高分屏缩放**：Windows 的 125%/150% 缩放由系统处理，组件按比例整体放大；
  分数缩放下 1px 描边可能有极轻微差异。

---

## 打包成独立 `.exe`（可选）

日常推荐直接用 `start.bat`（源码方式），**无需打包**。若确实要独立可执行文件：

1. **先移除密钥**：删除或移出项目根目录的 `api key` 文件（改用环境变量 `CG_DEMO_KEY` 提供），
   以免密钥被打进产物。
2. 打包（项目已内置 `@electron/packager`）：
   ```
   npx electron-packager . MarketThermometer --platform=win32 --arch=x64 --out=dist --overwrite
   ```
3. 产物在 `dist\MarketThermometer-win32-x64\`，双击 `MarketThermometer.exe` 运行。

---

## 核心功能不变

数据源、45s 刷新、大盘页（Fear & Greed / 成交量 / Crypto / Money Flow / 美股）、
Meme Watch 页（logo / 价格 / 24h 涨幅 / 市值 / 48h 走势图）、翻页、透明度滑块——
全部保持原样，本次只做了**字体 / 图标 / 窗口调用 / 启动方式**的跨平台适配。
