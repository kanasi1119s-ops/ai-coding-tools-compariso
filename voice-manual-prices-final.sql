-- ============================================================
-- 音声合成AI(voice)ジャンル: manual-prices.sql【最終版】
-- 2026年9月時点、Web検索で各社公式ページ/一次情報ベースの
-- 価格を確認して作成。為替や規約変更で今後ズレる可能性があるため、
-- scrape-all.ts 実装後は自動更新への切り替えを推奨します。
--
-- 【投入前の確認で判明した差分】
--   当初のドラフトは INSERT INTO manual_prices (product_slug, category,
--   plan_name, raw_price_text, base_price_amount, audience) だったが、
--   manual_prices というテーブル/ビューは存在しない。実際の運用は
--   plans テーブル + plan_price_snapshots テーブルを
--   update_manual_price(slug, plan_name, raw_price_text,
--   base_price_amount, price_basis, billing_period) 関数経由で
--   更新する形(既存の manual-prices.sql と同じパターン)。
--   この関数は「対象プランが plans に既に存在すること」を前提に
--   しているため、先に INSERT INTO plans しておく必要がある。
--   (resemble-ai / wellsaid-labs / respeecher は scrape-all.ts の
--   対象に含めないため、plans 行を作る唯一の手段がこのファイルになる)
--
--   price_basis は 'flat' | 'per_seat' | 'custom' の3種類のみ。
--   Amazon Polly / Google Cloud TTS / Azure AI Speech は「100万文字
--   あたり」の従量課金、Resemble AI Flex は「秒あたり」の従量課金、
--   Respeecher/WellSaid の Enterprise は個別見積もりのため、
--   いずれも 'custom' を採用(flatな月額サブスクではない旨はこの
--   コメントと plan_name 表記側に明記)。
-- ============================================================

-- ---------------------------------------------
-- ElevenLabs
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Starter', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Creator', 2, 'individual'),
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Pro', 3, 'team'),
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Scale', 4, 'team'),
((SELECT id FROM products WHERE slug = 'elevenlabs'), 'Business', 5, 'enterprise')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('elevenlabs', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('elevenlabs', 'Starter', '$6/月', 6, 'flat');
SELECT update_manual_price('elevenlabs', 'Creator', '$22/月', 22, 'flat');
SELECT update_manual_price('elevenlabs', 'Pro', '$99/月', 99, 'flat');
SELECT update_manual_price('elevenlabs', 'Scale', '$299/月', 299, 'flat');
SELECT update_manual_price('elevenlabs', 'Business', '$990/月', 990, 'flat');

-- ---------------------------------------------
-- Murf AI(月払い基準。年払いだと$19/$66相当)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'murf-ai'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'murf-ai'), 'Creator', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'murf-ai'), 'Business', 2, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('murf-ai', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('murf-ai', 'Creator', '$29/月', 29, 'flat');
SELECT update_manual_price('murf-ai', 'Business', '$99/月', 99, 'flat');

-- ---------------------------------------------
-- Descript(2025年9月の料金体系改定後、月払い基準)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'descript-overdub'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'descript-overdub'), 'Hobbyist', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'descript-overdub'), 'Creator', 2, 'individual'),
((SELECT id FROM products WHERE slug = 'descript-overdub'), 'Business', 3, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('descript-overdub', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('descript-overdub', 'Hobbyist', '$24/月', 24, 'flat');
SELECT update_manual_price('descript-overdub', 'Creator', '$35/月', 35, 'flat');
SELECT update_manual_price('descript-overdub', 'Business', '$65/月', 65, 'flat');

-- ---------------------------------------------
-- Speechify(月払い基準。年払いだと$139/年 ≒ $11.58/月)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'speechify'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'speechify'), 'Premium', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'speechify'), 'Studio Starter', 2, 'individual'),
((SELECT id FROM products WHERE slug = 'speechify'), 'Studio Creator', 3, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('speechify', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('speechify', 'Premium', '$29/月', 29, 'flat');
SELECT update_manual_price('speechify', 'Studio Starter', '$19/月', 19, 'flat');
SELECT update_manual_price('speechify', 'Studio Creator', '$49/月', 49, 'flat');

-- ---------------------------------------------
-- LOVO(月払い基準)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'lovo'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'lovo'), 'Basic', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'lovo'), 'Pro', 2, 'individual'),
((SELECT id FROM products WHERE slug = 'lovo'), 'Pro+', 3, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('lovo', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('lovo', 'Basic', '$24/月', 24, 'flat');
SELECT update_manual_price('lovo', 'Pro', '$48/月', 48, 'flat');
SELECT update_manual_price('lovo', 'Pro+', '$149/月', 149, 'flat');

-- ---------------------------------------------
-- Resemble AI(2025年に定額プラン廃止、従量課金Flexへ移行)
-- 自動スクレイピング対象外(従量課金のため)。plans行はこのファイルのみで作成。
-- 参考値: $0.0005/秒 ≒ 月100分利用で約$3
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'resemble-ai'), 'Flex(従量課金・開始無料)', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'resemble-ai'), 'Enterprise', 1, 'enterprise')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('resemble-ai', 'Flex(従量課金・開始無料)', '$0.0005/秒〜', 0, 'custom');
SELECT update_manual_price('resemble-ai', 'Enterprise', '要問い合わせ', NULL, 'custom');

-- ---------------------------------------------
-- WellSaid Labs(情報源により差があるため、比較的新しい情報を採用)
-- 自動スクレイピング対象外(個別見積もり中心のため)。plans行はこのファイルのみで作成。
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'wellsaid-labs'), 'Free Trial(7日間)', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'wellsaid-labs'), 'Creative', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'wellsaid-labs'), 'Business', 2, 'team'),
((SELECT id FROM products WHERE slug = 'wellsaid-labs'), 'Enterprise', 3, 'enterprise')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('wellsaid-labs', 'Free Trial(7日間)', '$0', 0, 'flat');
SELECT update_manual_price('wellsaid-labs', 'Creative', '$55/月', 55, 'flat');
SELECT update_manual_price('wellsaid-labs', 'Business', '$160/月', 160, 'flat');
SELECT update_manual_price('wellsaid-labs', 'Enterprise', '要問い合わせ', NULL, 'custom');

-- ---------------------------------------------
-- Noiz.ai(新興サービス、価格情報の裏取りは限定的)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'noiz-ai'), 'Free', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'noiz-ai'), 'Starter', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'noiz-ai'), 'Creator', 2, 'individual')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('noiz-ai', 'Free', '$0/月', 0, 'flat');
SELECT update_manual_price('noiz-ai', 'Starter', '$2.90/月', 2.9, 'flat');
SELECT update_manual_price('noiz-ai', 'Creator', '$8.90/月', 8.9, 'flat');

-- ---------------------------------------------
-- Amazon Polly(従量課金、100万文字あたりの価格)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'amazon-polly'), 'Standard(100万文字)', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'amazon-polly'), 'Neural(100万文字)', 1, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('amazon-polly', 'Standard(100万文字)', '$4.00', 4, 'custom');
SELECT update_manual_price('amazon-polly', 'Neural(100万文字)', '$16.00', 16, 'custom');

-- ---------------------------------------------
-- Google Cloud Text-to-Speech(従量課金、100万文字あたりの価格)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'google-cloud-tts'), 'Standard/WaveNet(100万文字)', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'google-cloud-tts'), 'Neural2(100万文字)', 1, 'team'),
((SELECT id FROM products WHERE slug = 'google-cloud-tts'), 'Studio(100万文字)', 2, 'enterprise')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('google-cloud-tts', 'Standard/WaveNet(100万文字)', '$4.00', 4, 'custom');
SELECT update_manual_price('google-cloud-tts', 'Neural2(100万文字)', '$16.00', 16, 'custom');
SELECT update_manual_price('google-cloud-tts', 'Studio(100万文字)', '$160.00', 160, 'custom');

-- ---------------------------------------------
-- Azure AI Speech(従量課金、100万文字あたりの価格。毎月50万文字無料)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'azure-ai-speech'), 'Neural(100万文字)', 0, 'team'),
((SELECT id FROM products WHERE slug = 'azure-ai-speech'), 'Neural HD(100万文字)', 1, 'team')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('azure-ai-speech', 'Neural(100万文字)', '$16.00', 16, 'custom');
SELECT update_manual_price('azure-ai-speech', 'Neural HD(100万文字)', '$22.00', 22, 'custom');

-- ---------------------------------------------
-- Respeecher(TTS専用プラン、月額レンジ)
-- 自動スクレイピング対象外(個別見積もり中心のため)。plans行はこのファイルのみで作成。
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'respeecher'), 'TTS Only(下限)', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'respeecher'), 'TTS Only(上限)', 1, 'individual'),
((SELECT id FROM products WHERE slug = 'respeecher'), 'Enterprise', 2, 'enterprise')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('respeecher', 'TTS Only(下限)', '$9/月〜', 9, 'custom');
SELECT update_manual_price('respeecher', 'TTS Only(上限)', '$18/月', 18, 'flat');
SELECT update_manual_price('respeecher', 'Enterprise', '要問い合わせ', NULL, 'custom');

-- ---------------------------------------------
-- Listnr
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'listnr'), 'Individual', 0, 'individual'),
((SELECT id FROM products WHERE slug = 'listnr'), 'Solo', 1, 'individual')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('listnr', 'Individual', '$15.83/月', 15.83, 'flat');
SELECT update_manual_price('listnr', 'Solo', '$32.50/月', 32.5, 'flat');

-- ---------------------------------------------
-- HyperVoice(Play.ht終了後の代替として追加)
-- ---------------------------------------------
INSERT INTO plans (product_id, plan_name, tier_order, audience) VALUES
((SELECT id FROM products WHERE slug = 'hypervoice'), 'Standard', 0, 'individual')
ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order;

SELECT update_manual_price('hypervoice', 'Standard', '$19/月', 19, 'flat');
