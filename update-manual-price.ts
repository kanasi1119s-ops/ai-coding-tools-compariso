/**
 * update-manual-price.ts
 * ------------------------------------------------------------
 * GitHub Actionsの「Run workflow」フォームから、手動確認待ちの
 * 価格を1件だけ更新するためのスクリプト。
 * 事前にSupabase側で update_manual_price() 関数を作成しておく必要がある。
 * ------------------------------------------------------------
 */

import { Pool } from "pg";

async function main() {
  const slug = process.env.SLUG;
  const planName = process.env.PLAN_NAME;
  const rawPriceText = process.env.RAW_PRICE_TEXT;
  const basePriceAmountStr = process.env.BASE_PRICE_AMOUNT;
  const priceBasis = process.env.PRICE_BASIS || "flat";
  const billingPeriod = process.env.BILLING_PERIOD || "monthly";

  if (!slug || !planName || !rawPriceText) {
    throw new Error("slug, plan_name, raw_price_text は必須の入力です。");
  }

  const basePriceAmount = basePriceAmountStr && basePriceAmountStr.trim() !== "" ? parseFloat(basePriceAmountStr) : null;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`SELECT update_manual_price($1, $2, $3, $4, $5, $6)`, [
      slug,
      planName,
      rawPriceText,
      basePriceAmount,
      priceBasis,
      billingPeriod,
    ]);
    console.log(`✅ 更新しました: [${slug}] ${planName} → ${rawPriceText}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ 更新に失敗しました:", err);
  process.exit(1);
});
