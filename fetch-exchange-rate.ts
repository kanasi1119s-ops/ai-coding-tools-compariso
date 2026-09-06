/**
 * fetch-exchange-rate.ts
 * ------------------------------------------------------------
 * USD→JPYの為替レートを無料API(open.er-api.com)から取得し、
 * exchange_rates テーブルに保存する。
 *
 * open.er-api.comは会員登録・APIキー不要の無料為替レートAPI。
 * 更新頻度は1日1回程度なので、こちらのスクレイピングと同じ
 * 頻度(1日1回)で十分。
 * ------------------------------------------------------------
 */

import { Pool } from "pg";

const API_URL = "https://open.er-api.com/v6/latest/USD";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface ExchangeRateResponse {
  result: string;
  rates: Record<string, number>;
}

async function fetchRate(): Promise<number> {
  const res = await fetch(API_URL);

  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as ExchangeRateResponse;

  if (data.result !== "success") {
    throw new Error(`APIがエラーを返しました: ${JSON.stringify(data)}`);
  }

  const jpyRate = data.rates["JPY"];
  if (typeof jpyRate !== "number") {
    throw new Error("レスポンスにJPYレートが含まれていません。");
  }

  return jpyRate;
}

async function persistRate(rate: number) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO exchange_rates (base_currency, quote_currency, rate)
       VALUES ('USD', 'JPY', $1)`,
      [rate]
    );
    console.log(`✅ 為替レートを保存しました: 1 USD = ${rate} JPY`);
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`Fetching exchange rate from: ${API_URL}`);
  const rate = await fetchRate();

  console.log(`Persisting rate...`);
  await persistRate(rate);

  await pool.end();
}

main().catch((err) => {
  console.error("❌ 為替レート取得失敗:", err);
  process.exit(1);
});
