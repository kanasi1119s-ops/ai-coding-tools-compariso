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
  
