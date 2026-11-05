# 小票簿：公司雜費收據 App

影相上載收據，AI 自動讀取韓文、日文、中文，翻譯並分類；按報告分組、查看統計，並匯出會計用的 Excel。
這是 **PWA 網頁 App**：用手機瀏覽器打開，再「加至主畫面」，就好似普通 App 一樣用。

**全部用免費方案，$0 成本：**

| 用途 | 服務 | 免費額度（以官方最新公佈為準） |
|---|---|---|
| 資料庫、登入、相片儲存 | [Supabase](https://supabase.com) | 500MB 資料庫，1GB 相片（大約 5,000 張收據） |
| AI 讀取及翻譯 | [Google Gemini](https://aistudio.google.com) | 每日有一定免費次數 |
| 寄存網站 | Netlify／GitHub Pages／Cloudflare Pages | 免費 |

---

## 設定步驟（大約 20 分鐘，只需做一次）

### 1. 建立 Supabase 項目
1. 到 <https://supabase.com> 註冊，按 **New project**。地區揀 **Singapore** 或 **Tokyo**，速度會較快。
2. 項目建立好之後，左邊選 **SQL Editor** → **New query**。
3. 打開本資料夾的 `supabase/schema.sql`，複製全部內容貼上，按 **Run**。

### 2. 只讓公司同事登入
1. 左邊選 **Authentication** → **Sign In / Providers**，關閉 **Allow new users to sign up**，咁陌生人就不能自行註冊。
2. **Authentication** → **Users** → **Add user** → **Create new user**：
   - 為每位同事輸入電郵和臨時密碼。
   - 剔選 **Auto Confirm User**。
3. 把電郵和密碼交給同事。登入後，同事可以喺「設定」自己更改密碼。

### 3. 申請免費 Gemini API key
1. 到 <https://aistudio.google.com>，用 Google 帳戶登入。
2. 按 **Get API key** → **Create API key**，複製這條 key。
3. 注意：免費版的資料可能會被 Google 用來改進產品。如果介意收據內容，可以在 Google AI Studio 開通付費方案，費用很低。

### 4. 部署 AI 翻譯功能（Edge Function）
1. Supabase 左邊選 **Edge Functions** → **Deploy a new function** → **Via Editor**。
2. 名稱必須填 `read-receipt`。
3. 刪除編輯器內原有的程式碼，貼上 `supabase/functions/read-receipt/index.ts` 的全部內容，按 **Deploy**。
4. 到 **Edge Functions** → **Secrets**，新增：
   - 名稱：`GEMINI_API_KEY`
   - 值：第 3 步複製的 key

> Gemini key 只會存喺 Supabase 伺服器，不會出現在 App 內，同事都看不到。
> 如果日後 Google 推出新型號，可以加多一個 Secret `GEMINI_MODEL`，例如 `gemini-2.5-flash`。

### 5. 填寫 `config.js`
1. Supabase 左邊選 **Project Settings** → **API**（或 **Data API**／**API Keys**）。
2. 複製 **Project URL** 和 **anon public** key。
3. 打開本資料夾的 `config.js`，填入：

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abcdxyz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...'
};
```

> anon key 本身設計為公開，放在網頁內是安全的。資料由第 1 步設定的權限保護，只有已登入的同事可以讀寫。

### 6. 發佈網站
**最簡單的方法（不需要 GitHub）：Netlify Drop**
1. 打開 <https://app.netlify.com/drop>，註冊或登入。
2. 把整個 `receipt-app` 資料夾拖進去，就會得到一個網址，例如 `https://xxx.netlify.app`。
3. 之後如果要更新，在 Netlify 該網站頁面按 **Deploys**，再拖一次資料夾就得。

**或者用 GitHub Pages：** 把資料夾內所有檔案上載到 GitHub repo，然後到 **Settings** → **Pages** → **Deploy from a branch**，揀 `main` 和 `/ (root)`。

### 7. 安裝到手機
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
- **Supabase 免費項目如果連續 7 日沒有人使用，會自動暫停。** 資料不會消失，到 Supabase 後台按 **Restore** 就可以恢復。只要每星期有人用一次，就不會暫停。
- **資料備份：** 可以定期喺「統計」揀「全部」，匯出 Excel 保存一份。
- AI 讀取錯誤時，所有欄位都可以手動修改。

## 檔案結構
```
index.html        介面
styles.css        樣式
app.js            程式
config.js         Supabase 連線設定（需要自行填寫）
manifest.webmanifest, sw.js, icons/   PWA 設定（加至主畫面用）
supabase/schema.sql                    資料庫結構及權限
supabase/functions/read-receipt/       AI 讀取收據功能（Gemini）
```
