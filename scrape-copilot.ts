/**
 * scrape-copilot.ts
 * ------------------------------------------------------------
 * GitHub Copilot (github.com/features/copilot/plans) の料金ページを
 * 取得し、schema.sql で定義したテーブルに書き込む。
 *
 * scrape-cursor.ts と同じ構造・同じテーブルを使う(product_slugだけ変える)。
 *
 * ✅ Cursorと違う良い点:
 *   このページは全プラン(Free/Pro/Pro+/Max)の価格が
 *   タブ切り替えなしで最初から静的HTMLに書かれている。
 *   そのため MANUAL_ENTRY_REQUIRED のような手動確認は不要。
 * ------------------------------------------------------------
 */

import { Pool } from "pg";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://github.com/features/copilot/plans";
const PRODUCT_SLUG = "github-copilot";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface ParsedPlan {
  planName: string;
  rawPriceText: string;
  basePriceAmount: number | null;
  billingPeriod: "monthly" | "yearly";
  priceBasis: "flat" | "per_seat" | "custom";
}

async function fetchPricingPage(): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(SOURCE_URL, {
    redirect: "follow",
    headers: { "User-Agent": "ComparisonSiteBot/0.1 (+contact: you@example.com)" },
  });

  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  return { html, finalUrl: res.url };
}

/** プラン名の直後に出てくる "$XX USD" パターンを拾う */
function parsePricing(html: string): ParsedPlan[] {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");

  const plans: ParsedPlan[] = [];

  // ⚠️ 修正履歴: 当初は「プラン名の近くの価格」を正規表現で探していたが、
  //   ページ内に "Pro" という単語が別のプランの価格近くにも出現し、
  //   Proの価格を誤って$100(Maxの値)と記録してしまう不具合があった。
  //
  //   対策: プラン名では検索せず、"$数字USD" というパターンが
  //   ページ上に登場する「順番」だけを頼りにする。
  //   GitHub Copilotの料金カードは必ず Free → Pro → Pro+ → Max の順で
  //   "$0USD" "$10USDper user / month" "$39USDper user / month"
  //   "$100USDper user / month" と並んでいるため、最初の4件を
  //   順番通りに割り当てれば安定して正しい値が取れる。
  const tierOrder = ["Free", "Pro", "Pro+", "Max"];
  const priceMatches = [...bodyText.matchAll(/\$(\d+(?:\.\d+)?)USD/g)];

  if (priceMatches.length < tierOrder.length) {
    console.warn(
      `⚠️ 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。DOM構造の変化を確認してください。`
    );
  }

  for (let i = 0; i < tierOrder.length && i < priceMatches.length; i++) {
    const amount = parseFloat(priceMatches[i][1]);
    plans.push({
      planName: tierOrder[i],
      rawPriceText: amount === 0 ? "Free" : `$${priceMatches[i][1]} USD per user / month`,
      basePriceAmount: amount,
      billingPeriod: "monthly",
      priceBasis: "flat",
    });
  }

  return plans;
}

async function persistResults(parsedPlans: ParsedPlan[], finalUrl: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productRes = await client.query(
      `INSERT INTO products (slug, display_name, official_site)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [PRODUCT_SLUG, "GitHub Copilot", "https://github.com/features/copilot"]
    );
    const productId = productRes.rows[0].id;

    const domainChanged = new URL(finalUrl).hostname !== new URL(SOURCE_URL).hostname;
    const sourceRes = await client.query(
      `INSERT INTO pricing_sources
         (product_id, source_url, scrape_method, last_final_url, last_status, last_scraped_at, last_success_at, needs_review)
       VALUES ($1, $2, 'static', $3, $4, now(), now(), $5)
       RETURNING id`,
      [productId, SOURCE_URL, finalUrl, domainChanged ? "redirect_changed" : "ok", domainChanged]
    );
    const sourceId = sourceRes.rows[0].id;

    if (domainChanged) {
      console.warn(`🚨 リダイレクト検知: ${SOURCE_URL} → ${finalUrl} (要確認)`);
    }

    for (const [index, plan] of parsedPlans.entries()) {
      const planRes = await client.query(
        `INSERT INTO plans (product_id, plan_name, tier_order, audience)
         VALUES ($1, $2, $3, 'individual')
         ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order
         RETURNING id`,
        [productId, plan.planName, index]
      );
      const planId = planRes.rows[0].id;

      await client.query(
        `INSERT INTO plan_price_snapshots
           (plan_id, raw_price_text, base_price_amount, currency, billing_period, price_basis, source_id)
         VALUES ($1, $2, $3, 'USD', $4, $5, $6)`,
        [planId, plan.rawPriceText, plan.basePriceAmount, plan.billingPeriod, plan.priceBasis, sourceId]
      );
    }

    await client.query("COMMIT");
    console.log(`✅ ${parsedPlans.length}件のプランを保存しました。`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`Fetching: ${SOURCE_URL}`);
  const { html, finalUrl } = await fetchPricingPage();

  console.log(`Parsing...`);
  const parsedPlans = parsePricing(html);

  if (parsedPlans.length === 0) {
    throw new Error("プランが1件も取得できませんでした。DOM構造の変化を疑ってください。");
  }

  console.log(`Persisting ${parsedPlans.length} plans...`);
  await persistResults(parsedPlans, finalUrl);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ スクレイピング失敗:", err);
  process.exit(1);
});
