// Firebase 後台：專案設定（齒輪）→ 一般 → 你的應用程式 → 網頁應用程式 → SDK 設定與配置 → 選「Config」，複製那段 firebaseConfig。
// 這些值本身是公開的，放在網頁內是安全的（資料由 firestore.rules 保護）。
window.APP_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyCeViClzQVcT_qjPlLIAlUYmbezYq-7eMA',
    authDomain: 'receipt-app-172f6.firebaseapp.com',
    projectId: 'receipt-app-172f6',
    storageBucket: 'receipt-app-172f6.firebasestorage.app',
    messagingSenderId: '347525525996',
    appId: '1:347525525996:web:0fdbc49b1b4a23042d10c9'
  },
  // AI 型號：如 Google 推出新型號或舊型號停用，在這裏更改（Firebase 後台 AI Logic 頁面有列出可用型號）
  GEMINI_MODEL: 'gemini-2.5-flash',
  // 後備方法（只在 Firebase AI Logic 用不到時才填）：Google AI Studio 的 Gemini API key。
  // 必須在 Google Cloud 把這條 key 限制為只限網站 yoyolens1111.github.io 及只限 Generative Language API。
  GEMINI_API_KEY: ''
};
