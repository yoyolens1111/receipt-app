// Firebase 後台：專案設定（齒輪）→ 一般 → 你的應用程式 → 網頁應用程式 → SDK 設定與配置 → 選「Config」，複製那段 firebaseConfig。
// 這些值本身是公開的，放在網頁內是安全的（資料由 firestore.rules 保護）。
window.APP_CONFIG = {
  firebase: {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:xxxxxxxx'
  },
  // AI 型號：如 Google 推出新型號或舊型號停用，在這裏更改（Firebase 後台 AI Logic 頁面有列出可用型號）
  GEMINI_MODEL: 'gemini-2.5-flash'
};
