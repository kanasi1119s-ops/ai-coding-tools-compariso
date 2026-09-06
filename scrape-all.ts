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
  // trueの場合、実際のfetchを行わずparse("")だけを呼ぶ。
  // bot対策が強く安定して取得できないサイト用の回避策。
  skipFetch?: boolean;
  // "coding" | "image" など。省略時は "coding" 扱い(既存サイトとの後方互換のため)。
  category?: string;
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

    // Pro+ / Ultra: JS計算値のため自動抽出を断念。手動確認待ちとして登録する。
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

    // ページ上に "$0USD" "$10USDper user/month" ... の順で並ぶ性質を利用し、
    // プラン名との近接検索ではなく「出現順」で割り当てる
    // (Proの価格をMaxの価格と誤認するバグが過去にあったための対策)。
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

    // 掲載順は必ず Code Assistant → Agentic Platform
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
// OpenAI ChatGPT (Codex内蔵): chatgpt.com/pricing は価格の数字自体が
// JavaScriptで後から挿入される形式で、静的取得では金額が一切拾えない。
// そのため手動確認待ちとする。Codex(コーディング機能)はChatGPTの
// 各プランに内蔵される形で提供され、単体の価格は存在しない。
// ------------------------------------------------------------
const chatgptConfig: SiteConfig = {
  slug: "chatgpt-codex",
  displayName: "ChatGPT (Codex内蔵)",
  officialSite: "https://chatgpt.com/codex/",
  sourceUrl: "https://chatgpt.com/pricing/",
  skipFetch: true,
  parse(html) {
    return [
      {
        planName: "Free",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Go",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Plus",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Pro (5x/20x)",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Business",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      },
      {
        planName: "Enterprise",
        rawPriceText: "Custom",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      },
    ];
  },
};

// ------------------------------------------------------------
// Augment Code: augmentcode.com/pricing は静的で読み取りやすい。
// ------------------------------------------------------------
const augmentConfig: SiteConfig = {
  slug: "augment-code",
  displayName: "Augment Code",
  officialSite: "https://www.augmentcode.com",
  sourceUrl: "https://www.augmentcode.com/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const standardMatch = bodyText.match(/STANDARD\s*\$(\d+)\/month/i);
    if (standardMatch) {
      plans.push({
        planName: "Standard",
        rawPriceText: `$${standardMatch[1]}/month (50席まで定額)`,
        basePriceAmount: parseFloat(standardMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "team",
      });
    }

    const businessMatch = bodyText.match(/BUSINESS\s*\$(\d+)\/month/i);
    if (businessMatch) {
      plans.push({
        planName: "Business",
        rawPriceText: `$${businessMatch[1]}/month (50席まで定額)`,
        basePriceAmount: parseFloat(businessMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "team",
      });
    }

    if (/ENTERPRISE\s*Custom/i.test(bodyText)) {
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
// Warp: warp.dev/pricing は静的。月額/年額の切り替えタブの両方の
// 価格が同時にHTMLへ描画されているため、"最初に出てくる方"
// (月額表示)だけを拾うようにmatch()(matchAllではなく)を使う。
// ------------------------------------------------------------
const warpConfig: SiteConfig = {
  slug: "warp",
  displayName: "Warp",
  officialSite: "https://www.warp.dev",
  sourceUrl: "https://www.warp.dev/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const freeMatch = bodyText.match(/Free[\s\S]{0,60}?\$(\d+)\/month/i);
    if (freeMatch) {
      plans.push({
        planName: "Free",
        rawPriceText: freeMatch[1] === "0" ? "Free" : `$${freeMatch[1]}/month`,
        basePriceAmount: parseFloat(freeMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const buildMatch = bodyText.match(/Build[\s\S]{0,60}?\$(\d+)\/month/i);
    if (buildMatch) {
      plans.push({
        planName: "Build",
        rawPriceText: `$${buildMatch[1]}/month〜`,
        basePriceAmount: parseFloat(buildMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const maxMatch = bodyText.match(/Max[\s\S]{0,60}?\$(\d+)\/month/i);
    if (maxMatch) {
      plans.push({
        planName: "Max",
        rawPriceText: `$${maxMatch[1]}/month〜`,
        basePriceAmount: parseFloat(maxMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const businessMatch = bodyText.match(/Business[\s\S]{0,80}?\$(\d+)\/user/i);
    if (businessMatch) {
      plans.push({
        planName: "Business",
        rawPriceText: `$${businessMatch[1]}/user/month〜`,
        basePriceAmount: parseFloat(businessMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      });
    }

    if (/Enterprise[\s\S]{0,20}?Custom/i.test(bodyText)) {
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
// Zed: zed.dev/pricing は静的で読み取りやすい。
// ------------------------------------------------------------
const zedConfig: SiteConfig = {
  slug: "zed",
  displayName: "Zed",
  officialSite: "https://zed.dev",
  sourceUrl: "https://zed.dev/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const personalMatch = bodyText.match(/Personal[\s\S]{0,20}?\$(\d+)forever/i);
    if (personalMatch) {
      plans.push({
        planName: "Personal",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const proMatch = bodyText.match(/Pro[\s\S]{0,30}?\$(\d+)per month/i);
    if (proMatch) {
      plans.push({
        planName: "Pro",
        rawPriceText: `$${proMatch[1]} / mo.`,
        basePriceAmount: parseFloat(proMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const businessMatch = bodyText.match(/Business[\s\S]{0,20}?\$(\d+)per seat/i);
    if (businessMatch) {
      plans.push({
        planName: "Business",
        rawPriceText: `$${businessMatch[1]} / seat / mo.`,
        basePriceAmount: parseFloat(businessMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      });
    }

    return plans;
  },
};

// ------------------------------------------------------------
// Qoder (Alibaba): マーケティングページ(qoder.com/pricing)はJS描画だが、
// ドキュメントサイト(docs.qoder.com/account/pricing)には
// 静的なMarkdown形式の価格表が残っているため、そちらを情報源とする。
// ------------------------------------------------------------
const qoderConfig: SiteConfig = {
  slug: "qoder",
  displayName: "Qoder (Alibaba)",
  officialSite: "https://qoder.com",
  sourceUrl: "https://docs.qoder.com/account/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    plans.push({
      planName: "Free",
      rawPriceText: "Free",
      basePriceAmount: 0,
      billingPeriod: "monthly",
      priceBasis: "flat",
      audience: "individual",
    });

    // 表の並び順は必ず Pro → Pro+ → Ultra
    const tierOrder = ["Pro", "Pro+", "Ultra"];
    const priceMatches = [...bodyText.matchAll(/(\d+)\s*USD\/mo/gi)];

    if (priceMatches.length < tierOrder.length) {
      console.warn(
        `⚠️ [qoder] 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。`
      );
    }

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

    return plans;
  },
};

// ------------------------------------------------------------
// Factory AI (droid): マーケティングページ(factory.ai/pricing)はJS描画だが、
// ドキュメントサイト(docs.factory.ai/pricing/individuals)には
// 静的な価格表が残っているため、そちらを情報源とする。
// 無料プランは無く、Teams/Enterpriseは別ページのため一律Customとする。
// ------------------------------------------------------------
const factoryConfig: SiteConfig = {
  slug: "factory-ai",
  displayName: "Factory AI (droid)",
  officialSite: "https://factory.ai",
  sourceUrl: "https://docs.factory.ai/pricing/individuals",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    // 表の並び順は必ず Pro → Plus → Max
    const tierOrder = ["Pro", "Plus", "Max"];
    const priceMatches = [...bodyText.matchAll(/\$(\d+)\/mo/gi)];

    if (priceMatches.length < tierOrder.length) {
      console.warn(
        `⚠️ [factory-ai] 期待した${tierOrder.length}件に対し${priceMatches.length}件しか価格が見つかりませんでした。`
      );
    }

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

    plans.push({
      planName: "Teams / Enterprise",
      rawPriceText: "Custom",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "custom",
      audience: "enterprise",
    });

    return plans;
  },
};

// ------------------------------------------------------------
// Trae (ByteDance): trae.ai/pricing はJavaScriptで描画されるSPAで、
// 静的取得では価格表がほぼ空になってしまう。手動確認待ちとする。
// ------------------------------------------------------------
const traeConfig: SiteConfig = {
  slug: "trae",
  displayName: "Trae (ByteDance)",
  officialSite: "https://www.trae.ai",
  sourceUrl: "https://www.trae.ai/pricing",
  skipFetch: true,
  parse(html) {
    return [
      {
        planName: "Free",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Lite",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Pro",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Pro+",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Ultra",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
    ];
  },
};

// ------------------------------------------------------------
// Amp (Sourcegraph): 2025年にCodyのFree/Proを廃止し、
// 新製品Ampへ移行した後継製品。ampcode.com/pricing は静的。
// ------------------------------------------------------------
const ampConfig: SiteConfig = {
  slug: "amp",
  displayName: "Amp (旧Sourcegraph Cody後継)",
  officialSite: "https://ampcode.com",
  sourceUrl: "https://ampcode.com/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const megawattMatch = bodyText.match(/Megawatt[\s\S]{0,20}?\$(\d+)\/month/i);
    if (megawattMatch) {
      plans.push({
        planName: "Megawatt",
        rawPriceText: `$${megawattMatch[1]}/month`,
        basePriceAmount: parseFloat(megawattMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const gigawattMatch = bodyText.match(/Gigawatt[\s\S]{0,20}?\$(\d+)\/month/i);
    if (gigawattMatch) {
      plans.push({
        planName: "Gigawatt",
        rawPriceText: `$${gigawattMatch[1]}/month`,
        basePriceAmount: parseFloat(gigawattMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    plans.push({
      planName: "Unconstrained",
      rawPriceText: "従量課金(Pay as you go)",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "custom",
      audience: "team",
    });

    plans.push({
      planName: "Enterprise",
      rawPriceText: "Custom",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "custom",
      audience: "enterprise",
    });

    return plans;
  },
};

// ------------------------------------------------------------
// Gemini Code Assist Standard/Enterprise (Google Cloud):
// Antigravityとは別の、企業向けに正式販売され続けている製品。
// 公式ページは時間単価表記のため、月730時間換算(月間契約レート)で
// 月額に変換する。
// ------------------------------------------------------------
const geminiCodeAssistConfig: SiteConfig = {
  slug: "gemini-code-assist",
  displayName: "Gemini Code Assist (Google Cloud, Standard/Enterprise)",
  officialSite: "https://cloud.google.com/products/gemini/code-assist",
  sourceUrl: "https://cloud.google.com/products/gemini/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];
    const HOURS_PER_MONTH = 730;

    const standardMatch = bodyText.match(/Gemini Code Assist Standard\s*\$([\d.]+)\s*\/\s*1\s*hour/i);
    if (standardMatch) {
      const hourly = parseFloat(standardMatch[1]);
      const monthly = Math.round(hourly * HOURS_PER_MONTH * 100) / 100;
      plans.push({
        planName: "Standard",
        rawPriceText: `約$${monthly.toFixed(2)} / user / mo. (月間契約, $${hourly}/時間換算)`,
        basePriceAmount: monthly,
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "team",
      });
    } else {
      console.warn("⚠️ [gemini-code-assist] Standardの価格が見つかりませんでした。");
    }

    const enterpriseMatch = bodyText.match(/Gemini Code Assist Enterprise\s*\$([\d.]+)\s*\/\s*1\s*hour/i);
    if (enterpriseMatch) {
      const hourly = parseFloat(enterpriseMatch[1]);
      const monthly = Math.round(hourly * HOURS_PER_MONTH * 100) / 100;
      plans.push({
        planName: "Enterprise",
        rawPriceText: `約$${monthly.toFixed(2)} / user / mo. (月間契約, $${hourly}/時間換算)`,
        basePriceAmount: monthly,
        billingPeriod: "monthly",
        priceBasis: "per_seat",
        audience: "enterprise",
      });
    } else {
      console.warn("⚠️ [gemini-code-assist] Enterpriseの価格が見つかりませんでした。");
    }

    return plans;
  },
};

// ------------------------------------------------------------
// Google Antigravity (旧Gemini Code Assist個人向け):
// 2026年6月18日にGemini Code Assist個人向けが終了し、
// Antigravityへ統合された。さらに2026年に入ってからAI Pro/Ultraの
// 価格体系が複数回変更されており(Ultraが$250→$100/$200の二段階制に
// 分割など)、公式サイトにも具体的な金額が直接表示されていない
// 不安定な状態。Individual($0)だけ自動取得し、それ以外は
// 手動確認待ちとする。
// ------------------------------------------------------------
const antigravityConfig: SiteConfig = {
  slug: "antigravity",
  displayName: "Google Antigravity (旧Gemini Code Assist個人向け)",
  officialSite: "https://antigravity.google",
  sourceUrl: "https://antigravity.google/pricing/",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const freeMatch = bodyText.match(/For Individuals[\s\S]{0,20}?\$(\d+)\/month/i);
    if (freeMatch) {
      plans.push({
        planName: "Individual",
        rawPriceText: `$${freeMatch[1]}/month`,
        basePriceAmount: parseFloat(freeMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    } else {
      console.warn("⚠️ [antigravity] Individual(Free)の価格が見つかりませんでした。");
    }

    // AI Pro / AI Ultra は公式ページに金額が直接表示されておらず、
    // 2026年中に複数回改定されている(要注視)。
    plans.push({
      planName: "Google AI Pro",
      rawPriceText: "MANUAL_ENTRY_REQUIRED",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "flat",
      audience: "individual",
    });
    plans.push({
      planName: "Google AI Ultra",
      rawPriceText: "MANUAL_ENTRY_REQUIRED",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "flat",
      audience: "individual",
    });
    plans.push({
      planName: "Organization",
      rawPriceText: "Custom",
      basePriceAmount: null,
      billingPeriod: "monthly",
      priceBasis: "custom",
      audience: "enterprise",
    });

    return plans;
  },
};

// ------------------------------------------------------------
// JetBrains AI Assistant: jetbrains.com/ai-ides/buy/ はJavaScriptで
// 描画されるSPAで、静的取得では中身がほぼ空になってしまう。
// そのためDevinと同様「手動確認待ち」方式にする。
// ------------------------------------------------------------
const jetbrainsConfig: SiteConfig = {
  slug: "jetbrains-ai",
  displayName: "JetBrains AI Assistant",
  officialSite: "https://www.jetbrains.com/ai-ides/",
  sourceUrl: "https://www.jetbrains.com/ai-ides/buy/",
  skipFetch: true,
  parse(html) {
    return [
      {
        planName: "AI Free",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "AI Pro",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "AI Ultimate",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "AI Enterprise",
        rawPriceText: "Custom",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      },
    ];
  },
};

// ------------------------------------------------------------
// Replit: replit.com/pricing は静的で読み取りやすい。
// 月額表示の中に「通常価格 割引後価格」が並ぶ形式のため、
// 先に出てくる方(割引前の通常価格)を採用する。
// ------------------------------------------------------------
const replitConfig: SiteConfig = {
  slug: "replit",
  displayName: "Replit",
  officialSite: "https://replit.com",
  sourceUrl: "https://replit.com/pricing",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    if (/Starter[\s\S]{0,20}?Free/i.test(bodyText)) {
      plans.push({
        planName: "Starter",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    // ⚠️ Core / Pro の実際の金額($20など)はJavaScriptで後から
    //    描画される可能性が高く、単純なfetchでは取得できないことがある。
    //    見つからない場合は行ごと消さず、手動確認待ちとして残す。
    const coreMatch = bodyText.match(/\bCore\b[\s\S]{0,30}?\$(\d+)/);
    plans.push(
      coreMatch
        ? {
            planName: "Core",
            rawPriceText: `$${coreMatch[1]} / mo.`,
            basePriceAmount: parseFloat(coreMatch[1]),
            billingPeriod: "monthly",
            priceBasis: "flat",
            audience: "individual",
          }
        : {
            planName: "Core",
            rawPriceText: "MANUAL_ENTRY_REQUIRED",
            basePriceAmount: null,
            billingPeriod: "monthly",
            priceBasis: "flat",
            audience: "individual",
          }
    );

    const proMatch = bodyText.match(/\bPro\b[\s\S]{0,30}?\$(\d+)/);
    plans.push(
      proMatch
        ? {
            planName: "Pro",
            rawPriceText: `$${proMatch[1]} / mo.`,
            basePriceAmount: parseFloat(proMatch[1]),
            billingPeriod: "monthly",
            priceBasis: "flat",
            audience: "individual",
          }
        : {
            planName: "Pro",
            rawPriceText: "MANUAL_ENTRY_REQUIRED",
            basePriceAmount: null,
            billingPeriod: "monthly",
            priceBasis: "flat",
            audience: "individual",
          }
    );

    if (/Enterprise[\s\S]{0,20}?Custom/i.test(bodyText)) {
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
// Devin (旧Windsurf): CognitionがWindsurfを買収し統合済み。
// windsurf.com/pricing は devin.ai/pricing にリダイレクトされる。
// ------------------------------------------------------------
const devinConfig: SiteConfig = {
  slug: "devin",
  displayName: "Devin (旧Windsurf)",
  officialSite: "https://devin.ai",
  sourceUrl: "https://devin.ai/pricing",
  // Devinはbot対策で安定してfetchできないため、そもそも
  // HTTPリクエスト自体を行わない(429の発生源を断つ)。
  skipFetch: true,
  parse(html) {
    // ⚠️ Devinはbot対策(429 Too Many Requests)が強く、
    //   GitHub ActionsのIPからは安定して取得できないと判明。
    //   これ以上のUser-Agent調整は費用対効果が低いため、
    //   Cursorと同様「手動確認待ち」に切り替える。
    //   実際の価格は https://devin.ai/pricing を目視で確認し、
    //   手動更新用SQLで反映する。
    return [
      {
        planName: "Free",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Pro",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Max",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "Teams",
        rawPriceText: "MANUAL_ENTRY_REQUIRED",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "team",
      },
      {
        planName: "Enterprise",
        rawPriceText: "Custom",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      },
    ];
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

    // Pro / Team Standard seat / Team Premium seat はいずれも
    // "$XX if billed monthly" という表記を使っており、
    // 出現順が Pro → Standard seat → Premium seat の順で並ぶ。
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

    // Free → Pro → Pro+ → Pro Max → Power の順で
    // "$XX per month" / "$XX per user / month" と並ぶ
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
// ============================================================
// 画像生成AI (category: "image")
// ============================================================

// ------------------------------------------------------------
// Midjourney: docs.midjourney.com のヘルプ記事に静的な価格表がある。
// マーケティングページ(account/pricing)はログイン必須のため使わない。
// ------------------------------------------------------------
const midjourneyConfig: SiteConfig = {
  slug: "midjourney",
  displayName: "Midjourney",
  officialSite: "https://www.midjourney.com",
  sourceUrl: "https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans",
  category: "image",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const tierOrder = ["Basic", "Standard", "Pro", "Mega"];
    const match = bodyText.match(/Monthly Price\s*\$(\d+)\s*\$(\d+)\s*\$(\d+)\s*\$(\d+)/i);

    if (!match) {
      console.warn("⚠️ [midjourney] 価格表が見つかりませんでした。");
      return plans;
    }

    for (let i = 0; i < tierOrder.length; i++) {
      const amount = parseFloat(match[i + 1]);
      plans.push({
        planName: tierOrder[i],
        rawPriceText: `$${match[i + 1]} / mo.`,
        basePriceAmount: amount,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    return plans;
  },
};

// ------------------------------------------------------------
// Leonardo AI: leonardo.ai/pricing は静的で読み取りやすい。
// ------------------------------------------------------------
const leonardoConfig: SiteConfig = {
  slug: "leonardo-ai",
  displayName: "Leonardo AI",
  officialSite: "https://leonardo.ai",
  sourceUrl: "https://www.leonardo.ai/pricing",
  category: "image",
  parse(html) {
    const $ = cheerio.load(html);
    const bodyText = $("body").text().replace(/\s+/g, " ");
    const plans: ParsedPlan[] = [];

    const freeMatch = bodyText.match(/FREE\s*\$(\d+)\s*\/month/i);
    if (freeMatch) {
      plans.push({
        planName: "Free",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const essentialMatch = bodyText.match(/Essential\s*\$(\d+)\s*\/month/i);
    if (essentialMatch) {
      plans.push({
        planName: "Essential",
        rawPriceText: `$${essentialMatch[1]} / mo.`,
        basePriceAmount: parseFloat(essentialMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const premiumMatch = bodyText.match(/Premium\s*\$(\d+)\s*\/month/i);
    if (premiumMatch) {
      plans.push({
        planName: "Premium",
        rawPriceText: `$${premiumMatch[1]} / mo.`,
        basePriceAmount: parseFloat(premiumMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    const ultimateMatch = bodyText.match(/Ultimate\s*\$(\d+)\s*\/month/i);
    if (ultimateMatch) {
      plans.push({
        planName: "Ultimate",
        rawPriceText: `$${ultimateMatch[1]} / mo.`,
        basePriceAmount: parseFloat(ultimateMatch[1]),
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      });
    }

    if (/Need\s*a\s*custom\s*plan/i.test(bodyText)) {
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
// OpenAI (ChatGPT画像生成): チャットのChatGPTプランと同じ価格体系
// (画像生成は各プランに内蔵)。マーケティングページがJS描画のため
// 手動確認待ちとする。
// ------------------------------------------------------------
const openaiImageConfig: SiteConfig = {
  slug: "openai-image",
  displayName: "OpenAI (ChatGPT画像生成)",
  officialSite: "https://openai.com/index/image-generation-api/",
  sourceUrl: "https://chatgpt.com/pricing/",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Go", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Plus", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Business", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "per_seat", audience: "team" },
      { planName: "Enterprise", rawPriceText: "Custom", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "enterprise" },
    ];
  },
};

// ------------------------------------------------------------
// Google (Gemini画像生成): Google AI Pro/Ultraプランに内蔵。
// 公式ページが地域別・JS描画のため手動確認待ちとする。
// ------------------------------------------------------------
const googleImageConfig: SiteConfig = {
  slug: "gemini-image",
  displayName: "Google (Gemini画像生成)",
  officialSite: "https://gemini.google",
  sourceUrl: "https://gemini.google/subscriptions/",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Google AI Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Google AI Ultra", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
    ];
  },
};

// ------------------------------------------------------------
// Grok Imagine (xAI): Grokアプリ/X Premiumのプランに内蔵。
// ------------------------------------------------------------
const grokImagineConfig: SiteConfig = {
  slug: "grok-imagine",
  displayName: "Grok Imagine (xAI)",
  officialSite: "https://grok.com",
  sourceUrl: "https://x.ai/grok",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "X Premium", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "SuperGrok", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Grok Heavy", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
    ];
  },
};

// ------------------------------------------------------------
// Adobe Firefly: 地域により通貨・価格表示が変わるため手動確認待ち。
// ------------------------------------------------------------
const adobeFireflyConfig: SiteConfig = {
  slug: "adobe-firefly",
  displayName: "Adobe Firefly",
  officialSite: "https://firefly.adobe.com",
  sourceUrl: "https://www.adobe.com/products/firefly.html",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Standard", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro Plus", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Premium", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
    ];
  },
};

// ------------------------------------------------------------
// Stability AI (Stable Diffusion): サブスクプランが無く、
// オープンソース自己ホスト(無料)とAPI従量課金のみのため、
// 固定の2行として扱う(取得のたびに再確認する必要が薄いので直接記述)。
// ------------------------------------------------------------
const stabilityAIConfig: SiteConfig = {
  slug: "stability-ai",
  displayName: "Stability AI (Stable Diffusion)",
  officialSite: "https://stability.ai",
  sourceUrl: "https://stability.ai/pricing",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      {
        planName: "Free (オープンソース/自己ホスト)",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "API",
        rawPriceText: "従量課金(Custom)",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      },
    ];
  },
};

// ------------------------------------------------------------
// Black Forest Labs (FLUX): Stability AIと同様、サブスクは無く
// オープンソース自己ホスト(無料)とAPI従量課金のみ。
// ------------------------------------------------------------
const fluxConfig: SiteConfig = {
  slug: "black-forest-labs-flux",
  displayName: "Black Forest Labs (FLUX)",
  officialSite: "https://bfl.ai",
  sourceUrl: "https://bfl.ai/pricing",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      {
        planName: "Free (オープンソース/自己ホスト)",
        rawPriceText: "Free",
        basePriceAmount: 0,
        billingPeriod: "monthly",
        priceBasis: "flat",
        audience: "individual",
      },
      {
        planName: "API",
        rawPriceText: "従量課金(Custom)",
        basePriceAmount: null,
        billingPeriod: "monthly",
        priceBasis: "custom",
        audience: "enterprise",
      },
    ];
  },
};

// ------------------------------------------------------------
// Canva (Magic Media): Canva全体のプランに内蔵。
// ------------------------------------------------------------
const canvaConfig: SiteConfig = {
  slug: "canva-magic-media",
  displayName: "Canva (Magic Media)",
  officialSite: "https://www.canva.com",
  sourceUrl: "https://www.canva.com/pricing/",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Teams", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "per_seat", audience: "team" },
      { planName: "Enterprise", rawPriceText: "Custom", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "enterprise" },
    ];
  },
};

// ------------------------------------------------------------
// Krea AI: 月額/年額の切り替えでJS描画される部分が多く、
// 安定した自動取得が難しいため手動確認待ちとする。
// ------------------------------------------------------------
const kreaConfig: SiteConfig = {
  slug: "krea-ai",
  displayName: "Krea AI",
  officialSite: "https://www.krea.ai",
  sourceUrl: "https://www.krea.ai/pricing",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Basic", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Max", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Business", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "team" },
      { planName: "Enterprise", rawPriceText: "Custom", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "enterprise" },
    ];
  },
};

// ------------------------------------------------------------
// Ideogram: マーケティングページがJS描画のため手動確認待ちとする。
// ------------------------------------------------------------
const ideogramConfig: SiteConfig = {
  slug: "ideogram",
  displayName: "Ideogram",
  officialSite: "https://ideogram.ai",
  sourceUrl: "https://ideogram.ai/pricing",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Plus", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Team", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "per_seat", audience: "team" },
      { planName: "Enterprise", rawPriceText: "Custom", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "enterprise" },
    ];
  },
};

// ------------------------------------------------------------
// Magnific (旧Freepik AI): 2026年4月28日にFreepik AIから
// ブランド名変更(業界再編の一例)。信頼できる価格情報がまだ
// 十分に集まっていないため、全プラン空欄で登録しておき、
// 後日公式サイトを確認してから手動で埋める。
// ------------------------------------------------------------
const magnificConfig: SiteConfig = {
  slug: "magnific",
  displayName: "Magnific (旧Freepik AI)",
  officialSite: "https://magnific.ai",
  sourceUrl: "https://magnific.ai/pricing",
  skipFetch: true,
  category: "image",
  parse(html) {
    return [
      { planName: "Free", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Pro", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "flat", audience: "individual" },
      { planName: "Business", rawPriceText: "MANUAL_ENTRY_REQUIRED", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "per_seat", audience: "team" },
      { planName: "Enterprise", rawPriceText: "Custom", basePriceAmount: null, billingPeriod: "monthly", priceBasis: "custom", audience: "enterprise" },
    ];
  },
};

const SITES: SiteConfig[] = [
  cursorConfig,
  copilotConfig,
  tabnineConfig,
  devinConfig,
  claudeCodeConfig,
  kiroConfig,
  jetbrainsConfig,
  replitConfig,
  antigravityConfig,
  chatgptConfig,
  augmentConfig,
  warpConfig,
  zedConfig,
  qoderConfig,
  factoryConfig,
  traeConfig,
  ampConfig,
  geminiCodeAssistConfig,
  midjourneyConfig,
  leonardoConfig,
  openaiImageConfig,
  googleImageConfig,
  grokImagineConfig,
  adobeFireflyConfig,
  stabilityAIConfig,
  fluxConfig,
  canvaConfig,
  kreaConfig,
  ideogramConfig,
  magnificConfig,
];

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
      `INSERT INTO products (slug, display_name, official_site, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [site.slug, site.displayName, site.officialSite, site.category ?? "coding"]
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

      // すでに手動で正しい価格が入っている場合、"MANUAL_ENTRY_REQUIRED"の
      // プレースホルダーで上書きしてしまわないようにスキップする。
      // (これが無いと、毎日の自動実行のたびに手動入力が消えてしまう)
      if (plan.rawPriceText === "MANUAL_ENTRY_REQUIRED") {
        const currentRes = await client.query(
          `SELECT raw_price_text FROM current_plan_prices WHERE plan_id = $1`,
          [planId]
        );
        const currentText = currentRes.rows[0]?.raw_price_text;
        if (currentText && currentText !== "MANUAL_ENTRY_REQUIRED") {
          console.log(`⏭️ [${site.slug}] ${plan.planName}: 既に手動入力済みのためスキップ (${currentText})`);
          continue;
        }
      }

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

    let html = "";
    let finalUrl = site.sourceUrl;

    if (site.skipFetch) {
      console.log(`(skipFetch: true のためHTTPリクエストは行いません)`);
    } else {
      console.log(`Fetching: ${site.sourceUrl}`);
      const fetched = await fetchPage(site.sourceUrl);
      html = fetched.html;
      finalUrl = fetched.finalUrl;
    }

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
    // 一部失敗があってもプロセス全体は異常終了させ、Actions側で気づけるようにする
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 予期しないエラー:", err);
  process.exit(1);
});
