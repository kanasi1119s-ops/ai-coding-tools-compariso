/**
 * scrape-all.ts
 * ------------------------------------------------------------
 * 全サイト共通のスクレイピングバッチ。
 *
 * 設計方針:
 *   - SITES配列に「サイトごとの設定(URL・parse関数)」を並べるだけで
 *     新しいサイトを追加できる。
 *   - fetch → parse → persist の共通処理は1箇所にまとめる。
 *   - 1サイトの取得に失敗しても、他のサイトの処理は止めない
 *     (最後にまとめて失敗サイトを報告する)。
 *
 * 新しいサイトを追加する手順:
 *   1. 下の SITES 配列に、新しい SiteConfig を1つ追加する
 *   2. parse関数の中に「そのサイト固有の抽出ロジック」を書く
 *   3. ファイルはこれ1本のままでOK(新規ファイル作成は不要)
 * ------------------------------------------------------------
 */

import { Pool } from "pg";
import * as cheerio from "cheerio";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface ParsedPlan {
  planName: string;
  rawPriceText: string;
  basePriceAmount: number | null;
  billingPeriod: "monthly" | "yearly";
  priceBasis: "flat" | "per_seat" | "custom";
  audience?: "individual" | "team" | "enterprise";
}

interface SiteConfig {
  slug: string;
  displayName: string;
  officialSite: string;
  sourceUrl: string;
  parse: (html: string) => ParsedPlan[];
}

// ============================================================
// サイトごとの設定
// ============================================================

const cursorConfig: SiteConfig = {
  slug: "cursor",
  displayName: "Cursor",
  officialSite: "https://cursor.com",
  sourceUrl: "https://cursor.com/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    if (/Hobby/i.test(bodyText)) {
      plans.push({
        planName: "Hobby",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const individualMatch = bodyText.match(/Individual[\s\S]{0,40}?\$(\d+(?:\.\d+)?)\s*\/\s*mo/i);
    if (individualMatch) {
      plans.push({
        planName: "Pro",
        rawPriceText: `$${individualMatch[1]} / mo.`,
        basePriceAmount: parseFloat(individualMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    } else {
      console.warn("⚠️ [cursor] Individual(Pro)の価格が見つかりませんでした。");
    }

    for (const tierName of ["Pro+", "Ultra"]) {
      if (bodyText.includes(tierName)) {
        plans.push({
          planName: tierName,
          rawPriceText: "MANUAL_ENTRY_REQUIRED",
          basePriceAmount: null,
          billingPeriod: "monthly",
          priceBasis: "flat",
          audience: "individual",
        });
      }
    }

    const teamsMatch = bodyText.match(/Teams[\s\S]{0,40}?\$(\d+(?:\.\d+)?)\s*\/\s*user\s*\/\s*mo/i);
    if (teamsMatch) {
      plans.push({
        planName: "Teams Standard",
        rawPriceText: `$${teamsMatch[1]} / user / mo.`,
        basePriceAmount: parseFloat(teamsMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      });
    }

    if (/Enterprise/i.test(bodyText)) {
      plans.push({
        planName: "Enterprise",
        rawPriceText: "Custom",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      });
    }

    return plans;
  },
};

const copilotConfig: SiteConfig = {
  slug: "github-copilot",
  displayName: "GitHub Copilot",
  officialSite: "https://github.com/features/copilot",
  sourceUrl: "https://github.com/features/copilot/plans",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const tierOrder = ["Free", "Pro", "Pro+", "Max"];
    const priceMatches = [...bodyText.matchAll(/\$(\d+(?:\.\d+)?)USD/g)];

    if (priceMatches.length < tierOrder.length) {
      console.warn(
        `⚠️ [github-copilot] 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。`
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
        audience: "individual",
      });
    }

    return plans;
  },
};

const tabnineConfig: SiteConfig = {
  slug: "tabnine",
  displayName: "Tabnine",
  officialSite: "https://www.tabnine.com",
  sourceUrl: "https://www.tabnine.com/pricing/",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const tierOrder = ["Code Assistant", "Agentic Platform"];
    const priceMatches = [...bodyText.matchAll(/(\d+(?:\.\d+)?)\s*per user per month/gi)];

    if (priceMatches.length < tierOrder.length) {
      console.warn(
        `⚠️ [tabnine] 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。`
      );
    }

    for (let i = 0; i < tierOrder.length && i < priceMatches.length; i++) {
      const amount = parseFloat(priceMatches[i][1]);
      plans.push({
        planName: tierOrder[i],
        rawPriceText: `$${priceMatches[i][1]} / user / mo. (年間契約のみ)`,
        basePriceAmount: amount,
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      });
    }

    return plans;
  },
};

// 新しいサイトを増やすときはここに追加する

// ------------------------------------------------------------
// Devin (旧Windsurf): CognitionがWindsurfを買収し統合済み。
// windsurf.com/pricing は devin.ai/pricing にリダイレクトされる。
// ------------------------------------------------------------
const devinConfig: SiteConfig = {
  slug: "devin",
  displayName: "Devin (旧Windsurf)",
  officialSite: "https://devin.ai",
  sourceUrl: "https://devin.ai/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    if (/Free[\s\S]{0,20}?\$0\b/.test(bodyText)) {
      plans.push({
        planName: "Free",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const tierOrder = ["Pro", "Max"];
    const priceMatches = [...bodyText.matchAll(/\$(\d+)per month/gi)];
    for (let i = 0; i < tierOrder.length && i < priceMatches.length; i++) {
      const amount = parseFloat(priceMatches[i][1]);
      plans.push({
        planName: tierOrder[i],
        rawPriceText: `$${priceMatches[i][1]} / mo.`,
        basePriceAmount: amount,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const teamsMatch = bodyText.match(
      /Teams[\s\S]{0,150}?\$(\d+)\/month for team plan \+ \$(\d+)\/mo per full dev seat/i
    );
    if (teamsMatch) {
      plans.push({
        planName: "Teams",
        rawPriceText: `$${teamsMatch[1]}/mo 基本料 + $${teamsMatch[2]}/mo/席`,
        basePriceAmount: parseFloat(teamsMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "team",
      });
    }

    if (/Enterprise/i.test(bodyText)) {
      plans.push({
        planName: "Enterprise",
        rawPriceText: "Custom",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      });
    }

    return plans;
  },
};

// ------------------------------------------------------------
// Claude Code (Anthropic): Claude Codeという単体の価格は無く、
// Claude Free/Pro/Max/Teamプランに含まれる形で提供されている。
// そのためこの価格は「Claudeプラン全体の価格」を表しており、
// Claude Code専用の追加料金ではないことに注意。
// ------------------------------------------------------------
const claudeCodeConfig: SiteConfig = {
  slug: "claude-code",
  displayName: "Claude Code (Claudeプラン)",
  officialSite: "https://claude.com/product/claude-code",
  sourceUrl: "https://claude.com/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    if (/Free[\s\S]{0,40}?\$0\b/.test(bodyText)) {
      plans.push({
        planName: "Free",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const monthlyMatches = [...bodyText.matchAll(/\$(\d+) if billed monthly/gi)];
    const monthlyLabels = ["Pro", "Team Standard", "Team Premium"];
    for (let i = 0; i < monthlyLabels.length && i < monthlyMatches.length; i++) {
      const amount = parseFloat(monthlyMatches[i][1]);
      const isTeam = monthlyLabels[i] !== "Pro";
      plans.push({
        planName: monthlyLabels[i],
        rawPriceText: `$${monthlyMatches[i][1]} / mo.`,
        basePriceAmount: amount,
        billingPeriod: "monthly",
        priceBasis: isTeam ? "per_seat" : "flat",
        audience: isTeam ? "team" : "individual",
      });
    }

    const maxMatch = bodyText.match(/From\s*\$(\d+)/i);
    if (maxMatch) {
      plans.push({
        planName: "Max",
        rawPriceText: `$${maxMatch[1]} / mo. 〜 (Max 5x, Max 20xは$200)`,
        basePriceAmount: parseFloat(maxMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    if (/Enterprise/i.test(bodyText)) {
      plans.push({
        planName: "Enterprise",
        rawPriceText: "$20/seat + 使用量課金(APIレート)",
        basePriceAmount: 20,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      });
    }

    return plans;
  },
};

// ------------------------------------------------------------
// Kiro (AWS): Amazon Q Developerは2026年5月15日で新規契約受付を
// 終了しており、AWSはKiroという新ブランドに移行済み。
// そのためAmazon Q Developerの代わりにKiroを採用する。
// ------------------------------------------------------------
const kiroConfig: SiteConfig = {
  slug: "kiro",
  displayName: "Kiro (旧Amazon Q Developer)",
  officialSite: "https://kiro.dev",
  sourceUrl: "https://kiro.dev/pricing/",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const tierOrder = ["Free", "Pro", "Pro+", "Pro Max", "Power"];
    const priceMatches = [...bodyText.matchAll(/\$(\d+)\s*per (?:user \/ )?month/gi)];

    if (priceMatches.length < tierOrder.length) {
      console.warn(
        `⚠️ [kiro] 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。`
      );
    }

    for (let i = 0; i < tierOrder.length && i < priceMatches.length; i++) {
      const amount = parseFloat(priceMatches[i][1]);
      plans.push({
        planName: tierOrder[i],
        rawPriceText: amount === 0 ? "Free" : `$${priceMatches[i][1]} / user / mo.`,
        basePriceAmount: amount,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    return plans;
  },
};

const SITES: SiteConfig[] = [cursorConfig, copilotConfig, tabnineConfig, devinConfig, claudeCodeConfig, kiroConfig];

// ============================================================
// 共通処理(fetch → persist)
// ============================================================

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // 一般的なブラウザに近いUser-Agentにすることで、
      // bot判定によるブロック(429など)を避けやすくする
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return { html, finalUrl: res.url };
}

async function persistSite(site: SiteConfig, parsedPlans: ParsedPlan[], finalUrl: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productRes = await client.query(
      `INSERT INTO products (slug, display_name, official_site)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [site.slug, site.displayName, site.officialSite]
    );
    const productId = productRes.rows[0].id;

    const domainChanged = new URL(finalUrl).hostname !== new URL(site.sourceUrl).hostname;
    const sourceRes = await client.query(
      `INSERT INTO pricing_sources
         (product_id, source_url, scrape_method, last_final_url, last_status, last_scraped_at, last_success_at, needs_review)
       VALUES ($1, $2, 'static', $3, $4, now(), now(), $5)
       RETURNING id`,
      [productId, site.sourceUrl, finalUrl, domainChanged ? "redirect_changed" : "ok", domainChanged]
    );
    const sourceId = sourceRes.rows[0].id;

    if (domainChanged) {
      console.warn(`🚨 [${site.slug}] リダイレクト検知: ${site.sourceUrl} → ${finalUrl}`);
    }

    for (const [index, plan] of parsedPlans.entries()) {
      const planRes = await client.query(
        `INSERT INTO plans (product_id, plan_name, tier_order, audience)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, plan_name) DO UPDATE SET tier_order = EXCLUDED.tier_order
         RETURNING id`,
        [productId, plan.planName, index, plan.audience ?? "individual"]
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
    console.log(`✅ [${site.slug}] ${parsedPlans.length}件のプランを保存しました。`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function processSite(site: SiteConfig): Promise<{ slug: string; ok: boolean; error?: string }> {
  try {
    console.log(`\n--- ${site.slug} ---`);
    console.log(`Fetching: ${site.sourceUrl}`);
    const { html, finalUrl } = await fetchPage(site.sourceUrl);

    const parsedPlans = site.parse(html);
    if (parsedPlans.length === 0) {
      throw new Error("プランが1件も取得できませんでした。DOM構造の変化を疑ってください。");
    }

    await persistSite(site, parsedPlans, finalUrl);
    return { slug: site.slug, ok: true };
  } catch (err) {
    console.error(`❌ [${site.slug}] 失敗:`, err);
    return { slug: site.slug, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const results = [];
  for (const site of SITES) {
    results.push(await processSite(site));
  }

  await pool.end();

  console.log("\n=== 実行結果まとめ ===");
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.slug}${r.error ? ` — ${r.error}` : ""}`);
  }

  const anyFailed = results.some((r) => !r.ok);
  if (anyFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 予期しないエラー:", err);
  process.exit(1);
});
