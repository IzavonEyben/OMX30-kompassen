#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

const WATCHLIST = [
  { ticker: "ABB", name: "ABB", symbol: "ABB.ST" },
  { ticker: "ALFA", name: "Alfa Laval", symbol: "ALFA.ST" },
  { ticker: "ASSA B", name: "Assa Abloy", symbol: "ASSA-B.ST" },
  { ticker: "AZN", name: "AstraZeneca", symbol: "AZN.ST" },
  { ticker: "ATCO A", name: "Atlas Copco A", symbol: "ATCO-A.ST" },
  { ticker: "ATCO B", name: "Atlas Copco B", symbol: "ATCO-B.ST" },
  { ticker: "BOL", name: "Boliden", symbol: "BOL.ST" },
  { ticker: "ELUX B", name: "Electrolux B", symbol: "ELUX-B.ST" },
  { ticker: "ERIC B", name: "Ericsson B", symbol: "ERIC-B.ST" },
  { ticker: "ESSITY B", name: "Essity B", symbol: "ESSITY-B.ST" },
  { ticker: "EVO", name: "Evolution", symbol: "EVO.ST" },
  { ticker: "GETI B", name: "Getinge B", symbol: "GETI-B.ST" },
  { ticker: "HM B", name: "H&M B", symbol: "HM-B.ST" },
  { ticker: "HEXA B", name: "Hexagon B", symbol: "HEXA-B.ST" },
  { ticker: "INVE B", name: "Investor B", symbol: "INVE-B.ST" },
  { ticker: "INDU C", name: "Industrivarden C", symbol: "INDU-C.ST" },
  { ticker: "KINV B", name: "Kinnevik B", symbol: "KINV-B.ST" },
  { ticker: "NIBE B", name: "NIBE-B", symbol: "NIBE-B.ST" },
  { ticker: "NDA SE", name: "Nordea", symbol: "NDA-SE.ST" },
  { ticker: "SAND", name: "Sandvik", symbol: "SAND.ST" },
  { ticker: "SCA B", name: "SCA B", symbol: "SCA-B.ST" },
  { ticker: "SEB A", name: "SEB A", symbol: "SEB-A.ST" },
  { ticker: "SHB A", name: "Handelsbanken A", symbol: "SHB-A.ST" },
  { ticker: "SKF B", name: "SKF B", symbol: "SKF-B.ST" },
  { ticker: "SWED A", name: "Swedbank A", symbol: "SWED-A.ST" },
  { ticker: "TEL2 B", name: "Tele2 B", symbol: "TEL2-B.ST" },
  { ticker: "TELIA", name: "Telia Company", symbol: "TELIA.ST" },
  { ticker: "VOLV B", name: "Volvo B", symbol: "VOLV-B.ST" },
  { ticker: "SAAB B", name: "Saab B", symbol: "SAAB-B.ST" },
  { ticker: "SINCH", name: "Sinch", symbol: "SINCH.ST" }
];

const QUOTE_ENDPOINTS = [
  "https://query1.finance.yahoo.com/v7/finance/quote?symbols=",
  "https://query2.finance.yahoo.com/v7/finance/quote?symbols="
];
const CHART_ENDPOINTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/"
];
const CHART_QUERIES = [
  { interval: "5m", range: "1d" },
  { interval: "1d", range: "1mo" }
];
const OUTPUT_FILE = "data/omx30.json";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function percentFromQuote(quote, fallback) {
  const direct = toNumber(quote?.regularMarketChangePercent);
  if (direct !== null) {
    return direct;
  }

  const price = toNumber(quote?.regularMarketPrice);
  const previousClose = toNumber(quote?.regularMarketPreviousClose);
  if (price !== null && previousClose !== null && previousClose !== 0) {
    return ((price - previousClose) / previousClose) * 100;
  }

  return fallback ?? 0;
}

function pickReportDate(quote, nowSeconds, fallback) {
  const candidates = [
    toNumber(quote?.earningsTimestamp),
    toNumber(quote?.earningsTimestampStart),
    toNumber(quote?.earningsTimestampEnd)
  ]
    .filter((value) => value !== null && value > 0)
    .sort((a, b) => a - b);

  const nearFuture = candidates.find((value) => value >= nowSeconds - 86400);
  if (nearFuture) {
    return new Date(nearFuture * 1000).toISOString().slice(0, 10);
  }

  return fallback ?? null;
}

function computeStrength(price, quote, changePercent, fallback) {
  const high52 = toNumber(quote?.fiftyTwoWeekHigh);
  const low52 = toNumber(quote?.fiftyTwoWeekLow);

  let rangeScore = fallback ?? 50;
  if (price !== null && high52 !== null && low52 !== null && high52 > low52) {
    rangeScore = ((price - low52) / (high52 - low52)) * 100;
  }

  const momentumScore = 50 + changePercent * 8;
  return Math.round(clamp(rangeScore * 0.65 + momentumScore * 0.35, 0, 100));
}

function eventSummary(changePercent, marketState, hadQuote) {
  if (!hadQuote) {
    return "Reservdata visas just nu.";
  }

  if (changePercent >= 1.5) {
    return "Stark handelsdag i senaste uppdateringen.";
  }
  if (changePercent <= -1.5) {
    return "Svag handelsdag i senaste uppdateringen.";
  }
  if (marketState === "CLOSED") {
    return "Borsen ar stangd, visar senaste handelsdag.";
  }
  return "Lugnt handelslage i senaste uppdateringen.";
}

async function loadPreviousItems() {
  try {
    const raw = await readFile(OUTPUT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return new Map(items.map((item) => [item.ticker, item]));
  } catch {
    return new Map();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; OMX30DataBot/1.0)",
      accept: "application/json,text/plain,*/*",
      "accept-language": "en-US,en;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchQuotesFromBatchEndpoint(endpoint) {
  const symbols = WATCHLIST.map((item) => item.symbol).join(",");
  const payload = await fetchJson(endpoint + encodeURIComponent(symbols));
  const result = payload?.quoteResponse?.result;
  if (!Array.isArray(result)) {
    throw new Error("Quote response payload is missing result array.");
  }

  return new Map(result.map((quote) => [quote.symbol, quote]));
}

async function fetchQuotes() {
  const errors = [];
  for (const endpoint of QUOTE_ENDPOINTS) {
    try {
      const quotesBySymbol = await fetchQuotesFromBatchEndpoint(endpoint);
      return {
        provider: "Yahoo Finance quote endpoint",
        type: "exchange-delayed quote feed",
        quotesBySymbol
      };
    } catch (error) {
      errors.push(`${endpoint} -> ${error.message}`);
    }
  }

  throw new Error(`Quote fetch failed on all batch endpoints: ${errors.join(" | ")}`);
}

function latestFinitePoint(closes = [], timestamps = []) {
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const value = toNumber(closes[index]);
    if (value !== null) {
      return {
        close: value,
        time: toNumber(timestamps[index])
      };
    }
  }
  return null;
}

function previousFiniteClose(closes = []) {
  let foundOne = false;
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const value = toNumber(closes[index]);
    if (value === null) {
      continue;
    }
    if (!foundOne) {
      foundOne = true;
      continue;
    }
    return value;
  }
  return null;
}

async function fetchQuoteFromChart(symbol) {
  const errors = [];
  for (const query of CHART_QUERIES) {
    for (const endpoint of CHART_ENDPOINTS) {
      try {
        const payload = await fetchJson(
          `${endpoint}${encodeURIComponent(symbol)}?interval=${query.interval}&range=${query.range}`
        );
        const result = payload?.chart?.result?.[0];
        if (!result) {
          throw new Error(`Missing chart result for ${symbol}`);
        }

        const meta = result.meta ?? {};
        const closes = result?.indicators?.quote?.[0]?.close ?? [];
        const timestamps = result?.timestamp ?? [];
        const latestPoint = latestFinitePoint(closes, timestamps);

        const price = toNumber(meta.regularMarketPrice) ?? latestPoint?.close ?? null;
        const previousClose =
          toNumber(meta.chartPreviousClose) ??
          toNumber(meta.previousClose) ??
          previousFiniteClose(closes);
        const regularMarketTime = toNumber(meta.regularMarketTime) ?? latestPoint?.time ?? null;
        const changePercent =
          price !== null && previousClose !== null && previousClose !== 0
            ? ((price - previousClose) / previousClose) * 100
            : null;

        return {
          symbol,
          regularMarketPrice: price,
          regularMarketPreviousClose: previousClose,
          regularMarketChangePercent: changePercent,
          regularMarketTime,
          marketState: meta.marketState ?? "UNKNOWN",
          fiftyTwoWeekHigh: toNumber(meta.fiftyTwoWeekHigh),
          fiftyTwoWeekLow: toNumber(meta.fiftyTwoWeekLow),
          earningsTimestamp: toNumber(meta.earningsTimestamp),
          earningsTimestampStart: toNumber(meta.earningsTimestampStart),
          earningsTimestampEnd: toNumber(meta.earningsTimestampEnd)
        };
      } catch (error) {
        errors.push(`${endpoint}${symbol}?interval=${query.interval}&range=${query.range} -> ${error.message}`);
      }
    }
  }

  throw new Error(`All chart endpoints failed for ${symbol}: ${errors.join(" | ")}`);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  const queue = [...items];

  async function run() {
    while (queue.length > 0) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

async function fetchQuotesFromCharts() {
  const entries = await mapWithConcurrency(WATCHLIST, 5, async (stock) => {
      try {
        const quote = await fetchQuoteFromChart(stock.symbol);
        return [stock.symbol, quote];
      } catch (error) {
        console.warn(`Chart fetch failed for ${stock.symbol}: ${error.message}`);
        return [stock.symbol, null];
      }
    });

  const rows = entries.filter((entry) => Boolean(entry[1]));
  return new Map(rows);
}

function mapRow(stock, quote, previous, nowSeconds) {
  const hadQuote = Boolean(quote);
  const fallbackPrice = toNumber(previous?.price);
  const fallbackChange = toNumber(previous?.changePercent) ?? 0;
  const fallbackStrength = toNumber(previous?.strength) ?? 50;
  const fallbackReportDate = previous?.reportDate ?? null;

  const price = toNumber(quote?.regularMarketPrice) ?? fallbackPrice;
  const changePercent = percentFromQuote(quote, fallbackChange);
  const strength = hadQuote
    ? computeStrength(price, quote, changePercent, fallbackStrength)
    : fallbackStrength;
  const marketState = quote?.marketState ?? previous?.marketState ?? "UNKNOWN";
  const marketTime = toNumber(quote?.regularMarketTime)
    ? new Date(Number(quote.regularMarketTime) * 1000).toISOString()
    : previous?.marketTime ?? null;
  const reportDate = pickReportDate(quote, nowSeconds, fallbackReportDate);

  return {
    ticker: stock.ticker,
    name: stock.name,
    symbol: stock.symbol,
    price: price ?? fallbackPrice ?? 0,
    changePercent,
    strength,
    event: eventSummary(changePercent, marketState, hadQuote),
    reportDate,
    marketState,
    marketTime
  };
}

async function main() {
  const previousByTicker = await loadPreviousItems();
  let quotesBySymbol = new Map();
  let source = {
    provider: "Yahoo Finance quote endpoint",
    type: "exchange-delayed quote feed",
    schedule: "every 5 minutes on weekdays"
  };

  try {
    const batchResult = await fetchQuotes();
    quotesBySymbol = batchResult.quotesBySymbol;
    source.provider = batchResult.provider;
    source.type = batchResult.type;
    console.log(`Fetched ${quotesBySymbol.size} quotes from batch endpoint.`);
  } catch (error) {
    console.warn(`${error.message} Trying chart fallback.`);
    quotesBySymbol = await fetchQuotesFromCharts();

    if (quotesBySymbol.size > 0) {
      source.provider = "Yahoo Finance chart endpoint";
      source.type = "exchange-delayed quote feed (fallback)";
      console.log(`Fetched ${quotesBySymbol.size} quotes from chart fallback.`);
    } else if (previousByTicker.size > 0) {
      console.warn("No fresh quotes fetched. Keeping previous saved prices.");
      console.log("Skip write: previous cache remains unchanged.");
      return;
    } else {
      throw new Error("Failed to fetch live quotes and no previous cache exists.");
    }
  }

  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const items = WATCHLIST.map((stock) => {
    const quote = quotesBySymbol.get(stock.symbol);
    const previous = previousByTicker.get(stock.ticker);
    return mapRow(stock, quote, previous, nowSeconds);
  });

  const withPrices = items.filter((item) => item.price > 0).length;
  if (withPrices < 20 && previousByTicker.size === 0) {
    throw new Error(`Too few valid prices returned (${withPrices}/${WATCHLIST.length}).`);
  }
  if (withPrices < WATCHLIST.length) {
    console.warn(`Some symbols are missing fresh prices (${withPrices}/${WATCHLIST.length}).`);
  }

  const payload = {
    generatedAt: now.toISOString(),
    source,
    items
  };

  await mkdir("data", { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${items.length} rows to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
