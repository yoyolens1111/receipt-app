# 小票簿：公司雜費收據 App

影相上載收據，AI 自動讀取韓文、日文、中文，翻譯並分類；按報告分組、查看統計，並匯出會計用的 Excel。
這是 **PWA 網頁 App**：用手機瀏覽器打開，再「加至主畫面」，就好似普通 App 一樣用。

**全部用 Firebase 免費 Spark 方案，唔使信用卡，$0 成本：**

| 用途 | Firebase 服務 | 免費額度（以官方最新公佈為準） |
|---|---|---|
| 同事登入 | Authentication（電郵＋密碼） | 足夠公司使用 |
| 收據資料及相片 | Cloud Firestore | 1GB 容量，大約 2,500 張以上收據 |
| AI 讀取及翻譯 | AI Logic（Gemini Developer API） | 每日有一定免費次數 |
| 網站寄存 | GitHub Pages（或 Firebase Hosting） | 免費 |

> 相片會壓縮後直接存入 Firestore，所以**唔需要** Cloud Storage。Cloud Storage 要升級付費方案先可以用。

---

## 設定步驟（大約 15 分鐘，只需做一次）

### 1. 建立 Firebase 專案
1. 打開 <https://console.firebase.google.com>，按 **新增專案**（Create a project），名稱例如 `receipt-app`。
   Google Analytics 可以唔開。
2. 進入專案後，喺總覽頁按 **</>（網頁）** 圖示，新增一個網頁應用程式，名稱例如 `小票簿`。
   唔使剔 Firebase Hosting。
3. 畫面會顯示一段 `firebaseConfig`。把入面嘅值複製到本資料夾 `config.js` 的 `firebase: { ... }`。

### 2. 開啟登入，並只讓公司同事使用
1. 左邊選 **Authentication** → **開始使用** → **Sign-in method**，啟用 **電子郵件／密碼**。
2. **Users** 分頁 → **新增使用者**，為每位同事輸入電郵和臨時密碼。
3. **Settings** 分頁 → **使用者動作**（User actions），取消剔選 **啟用建立（註冊）**（Enable create (sign-up)），咁陌生人就不能自行註冊。
4. 把電郵和密碼交給同事。登入後，同事可以喺「設定」自己更改密碼。

### 3. 建立資料庫
1. 左邊選 **Firestore Database** → **建立資料庫**。
   - 地區揀 **asia-east2（香港）**。地區建立後就不能更改。
   - 揀 **以正式版模式啟動**（production mode）。
2. 進入 **規則**（Rules）分頁，刪除原有內容，貼上本資料夾 `firestore.rules` 的全部內容，按 **發布**。

### 4. 開啟免費 AI（Gemini）
1. 左邊選 **AI Logic**（喺「AI」或「Build」分類下）→ **開始使用**。
2. 揀 **Gemini Developer API**（免費方案），按指示啟用。
   Firebase 會自動管理 API key，key 唔會出現喺 App 入面。
3. 如果日後 Google 停用 `gemini-2.5-flash`，在 `config.js` 的 `GEMINI_MODEL` 改成新型號就得。AI Logic 頁面會列出可用的型號。

> 注意：Gemini 免費版的資料可能會被 Google 用來改進產品。如果介意收據內容，可以改用付費方案，費用很低。

### 5. 發佈網站
**GitHub Pages（程式碼放在 GitHub repo）**
1. Repo 頁面 → **Settings** → **Pages**。
2. **Source** 揀 **Deploy from a branch**，Branch 揀 `main` 和 `/ (root)`，按 **Save**。
3. 等大約 1 分鐘，就會得到網址，例如 `https://yoyolens1111.github.io/receipt-app/`。

**或者用 Firebase Hosting：** 喺電腦安裝 Firebase CLI，然後喺本資料夾執行：

```bash
firebase init hosting
```

```bash
firebase deploy
```

### 6. 安裝到手機
- **iPhone**：用 Safari 打開網址，按分享按鈕，再按 **加至主畫面**。
- **Android**：用 Chrome 打開網址，按右上角選單，再按 **安裝應用程式**。

---

## 使用方法
- **收據**：按「＋」影相，AI 會自動填好日期、商戶、金額、貨幣、類別和明細翻譯。核對後按「儲存」。
- **統計**：可以揀本月、上月、財年（4 月至翌年 3 月）或自訂日期。可以查看趨勢圖，以及按類別、標籤、商戶、貨幣細分。
- **報告**：將收據分組，例如「26-27 KRW」或「公司旅行（首爾）」。每份報告都可以匯出 Excel。
- **設定**（齒輪）：
  - 匯率：每張收據儲存時會鎖定當時匯率。
  - 會計科目編號和名稱。
  - 更改密碼、登出。

### 會計 Excel 內容
- **雜費明細**：憑單編號、日期、科目編號、會計科目、摘要、商戶（中文及原文）、原幣、原幣金額、匯率、港幣金額、付款方式、標籤、報告、報銷狀態、提交者、明細項目。
- **科目匯總**：每個會計科目的單據數目、港幣合計、待報銷金額，以及按貨幣的合計。

---

## 注意事項
- **資料同步：** 同事新增或修改收據後，所有人的畫面會即時更新。網絡中斷時都可以繼續記錄，恢復連線後會自動同步。
- **免費額度：** Firestore 每日有 5 萬次讀取額度。小公司日常使用遠遠未到；如果超出，當日會暫停讀寫，第二日自動恢復。
- **資料備份：** 可以定期喺「統計」揀「全部」，匯出 Excel 保存一份。
- AI 讀取錯誤時，所有欄位都可以手動修改。

## 檔案結構
```
index.html        介面
styles.css        樣式
app.js            程式（Firebase Auth、Firestore、AI Logic）
config.js         Firebase 設定（需要自行填寫）
firestore.rules   資料庫權限規則（貼到 Firebase 後台）
manifest.webmanifest, sw.js, icons/   PWA 設定（加至主畫面用）
```
