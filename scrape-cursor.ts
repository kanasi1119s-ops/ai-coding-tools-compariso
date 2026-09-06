/**
 * scrape-cursor.ts
 * ------------------------------------------------------------
 * Cursor (cursor.com/pricing) の料金ページを取得し、
 * schema.sql で定義した products / plans / plan_price_snapshots
 * / pricing_sources に書き込むプロトタイプ。
 *
 * 前提: Node.js 18+ (fetch組み込み) / pg パッケージ
 *   npm install pg cheerio
 *
 * ⚠️ 注意点(正直な制約):
 *   このスクリプトは「取得できたテキストに $ 記号付き価格が
 *   含まれるブロックを正規表現で拾う」フォールバック方式です。
 *   Cursorのページは Pro / Pro+ / Ultra がタブ切り替えUIになっており、
 *   初期HTMLにはPro($20/mo)の価格しか出てこない可能性があります。
 *   本番投入前に、ブラウザの開発者ツールで実際のDOM構造
 *   (特に <script id="__NEXT_DATA__"> のような埋め込みJSON)を
 *   確認し、可能ならそちらから全プランの価格を取る方式に
 *   差し替えてください。ここではまず「動くところまで」を優先しています。
 * ------------------------------------------------------------
 */

import { Pool } from "pg";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://cursor.com/pricing";
const PRODUCT_SLUG = "cursor";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // 例: postgres://user:pass@localhost:5432/comparison_db
});

interface ParsedPlan {
  planName: string;
  rawPriceText: string;
  basePriceAmount: number | null;
  billingPeriod: "monthly" | "yearly";
  priceBasis: "flat" | "per_seat" | "custom";
}

/** 1. Fetch: ページ取得。リダイレクト先URLも記録する */
async function fetchPricingPage(): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(SOURCE_URL, {
    redirect: "follow",
    headers: { "User-Agent": "ComparisonSiteBot/0.1 (+contact: you@example.com)" },
  });

  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  // res.url は redirect: "follow" 後の最終URL
  return { html, finalUrl: res.url };
}

/** 2. Parse: 既知のプラン名と、その近傍の "$xx / mo." パターンを拾う */
function parsePricing(html: string): ParsedPlan[] {
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");

  const plans: ParsedPlan[] = [];

  // --- Hobby (Free) ---
  if (/Hobby/i.test(bodyText)) {
    plans.push({
      planName: "Hobby",
      rawPriceText: "Free",
      basePriceAmount: 0,
      billingPeriod: "monthly",
      priceBasis: "flat",
    });
  }

  // --- Individual (Pro) : "$20 / mo." のようなパターンを探す ---
  const individualMatch = bodyText.match(/Individual[\s\S]{0,40}?\$(\d+(?:\.\d+)?)\s*\/\s*mo/i);
  if (individualMatch) {
    plans.push({
      planName: "Pro",
      rawPriceText: `$${individualMatch[1]} / mo.`,
      basePriceAmount: parseFloat(individualMatch[1]),
      billingPeriod: "monthly",
      priceBasis: "flat",
    });
  } else {
    console.warn("⚠️ Individual(Pro)の価格が見つかりませんでした。DOM構造の変化を確認してください。");
  }

  // --- Pro+ / Ultra: JS計算値のため自動抽出を断念。 ---
  // 方針: プラン自体はDBに登録し、価格は「手動確認待ち」の
  //       センチネル値(MANUAL_ENTRY_REQUIRED)を入れておく。
  //       フロントエンド側はこの値を見たら「確認中」表示に切り替える。
  //       人間がサイトを見て確認でき次第、下記の手動更新用SQLを実行する。
  for (const tierName of ["Pro+", "Ultra"]) {
    if (bodyText.includes(tierName)) {
      plans.push({
        planName: tierName,
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
      });
    }
  }

  // --- Teams: "$40 / user / mo." のようなパターン ---
  const teamsMatch = bodyText.match(/Teams[\s\S]{0,40}?\$(\d+(?:\.\d+)?)\s*\/\s*user\s*\/\s*mo/i);
  if (teamsMatch) {
    plans.push({
      planName: "Teams Standard",
      rawPriceText: `$${teamsMatch[1]} / user / mo.`,
      basePriceAmount: parseFloat(teamsMatch[1]),
      billingPeriod: "monthly",
      priceBasis: "per_seat",
    });
  }

  // --- Enterprise: 常に "custom" ---
  if (/Enterprise/i.test(bodyText)) {
    plans.push({
      planName: "Enterprise",
      rawPriceText: "Custom",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "custom",
    });
  }

  return plans;
}

/** 3. Insert: products → pricing_sources → plans → plan_price_snapshots */
async function persistResults(parsedPlans: ParsedPlan[], finalUrl: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 3-1. products: なければ作成
    const productRes = await client.query(
      `INSERT INTO products (slug, display_name, official_site)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [PRODUCT_SLUG, "Cursor", "https://cursor.com"]
    );
    const productId = productRes.rows[0].id;

    // 3-2. pricing_sources: リダイレクト検知を含めて記録
    const domainChanged = new URL(finalUrl).hostname !== new URL(SOURCE_URL).hostname;
    const sourceRes = await client.query(
      `INSERT INTO pricing_sources
         (product_id, source_url, scrape_method, last_final_url, last_status, last_scraped_at, last_success_at, needs_review)
       VALUES ($1, $2, 'static', $3, $4, now(), now(), $5)
       RETURNING id`,
      [
        productId,
        SOURCE_URL,
        finalUrl,
        domainChanged ? "redirect_changed" : "ok",
        domainChanged, // ドメインが変わっていたら要レビューフラグを立てる
      ]
    );
    const sourceId = sourceRes.rows[0].id;

    if (domainChanged) {
      console.warn(`🚨 リダイレクト検知: ${SOURCE_URL} → ${finalUrl} (要確認)`);
    }

    // 3-3. plans + plan_price_snapshots
    for (const [index, plan] of parsedPlans.entries()) {
      const planRes = await client.query(
        `INSERT INTO plans (product_id, plan_name, tier_order, audience)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order
         RETURNING id`,
        [
          productId,
          plan.planName,
          index,
          plan.priceBasis === "per_seat" ? "team" : plan.planName === "Enterprise" ? "enterprise" : "individual",
        ]
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

/** メイン処理 */
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

  // 手動確認が必要なプランがあれば、更新用SQLのテンプレートを出力する
  const manualPlans = parsedPlans.filter((p) => p.rawPriceText === "MANUAL_ENTRY_REQUIRED");
  if (manualPlans.length > 0) {
    console.log("\n📋 以下のプランは価格を手動確認してください(cursor.com/pricingを開いて目視):");
    for (const p of manualPlans) {
      console.log(`\n  -- ${p.planName} の価格を確認したら、実際の金額に置き換えて実行:`);
      console.log(
        `  INSERT INTO plan_price_snapshots (plan_id, raw_price_text, base_price_amount, currency, billing_period, price_basis, source_id)\n` +
          `  SELECT id, '$XX / mo.', XX, 'USD', 'monthly', 'flat', (SELECT id FROM pricing_sources WHERE product_id = (SELECT id FROM products WHERE slug = '${PRODUCT_SLUG}') ORDER BY id DESC LIMIT 1)\n` +
          `  FROM plans WHERE product_id = (SELECT id FROM products WHERE slug = '${PRODUCT_SLUG}') AND plan_name = '${p.planName}';`
      );
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("❌ スクレイピング失敗:", err);
  process.exit(1);
});
