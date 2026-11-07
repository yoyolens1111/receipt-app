# 小票簿：公司雜費收據 App

影相上載收據，App 會自動做「掃描效果」，再由 AI 讀取韓文、日文、中文，翻譯並分類。收據可以按報告分組、查看統計，並匯出會計用的 Excel 及備份 ZIP。
這是 **PWA 網頁 App**：用手機瀏覽器打開，再「加至主畫面」，就好似普通 App 一樣用。

- 現時網址（GitHub Pages）：<https://yoyolens1111.github.io/receipt-app/>
- 搬到 Firebase 後的網址：<https://receipt-app-172f6.web.app>（見下面「搬網站到 Firebase Hosting」）

## 各部分分工

```
GitHub   = 程式碼（每次修改都有紀錄）＋ 自動發佈網站
Firebase = 登入帳戶、收據資料、相片、AI
```

日常使用只需要打開小票簿網站。GitHub 是存放及發佈程式碼的地方，平時不用理會。

---

## 功能
- **收據**：影相上載，按月分組，可以搜尋、篩選「待報銷／已報銷」。
- **掃描效果**：自動裁切收據、去陰影、白底黑字，相片更清楚而檔案更細。如果裁切效果不好，可以按「用原相片」。
- **AI 讀取**：自動填寫日期、商戶（中文及原文）、金額、貨幣、類別及明細翻譯。
- **統計**：可以揀本月、上月、財年（4 月至翌年 3 月）或自訂日期。有趨勢圖，亦可以按類別、標籤、商戶或貨幣細分。
- **報告**：將收據分組，例如「26-27 KRW」或「公司旅行（首爾）」。
- **匯出**：
  - **Excel**：包括憑單編號、會計科目、原幣、匯率、港幣金額等，另有科目匯總。
  - **備份 ZIP**：Excel 加全部收據相片，相片檔名對應憑單編號。
- **設定（⚙️）**：匯率、會計科目、相片處理（掃描效果、標準／高清）、AI 來源、容量用量、更改密碼。

## AI 來源（在 App「設定」中選擇）

| 來源 | 可以使用的地區 | 費用 | 需要 |
|---|---|---|---|
| **Firebase Vertex AI**（預設） | 包括香港 | 每張收據約幾分錢港幣 | Firebase 升級 Blaze 方案，並在 AI Logic 啟用「Agent Platform Gemini API」 |
| **Google AI Studio 金鑰** | 韓國等地區，**不支援香港** | 免費（繁忙時要等） | 在 aistudio.google.com 建立金鑰，貼入 App 設定 |

金鑰會儲存在 Firestore，只有已登入的成員可以讀取，不會出現在公開的程式碼。
AI 用不到時，可以手動填寫，其他功能不受影響。

## 保存紀錄（香港報稅）
按《稅務條例》第 51C 條，業務紀錄須保存**最少 7 年**，相片等電子紀錄亦可接受。

建議**每個財年結束時**：
1. 在「報告」或「統計」匯出**備份 ZIP**。
2. 交給會計師，同時自己另存一份，例如電腦、Google Drive 或 USB。

Firebase 免費容量約 1GB。容量用到 80% 時，App 會提醒你備份。

---

## 設定紀錄（已完成）
- [x] Firebase 專案 `receipt-app-172f6`，已加入網頁應用程式，設定已填入 `config.js`
- [x] Authentication：電子郵件／密碼登入
- [x] Firestore（asia-east2）及 `firestore.rules` 規則
- [x] AI Logic：Gemini Developer API
- [x] Google AI Studio 金鑰（只限 Gemini API）
- [ ] Blaze 方案、Vertex AI（Agent Platform Gemini API）
- [ ] 搬網站到 Firebase Hosting

### 新增同事帳戶
1. 打開 Firebase 後台 → **Authentication** → **Users** → **新增使用者**，輸入同事的電郵和臨時密碼。
2. 同事登入後，可以在「設定」自行更改密碼。
3. 請確保 **Settings** → **使用者動作** 已取消剔選「啟用建立（註冊）」。

---

## 升級 Blaze 及啟用 Vertex AI（日後）
1. 打開 Firebase 後台 → **用量與帳單** → **升級**，揀 **Blaze**，然後綁定信用卡。
2. 設定預算提醒，例如每月 HK$20。注意：預算只會提醒，不會自動停止收費。
3. 打開 **AI Logic** → **設定** → 在「Agent Platform Gemini API」按 **啟用必要的 API**。
4. 在小票簿的「設定」，把 AI 來源揀為 **Firebase Vertex AI**。

## 搬網站到 Firebase Hosting（日後）
所需設定（`firebase.json`、`.firebaserc`、`.github/workflows/firebase-hosting.yml`）已經準備好，只差一條部署金鑰：

1. Firebase 後台 → ⚙️ **專案設定** → **服務帳戶** → **產生新的私密金鑰**，會下載一個 `.json` 檔。
   **這個檔案等同管理員鎖匙，切勿分享或上載到公開地方。**
2. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：
   - Name：`FIREBASE_SERVICE_ACCOUNT`
   - Secret：用記事本打開剛才的 `.json` 檔，複製全部內容貼上。
3. 去 **Actions** 分頁 → 「發佈到 Firebase」→ **Run workflow**。
   完成後網站就會在 <https://receipt-app-172f6.web.app> 上線。之後每次更新程式，都會自動發佈。
4. 新網址穩定後，可以停用 GitHub Pages：repo **Settings** → **Pages** → 停用。
5. 刪除電腦上下載的 `.json` 檔。

> 搬網站不需要搬資料：收據和相片本身已經在 Firebase。

---

## 檔案結構
```
index.html        介面
styles.css        樣式
app.js            主程式（Firebase 登入、Firestore、AI、匯出）
scan.js           掃描效果（裁切、去陰影、壓縮）
config.js         Firebase 連線設定
firestore.rules   資料庫權限規則
firebase.json, .firebaserc            Firebase Hosting 設定
manifest.webmanifest, sw.js, icons/   PWA 設定（加至主畫面用）
.github/workflows/pages.yml            自動發佈到 GitHub Pages
.github/workflows/firebase-hosting.yml 自動發佈到 Firebase Hosting（設定金鑰後才會啟動）
```
