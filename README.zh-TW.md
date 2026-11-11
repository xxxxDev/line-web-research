<h1 align="center">line-web-research</h1>

<p align="center">
  <b>把 LINE Chrome 擴充套件放到本機網頁或 Electron App 執行的研究原型。</b><br>
  非官方專案，以 macOS 為對象；擴充套件要你自己準備。
</p>

<p align="center">
  <a href="README.md">English</a> · 繁體中文
</p>

> **研究用途｜非官方專案**
>
> 這是個人研究專案，用來探索「把瀏覽器擴充套件搬到一般網頁和 Electron 執行」時，相容層要怎麼做。本專案與 LINE、LY Corporation 及其關係企業沒有任何關係，也沒有得到他們的授權或認可。「LINE」名稱與標誌屬於其權利人。
>
> - 本 repo **不含** LINE 的程式碼、圖示或資源，只有用來找出要調整之函式的一小段比對字串（見[相容做法](#相容做法)）。其餘都是我們自己寫的相容層與本機服務。要執行的人必須自己取得 LINE 官方 Chrome 擴充套件。
> - 使用非官方客戶端可能違反 LINE 服務條款，帳號可能因此受限。是否使用、後果如何，由使用者自行判斷與承擔。
> - 請只用在自己的帳號、個人研究與學習。不要用於商業用途、大量或自動傳訊、廣告、騷擾或其他濫用。
> - 「未讀模式」是研究擴充套件行為的實驗功能，請尊重對方，不要用來誤導或監視別人。
> - 本軟體依現狀提供，不附帶任何保證（見 [LICENSE](LICENSE)）。

## 這是什麼

line-web-research 是一套相容層與本機服務，讓你自備的 LINE Chrome 擴充套件能在瀏覽器分頁或 Electron 裡執行。repo 分成這幾部分：

- `web/`：本機 Node 服務（只監聽 `127.0.0.1`）、入口頁與瀏覽器相容層。代替 Electron／Chrome 擴充套件環境，把 LINE 的 API 請求轉給固定白名單內的 LINE 主機。
- `electron/`：Electron 版的 main／preload／下載處理，以及 `overlay/` 裡要加進擴充套件的三個相容檔（`electron-compat.js`、`unread-mode.js`、`theme-mode.js`）。
- `scripts/prepare-electron-extension.cjs`：從你自備的 LINE 擴充套件做出 `electron/extension/`。
- `scripts/install-launchagent.sh`：把網頁版裝成 macOS 背景服務。

## 功能

- 多開：最多 8 個獨立帳號，各用固定 port。
- 未讀模式、深淺色主題與頁內彈窗。
- 附件上傳下載。
- 加密保存登入狀態。

我們加的介面文字（入口頁、按鈕、對話框）是英文；LINE 本身的畫面語言跟著 LINE 擴充套件。

## 實際畫面

列出實例的入口頁（以兩個示範實例拍攝；本 repo 不收錄 LINE 本身的畫面）：

<p>
  <img src="docs/images/portal-dark.png" alt="入口頁，深色主題" width="49%">
  <img src="docs/images/portal-light.png" alt="入口頁，淺色主題" width="49%">
</p>

## 需求

- macOS（背景服務用 launchd 和 Keychain；Electron 打包目前只做 Apple Silicon）
- Node.js 22 以上
- LINE Chrome 擴充套件 **3.7.2**（程式會檢查版本；其他版本未驗證，部分相容處理會直接拒絕執行）

## 取得 LINE 擴充套件

LINE 檔案不放在本 repo，請自己準備：

1. 在 Google Chrome 從 Chrome 線上應用程式商店安裝 [LINE](https://chromewebstore.google.com/detail/line/ophjlpahpchlmihnnnihgmmeilfjmjjc)。
2. 找到安裝後的資料夾：Chrome 設定檔下的 `Extensions/ophjlpahpchlmihnnnihgmmeilfjmjjc/3.7.2_0/`（可在 `chrome://version` 看設定檔路徑）。
3. 把整個資料夾的內容複製到本 repo 的 `vendor/line/`，讓 `vendor/line/manifest.json` 存在。

也可以設定環境變數 `LINE_EXTENSION_DIR` 指向其他位置。`vendor/` 和 `electron/extension/` 已列在 `.gitignore`，不會被 commit。請不要把這些檔案上傳或散布。

只需要擴充套件本身的檔案，不要複製 Chrome 設定檔裡的其他資料（Cookie、登入資料等）。

## 網頁版

前景執行（單一實例，登入只存在記憶體，關掉就要重登）：

```sh
npm start
```

或雙擊 `Start Web.command`，會開啟瀏覽器。

背景常駐（多開與加密保存登入）：

```sh
scripts/install-launchagent.sh
```

這會建立 `~/Library/LaunchAgents/local.line-web-research.plist`，綁定目前的 `node` 路徑與 repo 位置；移動 repo 或換 Node 版本後要重新執行。之後用 `Open XXNE Web.command` 開頁面，`Disable Background Service.command` 停止並取消自動啟動。

- 主入口固定在 `http://127.0.0.1:52426/`，第 N 個實例用 `52426 + N - 1`。
- 執行期資料在 `~/Library/Application Support/line-web-research/`：`instances.json`（實例編號）、`service.log`（只記啟動狀態）、`service.sock`（權限 0600 的控制 socket），以及 `login-vault/`。

### 登入保存與風險

背景服務會把各 session 的 LINE Cookie 用 AES-256-GCM 加密後存在 `login-vault/`，256-bit 金鑰只存在 macOS Keychain（`local.line-web-research.login-vault.v1`）。密文綁定 origin（含 port）與 session，資料夾 0700、檔案 0600。登出會清掉對應資料；沒有到期時間的 Cookie 在最後使用 90 天後失效。

這不是聊天備份。能控制你目前 macOS 帳號或讀得到該瀏覽器設定檔的程式，仍可能使用你的登入。不要分享瀏覽器設定檔、`login-vault/` 或 Keychain 金鑰。

### 相容做法

- 服務對 LINE 出示官方擴充套件的身分：轉送的每個請求都把擴充套件的 origin（`chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc`）放在 `Origin` header，`sandbox-env.js` 也讓 LTSM sandbox 框架的 `window.origin` 是同一個 origin。所以 LINE 伺服器看到的請求，就像來自官方擴充套件。
- 服務在送出 LINE 檔案時會改動這幾處，只有這幾處：在 `index.html`、`popup.html` 加入 `web-adapter.js`，並拿掉其中載入 `main.js`／`popup.js` 的 script 標籤（改由 adapter 在補好 API 後再載入）；在 `ltsmSandbox.html` 加入 `sandbox-env.js`；以及把 LTSM 3.7.2 sandbox script 裡一個 host import 從 `window.location.origin` 改成 `window.origin`。這項改寫會比對一小段 LINE 程式碼，不符就拒絕。磁碟上的原始檔案、WASM 與加解密演算法都沒有改。
- `web-adapter.js` 以瀏覽器 API 補上 Electron／Chrome 擴充套件 API，並實作未讀模式、主題與頁內彈窗。
- 安全邊界：只監聽 `127.0.0.1`、代理目的地白名單、檢查 Host／Origin／Fetch Metadata、不跟隨上游重新導向、不記錄 headers、Cookie、請求內容或 query string。

### 未讀模式

未讀模式預設關閉。點 LINE 聲音設定旁、畫有斜線的眼睛按鈕即可開啟，設定會記住。開啟時，聊天室看了不會送出已讀：頁面不把視窗焦點交給 LINE，並在頁面內直接回應 `TalkService/sendChatChecked`，請求不會送到 LINE。本機清單可能仍顯示已讀；關閉未讀模式後，下次切回視窗時開著的聊天室會照常變成已讀。

## Electron 版

```sh
cd electron
npm ci
npm run prepare-extension   # 從 vendor/line 做出 electron/extension
npm start
npm run package             # 產生 dist/XXNE-darwin-arm64/XXNE.app（ad-hoc 簽章）
```

`prepare-extension` 會複製 LINE 擴充套件，移除背景 worker 與商店更新設定、權限縮小到 `storage`、主機限 LINE 網域，並在 `index.html`／`popup.html` 載入 `overlay/` 的三個檔案。它也會寫入 Chrome 線上應用程式商店項目的 manifest `key`，讓 App 保有官方擴充套件的 ID 與 origin，LINE 伺服器會把它視為官方擴充套件。LINE 的聊天程式、驗證與加密邏輯不變。

Electron 版的資料存在 `~/Library/Application Support/LINE Electron Prototype`，與官方 LINE、Chrome 分開。App 取名 XXNE，避免和官方 LINE App 混淆。沒有 Developer ID 簽章、公證或自動更新。

## 架構

```mermaid
flowchart LR
  subgraph browser["瀏覽器分頁（127.0.0.1:52426）"]
    ui["LINE 擴充套件畫面<br/>（你自備的 vendor/line）"]
    adapter["web-adapter.js<br/>chrome.* 相容、未讀模式、<br/>主題、頁內彈窗"]
    ui --- adapter
  end
  subgraph service["本機 Node 服務（web/）"]
    server["server.cjs<br/>Host／Origin／Fetch Metadata 檢查<br/>各 session 的 Cookie"]
    vault[("login-vault/<br/>AES-256-GCM")]
    keychain[("macOS Keychain<br/>加密金鑰")]
    server --- vault
    vault -.- keychain
  end
  line["LINE 伺服器<br/>（固定主機白名單）"]
  adapter -- "同源 /proxy/&lt;host&gt;/..." --> server
  server -- HTTPS --> line
  launchd["launchd：service.cjs<br/>最多 8 個實例，各用一個 port"] --> server

  subgraph electron["Electron App（electron/）"]
    main["main.cjs + preload.cjs<br/>sandbox renderer、IPC 橋接、<br/>只允許 LINE 網域"]
    ext["electron/extension<br/>vendor/line + overlay/"]
    main --- ext
  end
  ext -- "HTTPS / WSS" --> line
```

網頁版用本機服務取代 Chrome 擴充套件環境：頁面只跟自己的 origin 溝通，由服務帶著該 session 的 Cookie，把允許的請求轉給 LINE。Electron 版直接載入處理過的擴充套件，自己連 LINE。

## 限制

- 不保證關閉頁面後還會收訊或通知。
- 截圖、螢幕分享未移植；不支援上游重新導向。
- 一般網頁無法得知下載是否完成，附件交給瀏覽器下載列表處理。
- 只在本機使用，不提供區網或公開部署。
- LINE 擴充套件更新後，相容層可能失效，需要重新驗證。

## 安全

line-web-research 只在你自己的 Mac 上執行，背景服務會把 LINE 登入狀態加密存在磁碟上。怎麼使用才安全、要注意什麼、怎麼回報漏洞，見 [SECURITY.md](SECURITY.md)。

## 參與貢獻

歡迎開 issue 與送 pull request，見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

本 repo 的程式碼以 [MIT License](LICENSE) 釋出。不包含、也不授權任何 LINE 的程式碼、商標或資源；唯一例外是 `web/server.cjs` 用來找出要調整之函式的一小段比對字串。

line-web-research 是獨立專案，並非由 LY Corporation 製作，也與其沒有關係或背書。LINE 是 LY Corporation 的商標。

由 [V-AX](https://v-ax.com) 製作。
