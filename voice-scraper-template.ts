// ============================================================
// 音声合成AI(voice)ジャンル: スクレイパー設定テンプレート
// ------------------------------------------------------------
// 注意: これは「テンプレート」です。実際の scrape-all.ts が
// どんな関数シグネチャ・設定オブジェクト形式を使っているかを
// 確認していないため、既存の image/video/music ジャンルの
// スクレイパー定義と同じ形に合わせて調整してください。
// (例: 既存コードが `{ name, url, category, selectors: {...} }`
//  形式ならそれに合わせる、Playwright/Cheerioどちらを使っているか
//  も既存コードに合わせる)
//
// 各サービスは料金ページのHTML構造が変わりやすく、実際に
// ブラウザでページを開いてセレクタを確認しながらでないと
// 正確なスクレイパーは組めません。特に以下は要注意:
//
// - ElevenLabs, Murf, Descript, Speechify, LOVO は料金表が
//   JSタブ切り替え・動的レンダリングのため、単純なfetch+cheerioでは
//   価格が取得できない可能性が高い(Playwright等ヘッドレスブラウザ
//   が必要になりがち)。
// - Amazon Polly / Google Cloud TTS / Azure AI Speech は
//   料金が「100万文字あたり◯ドル」という従量課金表記のため、
//   他ジャンルのような「プラン名+定額」の形にそのまま当てはめると
//   数値が正しく表示されない。base_price_amount の意味(月額 vs
//   単価)をこのジャンルだけ変える必要がある。
// - Resemble AI, Respeecher, WellSaid Labs は個別見積もり/
//   従量課金が中心で、自動スクレイピングに向かない。
//   → この3サービスは当面 manual-prices.sql での手動更新を
//     継続するのが現実的です。
// ============================================================

export const voiceScraperTargets = [
  {
    slug: "elevenlabs",
    category: "voice",
    url: "https://elevenlabs.io/pricing",
    note: "動的レンダリングの可能性あり。要Playwright確認。",
  },
  {
    slug: "murf-ai",
    category: "voice",
    url: "https://murf.ai/pricing",
    note: "月払い/年払いの表記が並ぶため、月払い列のみ抽出するセレクタ調整が必要。",
  },
  {
    slug: "descript-overdub",
    category: "voice",
    url: "https://www.descript.com/pricing",
    note: "2025年9月に価格体系が変更されたばかり。頻繁な変更に注意。",
  },
  {
    slug: "speechify",
    category: "voice",
    url: "https://speechify.com/pricing/",
    note: "Premium(個人向け)とStudio(クリエイター向け)で別ページの可能性あり。",
  },
  {
    slug: "lovo",
    category: "voice",
    url: "https://lovo.ai/pricing",
    note: "月払い/年払いの併記に注意。",
  },
  {
    slug: "resemble-ai",
    category: "voice",
    url: "https://www.resemble.ai/pricing/",
    note: "従量課金のみ。自動スクレイピング非推奨、手動更新を継続。",
    skipAutoScrape: true,
  },
  {
    slug: "wellsaid-labs",
    category: "voice",
    url: "https://www.wellsaid.io/ai-voice-pricing",
    note: "情報源により価格表記の差が大きい。要現地確認、手動更新を継続。",
    skipAutoScrape: true,
  },
  {
    slug: "noiz-ai",
    category: "voice",
    url: "https://noiz.ai/pricing",
    note: "新興サービスのため構造変更頻度が高い可能性。",
  },
  {
    slug: "amazon-polly",
    category: "voice",
    url: "https://aws.amazon.com/polly/pricing/",
    note: "従量課金(100万文字あたり)。base_price_amountの単位が他と異なる点に注意。",
  },
  {
    slug: "google-cloud-tts",
    category: "voice",
    url: "https://cloud.google.com/text-to-speech/pricing",
    note: "従量課金(100万文字あたり)。同上。",
  },
  {
    slug: "azure-ai-speech",
    category: "voice",
    url: "https://azure.microsoft.com/en-us/pricing/details/speech/",
    note: "従量課金(100万文字あたり)。同上。",
  },
  {
    slug: "respeecher",
    category: "voice",
    url: "https://www.respeecher.com/pricing",
    note: "個別見積もりが中心。自動スクレイピング非推奨、手動更新を継続。",
    skipAutoScrape: true,
  },
  {
    slug: "listnr",
    category: "voice",
    url: "https://listnr.tech/pricing",
    note: "",
  },
  {
    slug: "hypervoice",
    category: "voice",
    url: "https://www.hypervoice.ai/pricing",
    note: "Play.ht終了後の新興代替サービス。ページ構造は要確認。",
  },
];

// ------------------------------------------------------------
// 統合手順の提案:
// 1. 既存の scrape-all.ts を開き、他ジャンル(image/video/music)の
//    ターゲット配列の実際の型定義を確認する
//    (name, url, selectors, priceParser など、フィールド名を合わせる)
// 2. 上記 voiceScraperTargets を、確認した型に合わせて書き換える
// 3. skipAutoScrape: true の3サービス(resemble-ai, wellsaid-labs,
//    respeecher)は自動スクレイピング対象から除外し、
//    manual-prices.sql / update-manual-price.ts での手動更新を継続する
// 4. GitHub Actions のワークフロー(.github/workflows)を1回手動実行し、
//    実際に価格が正しく取得できるかを確認してからマージする
// ------------------------------------------------------------
