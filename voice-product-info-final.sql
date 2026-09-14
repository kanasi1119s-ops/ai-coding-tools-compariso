-- ============================================================
-- 音声合成AI(voice)ジャンル: products 初期データ【最終版】
-- 2026年9月 Web検索で生存確認・価格調査済み
-- ※Play.htはMeta買収により2025年12月31日にサービス終了のため
--   HyperVoiceに差し替え。Coquiは2024年1月に商用サービス終了の
--   ためListnrに差し替え。
--
-- 【投入前の確認で判明した差分】
--   当初のドラフトでは INSERT INTO product_info (slug, category, ...) と
--   なっていたが、product_info は実テーブルではなく products の
--   (slug, display_name, official_site, tagline, pros_cons) だけを
--   射影する VIEW であり、category 列は持たず display_name(NOT NULL)も
--   欠けていた。実データは products テーブルへ直接 UPSERT する形に修正。
-- ============================================================

INSERT INTO products (slug, display_name, category, official_site, tagline, pros_cons) VALUES
('elevenlabs', 'ElevenLabs', 'voice', 'https://elevenlabs.io/pricing',
  '感情表現と音声クローンの精度で業界標準',
  '◎ 最高クラスの自然さ、多言語対応 / △ 大量利用だとクレジット消費が早い'),

('murf-ai', 'Murf AI', 'voice', 'https://murf.ai/pricing',
  '動画編集統合とチーム向けテンプレートが強み',
  '◎ 動画・プレゼンとの連携が簡単 / △ 声質はElevenLabsにやや劣る'),

('descript-overdub', 'Descript (Overdub)', 'voice', 'https://www.descript.com/pricing',
  '編集ツール一体型の音声クローン(Overdub)',
  '◎ 文字起こし編集と音声が同期 / △ AI機能はクレジット制で使いすぎに注意'),

('speechify', 'Speechify', 'voice', 'https://speechify.com/pricing/',
  '読み上げ・要約に強いマルチプラットフォーム対応',
  '◎ スマホ/ブラウザ拡張が充実、月払いは年払いの2.5倍 / △ ナレーション制作用途にはStudio版が別料金'),

('lovo', 'LOVO', 'voice', 'https://lovo.ai/pricing',
  '多言語対応とAIアバター連携が特徴',
  '◎ 100以上の言語・アクセント、動画編集も内蔵 / △ Trustpilotの評価は低め(要確認)'),

('resemble-ai', 'Resemble AI', 'voice', 'https://www.resemble.ai/pricing/',
  '従量課金制のリアルタイム音声クローンAPI',
  '◎ 使った分だけの課金、ディープフェイク検知機能あり / △ 2025年に定額プラン廃止、固定費で見積もりにくい'),

('wellsaid-labs', 'WellSaid Labs', 'voice', 'https://www.wellsaid.io/ai-voice-pricing',
  'ビジネスナレーション特化の落ち着いた声質',
  '◎ 企業研修・eラーニング向けの質の高いボイス / △ 常設無料プランなし(7日間トライアルのみ)'),

('noiz-ai', 'Noiz.ai', 'voice', 'https://noiz.ai/pricing',
  '2026年新興、超高速生成と多言語吹き替え',
  '◎ 1〜3秒の高速生成、価格が非常に安い / △ 実績・サポート体制はまだ発展途上'),

('amazon-polly', 'Amazon Polly', 'voice', 'https://aws.amazon.com/polly/pricing/',
  'AWS基盤の従量課金型TTS API',
  '◎ Standardなら$4/100万文字と激安、無料枠は12ヶ月有効 / △ 声の自然さはクリエイター向けツールに劣る'),

('google-cloud-tts', 'Google Cloud Text-to-Speech', 'voice', 'https://cloud.google.com/text-to-speech/pricing',
  'Google Cloudの高精度TTS API',
  '◎ WaveNet/Neural2/Studioと品質選択肢が豊富 / △ 開発者向けAPIでUIツールではない'),

('azure-ai-speech', 'Azure AI Speech', 'voice', 'https://azure.microsoft.com/en-us/pricing/details/speech/',
  'Microsoft Azureのエンタープライズ音声API',
  '◎ 毎月50万文字無料、500以上の声・140以上の言語 / △ 個人クリエイターには複雑'),

('respeecher', 'Respeecher', 'voice', 'https://www.respeecher.com/pricing',
  '声優・キャラクター音声のプロ向け音声変換',
  '◎ 映画・ゲームでの実績豊富、倫理的な同意ベース運用 / △ ハイエンド案件は個別見積もりが中心'),

('listnr', 'Listnr', 'voice', 'https://listnr.tech/pricing',
  'ポッドキャスト制作に特化した音声生成',
  '◎ ポッドキャスト配信までワンストップ、価格が手頃 / △ 汎用ナレーション用途はやや弱め'),

('hypervoice', 'HyperVoice', 'voice', 'https://www.hypervoice.ai/pricing',
  'Play.ht終了後の移行先として台頭する新興サービス',
  '◎ 月500分・音声クローン・感情コントロール込みで低価格 / △ 新興サービスのため実績はこれから')

ON CONFLICT (slug) DO UPDATE SET
  display_name  = EXCLUDED.display_name,
  category      = EXCLUDED.category,
  official_site = EXCLUDED.official_site,
  tagline       = EXCLUDED.tagline,
  pros_cons     = EXCLUDED.pros_cons,
  updated_at    = now();
