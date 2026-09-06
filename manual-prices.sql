-- ============================================================
-- manual-prices.sql
-- ------------------------------------------------------------
-- 「手動確認待ち」の全プランの価格をまとめたマスターシート。
--
-- 使い方:
--   1. このファイルを開いて、変更したい価格の行を書き換える
--   2. 該当ブロック(またはファイル全体)をコピーして
--      SupabaseのSQL Editorに貼り付けて実行するだけ。
--   3. 値上げ・値下げなど価格改定に気づいたら、この行を書き換えて
--      再実行し、あわせてこのファイルもコミットして更新履歴を残す。
--
-- 前提: update_manual_price() 関数がSupabase側に作成済みであること。
-- ============================================================

-- ---------------------------------------------
-- Cursor: Pro+ / Ultra (自動取得不可、JS計算値)
-- ---------------------------------------------
SELECT update_manual_price('cursor', 'Pro+', '$60 / mo.', 60, 'flat');
SELECT update_manual_price('cursor', 'Ultra', '$200 / mo.', 200, 'flat');

-- ---------------------------------------------
-- Devin (旧Windsurf): bot対策により全プラン手動
-- ---------------------------------------------
SELECT update_manual_price('devin', 'Free', 'Free', 0, 'flat');
SELECT update_manual_price('devin', 'Pro', '$20 / mo.', 20, 'flat');
SELECT update_manual_price('devin', 'Max', '$200 / mo.', 200, 'flat');
SELECT update_manual_price('devin', 'Teams', '$80/mo 基本料 + $40/mo/席', 80, 'custom');

-- ---------------------------------------------
-- JetBrains AI Assistant: JS描画のため全プラン手動
-- ---------------------------------------------
SELECT update_manual_price('jetbrains-ai', 'AI Free', 'Free', 0, 'flat');
SELECT update_manual_price('jetbrains-ai', 'AI Pro', '$10 / mo.', 10, 'flat');
SELECT update_manual_price('jetbrains-ai', 'AI Ultimate', '$30 / mo.', 30, 'flat');

-- ---------------------------------------------
-- Replit: Core / Pro (JS描画のため手動)
-- ---------------------------------------------
SELECT update_manual_price('replit', 'Core', '$20 / mo.', 20, 'flat');
SELECT update_manual_price('replit', 'Pro', '$100 / mo.', 100, 'flat');

-- ---------------------------------------------
-- Google Antigravity: AI Pro / AI Ultra (公式ページに金額非表示)
-- ---------------------------------------------
SELECT update_manual_price('antigravity', 'Google AI Pro', '$20 / mo.', 20, 'flat');
SELECT update_manual_price('antigravity', 'Google AI Ultra', '$100〜$200 / mo. (段階制)', 100, 'custom');

-- ---------------------------------------------
-- ChatGPT (Codex内蔵): 価格の数字自体がJS描画のため全プラン手動
-- ---------------------------------------------
SELECT update_manual_price('chatgpt-codex', 'Free', 'Free', 0, 'flat');
SELECT update_manual_price('chatgpt-codex', 'Go', '$8 / mo.', 8, 'flat');
SELECT update_manual_price('chatgpt-codex', 'Plus', '$20 / mo.', 20, 'flat');
SELECT update_manual_price('chatgpt-codex', 'Pro (5x/20x)', '$100〜$200 / mo.', 100, 'custom');
SELECT update_manual_price('chatgpt-codex', 'Business', '$20〜$25 / user / mo.', 20, 'per_seat');

-- ---------------------------------------------
-- Trae (ByteDance): マーケティングページがJS描画のため全プラン手動
-- ---------------------------------------------
SELECT update_manual_price('trae', 'Free', 'Free', 0, 'flat');
SELECT update_manual_price('trae', 'Lite', '$3 / mo.', 3, 'flat');
SELECT update_manual_price('trae', 'Pro', '$10 / mo.', 10, 'flat');
SELECT update_manual_price('trae', 'Pro+', '$30 / mo.', 30, 'flat');
SELECT update_manual_price('trae', 'Ultra', '$100 / mo.', 100, 'flat');
