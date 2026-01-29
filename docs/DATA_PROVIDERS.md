# Financial News & Data Providers

This document provides a comprehensive overview of financial news and data providers that can be integrated into DayTrader. The focus is on **free-tier APIs** and **RSS feeds**, with special emphasis on **German-language sources**.

## Table of Contents

- [Currently Integrated Providers](#currently-integrated-providers)
- [Finance-Specific News APIs (Free Tier)](#finance-specific-news-apis-free-tier)
- [General News APIs with Finance Filters](#general-news-apis-with-finance-filters)
- [German Sources (RSS/Atom Feeds)](#german-sources-rssatom-feeds)
- [Open Data Sources](#open-data-sources)
- [Integration Priority](#integration-priority)
- [Implementation Notes](#implementation-notes)

---

## Currently Integrated Providers

DayTrader already integrates the following market data and news providers:

| Provider | Type | API Key | Features | Status |
|----------|------|---------|----------|--------|
| **Yahoo Finance** | Market Data | ❌ No | Quotes, Historical Data | ✅ Default |
| **Finnhub** | Market Data + News | ✅ Yes | Quotes, Candles, News | ✅ Active |
| **Alpha Vantage** | Market Data | ✅ Yes | Quotes, Daily Data | ✅ Active |
| **Twelve Data** | Market Data | ✅ Yes | Time Series | ✅ Active |
| **NewsAPI** | News | ✅ Yes | Headlines, Search | ✅ Active |

---

## Finance-Specific News APIs (Free Tier)

These APIs are specifically designed for financial news and often provide ticker-based filtering, sentiment data, and multi-language support.

### 1. Marketaux

**Type:** Financial News Aggregator with Entity/Ticker-based filtering

| Attribute | Details |
|-----------|---------|
| **Free Tier** | ~100 requests/day, limited articles per request |
| **Features** | Multi-language support, entity recognition, sentiment data |
| **Languages** | English, German, and others |
| **Best For** | Ticker-specific news, sentiment analysis |
| **Documentation** | [marketaux.com/documentation](https://www.marketaux.com/documentation) |

**Sample Use Case:** Get news for specific stock tickers (DAX, VW, SAP) with sentiment scores.

```
GET https://api.marketaux.com/v1/news/all?symbols=VOW.XETRA&language=de&api_token=YOUR_KEY
```

---

### 2. Alpha Vantage (News & Sentiment)

**Type:** Combined Market Data + News/Sentiment API

| Attribute | Details |
|-----------|---------|
| **Free Tier** | Most endpoints free; rate limits apply |
| **Features** | News, sentiment analysis, market data in one ecosystem |
| **Languages** | English primarily |
| **Best For** | Combining news with price/indicator data from single source |
| **Documentation** | [alphavantage.co/documentation](https://www.alphavantage.co/documentation/) |

**Note:** Already partially integrated in DayTrader for market data. News endpoints can be added.

---

### 3. Financial Modeling Prep (FMP)

**Type:** Comprehensive Financial Data + News

| Attribute | Details |
|-----------|---------|
| **Free Tier** | "Start/Explore free" tier available |
| **Features** | Stock News, Market News, General News, Company News |
| **Languages** | English |
| **Best For** | Ticker-specific news integrated with financial data |
| **Documentation** | [financialmodelingprep.com/developer/docs](https://financialmodelingprep.com/developer/docs/) |

**Endpoints:**
- Stock News: `/api/v3/stock_news`
- Market News: `/api/v3/stock-market-news`
- Press Releases: `/api/v3/press-releases/{symbol}`

---

### 4. Tiingo News API

**Type:** Institutional News API (Equities, Crypto, FX)

| Attribute | Details |
|-----------|---------|
| **Free Tier** | Available (check account limits) |
| **Features** | Long historical archive, institutional-grade data |
| **Languages** | English |
| **Best For** | Historical news research, comprehensive coverage |
| **Documentation** | [api.tiingo.com/documentation/news](https://api.tiingo.com/documentation/news) |

---

### 5. EOD Historical Data (EODHD)

**Type:** News Feed + Sentiment as part of financial data package

| Attribute | Details |
|-----------|---------|
| **Free Tier** | ~20 API calls/day (news counts as multiple calls) |
| **Features** | News with sentiment, integrated with price data |
| **Languages** | English |
| **Best For** | If already using EODHD for price data |
| **Documentation** | [eodhistoricaldata.com/financial-apis/financial-news-api](https://eodhistoricaldata.com/financial-apis/financial-news-api/) |

---

### 6. Alpaca News API

**Type:** Broker/Market-Data ecosystem with News

| Attribute | Details |
|-----------|---------|
| **Free Tier** | Free within market data plan limits |
| **Features** | Stocks & Crypto news, integrated with trading platform |
| **Languages** | English |
| **Best For** | If using Alpaca for trading/data |
| **Documentation** | [alpaca.markets/docs/api-references/market-data-api/news](https://alpaca.markets/docs/api-references/market-data-api/news/) |

---

### 7. Benzinga News API (AWS Marketplace)

**Type:** Professional financial news

| Attribute | Details |
|-----------|---------|
| **Free Tier** | Free tier available via AWS Marketplace |
| **Features** | Established financial news brand |
| **Languages** | English |
| **Best For** | Professional news content |
| **Documentation** | [aws.amazon.com/marketplace (search "Benzinga")](https://aws.amazon.com/marketplace) |

**Note:** Requires AWS account and Marketplace integration.

---

### 8. StockNewsAPI

**Type:** Stock/Ticker specific news

| Attribute | Details |
|-----------|---------|
| **Free Tier** | 5-day trial, 100 free calls |
| **Features** | Ticker-based news |
| **Languages** | English |
| **Best For** | Quick testing only (not for long-term free use) |
| **Documentation** | [stocknewsapi.com/documentation](https://stocknewsapi.com/documentation) |

---

## General News APIs with Finance Filters

These are general news aggregators that can be filtered for business/finance content using categories, keywords, and language settings.

### 1. NewsAPI.org ✅ (Already Integrated)

**Type:** General news aggregator

| Attribute | Details |
|-----------|---------|
| **Free Tier** | 100 requests/day, 24h delay, dev/testing only |
| **Features** | Many sources/countries/languages |
| **Languages** | German (`language=de`), English, and 50+ others |
| **Best For** | Prototyping, broad news coverage |
| **Documentation** | [newsapi.org/docs](https://newsapi.org/docs) |

**German Finance Query Example:**
```
GET /v2/everything?q=DAX+OR+Börse+OR+Aktie&language=de&sortBy=publishedAt
```

---

### 2. mediastack (apilayer)

**Type:** Multi-language news API

| Attribute | Details |
|-----------|---------|
| **Free Tier** | ~100 calls/month |
| **Features** | Simple REST API, multi-language |
| **Languages** | German and 50+ others |
| **Best For** | Simple headline retrieval |
| **Documentation** | [mediastack.com/documentation](https://mediastack.com/documentation) |

---

### 3. TheNewsAPI.com

**Type:** Simple headlines API

| Attribute | Details |
|-----------|---------|
| **Free Tier** | 100 requests/day |
| **Features** | Top stories, simple integration |
| **Languages** | Multiple including German |
| **Best For** | Quick headline widgets |
| **Documentation** | [thenewsapi.com/documentation](https://thenewsapi.com/documentation) |

---

### 4. NewsData.io

**Type:** Multi-source news aggregator

| Attribute | Details |
|-----------|---------|
| **Free Tier** | ~200 requests/day |
| **Features** | Many sources, category filters |
| **Languages** | German and many others |
| **Best For** | Business news with good filters |
| **Documentation** | [newsdata.io/documentation](https://newsdata.io/documentation) |

---

### 5. NewsAPI.ai (Event Registry)

**Type:** News intelligence platform (token-based)

| Attribute | Details |
|-----------|---------|
| **Free Tier** | Token-based free plan |
| **Features** | Advanced enrichment, event detection |
| **Languages** | Multiple |
| **Best For** | News intelligence, trend analysis |
| **Documentation** | [newsapi.ai/documentation](https://newsapi.ai/documentation) |

---

## German Sources (RSS/Atom Feeds)

RSS feeds are **free, stable, and legally clear** - no API key required. These are excellent for German financial news.

### 1. Börse Frankfurt / Deutsche Börse

**Type:** Official German Stock Exchange News

| Attribute | Details |
|-----------|---------|
| **URL** | `https://api.boerse-frankfurt.de/v1/feeds/news.rss` |
| **Content** | Market reports, EQS news, ad-hoc announcements |
| **Language** | German |
| **Best For** | Official German market news |

---

### 2. BaFin (Bundesanstalt für Finanzdienstleistungsaufsicht)

**Type:** German Financial Supervisory Authority

| Attribute | Details |
|-----------|---------|
| **RSS Overview** | [bafin.de/SiteGlobals/Functions/RSSFeed](https://www.bafin.de/SiteGlobals/Functions/RSSFeed/) |
| **Content** | Regulatory news, warnings, market measures |
| **Language** | German |
| **Best For** | Regulatory alerts, compliance news |

**Available Feeds:**
- News & Announcements
- Consumer Warnings
- Market Manipulation Alerts
- Supervisory Measures

---

### 3. Deutsche Bundesbank

**Type:** German Central Bank

| Attribute | Details |
|-----------|---------|
| **RSS Overview** | [bundesbank.de (RSS section)](https://www.bundesbank.de/en/service/rss) |
| **Content** | Macro news, publications, speeches |
| **Language** | German, English |
| **Best For** | Monetary policy, economic indicators |

---

### 4. ECB / EZB (European Central Bank)

**Type:** EU Central Bank

| Attribute | Details |
|-----------|---------|
| **RSS Overview** | [ecb.europa.eu/rss](https://www.ecb.europa.eu/rss/) |
| **Content** | Press releases, speeches, FX rates, banking supervision |
| **Language** | German, English, and EU languages |
| **Best For** | Interest rate decisions, monetary policy |

**Key Feeds:**
- Press Releases
- Speeches
- Exchange Rates
- Banking Supervision
- Publications

---

### 5. BMF (Bundesministerium der Finanzen)

**Type:** German Federal Ministry of Finance

| Attribute | Details |
|-----------|---------|
| **RSS Feeds** | Available for "Aktuelles" and "Pressemitteilungen" |
| **Content** | Tax policy, budget news, financial legislation |
| **Language** | German |
| **Best For** | Fiscal policy, tax changes |

---

### 6. BAFA (Bundesamt für Wirtschaft und Ausfuhrkontrolle)

**Type:** Federal Office for Economic Affairs and Export Control

| Attribute | Details |
|-----------|---------|
| **RSS Overview** | [bafa.de (RSS section)](https://www.bafa.de/SiteGlobals/Functions/RSSFeed/) |
| **Content** | Economic/energy news, export control, subsidies |
| **Language** | German |
| **Best For** | Energy policy, trade regulations |

---

### 7. Additional German Finance RSS Sources

| Source | URL | Content |
|--------|-----|---------|
| **FinanzBusiness** | finanzbusiness.de/rss | German finance news (check usage terms) |
| **ad-hoc-news.de** | ad-hoc-news.de/rss | Ad-hoc announcements, customizable |
| **EQS News** | Via Börse Frankfurt | Company announcements |

---

## Open Data Sources

### GDELT (Global Database of Events, Language, and Tone)

**Type:** Free, global news index

| Attribute | Details |
|-----------|---------|
| **Access** | Free, no API key |
| **Features** | Massive news archive, multi-language, event analysis |
| **Languages** | 100+ including German |
| **Best For** | Broad news analysis, trend detection |
| **Documentation** | [gdeltproject.org/data.html](https://www.gdeltproject.org/data.html) |

**Considerations:**
- Requires filtering/relevance logic for finance
- Large data volumes need processing
- Good for trend analysis and event detection

---

## Integration Priority

Based on value vs. implementation effort, recommended integration order:

### Priority 1: German RSS Feeds (High Value, Low Effort)
1. **Börse Frankfurt RSS** - Direct German market news
2. **BaFin RSS** - Regulatory news
3. **ECB/EZB RSS** - Interest rates, monetary policy

### Priority 2: Finance-Specific APIs (High Value, Medium Effort)
1. **Marketaux** - Multi-language, ticker-based, sentiment
2. **Alpha Vantage News** - Already have integration, add news endpoints
3. **Financial Modeling Prep** - Comprehensive, ticker-specific

### Priority 3: Extended Coverage (Medium Value, Medium Effort)
1. **Tiingo News** - Historical archive
2. **mediastack** - Simple German news
3. **NewsData.io** - Additional sources

### Priority 4: Advanced/Research (Lower Priority)
1. **GDELT** - Trend analysis (requires more processing)
2. **NewsAPI.ai** - Advanced intelligence features

---

## Implementation Notes

### RSS Feed Integration Pattern

```typescript
// Example RSS feed service structure
interface RSSFeedConfig {
  name: string;
  url: string;
  language: 'de' | 'en';
  category: 'market' | 'regulatory' | 'macro' | 'general';
  refreshInterval: number; // minutes
}

const GERMAN_RSS_FEEDS: RSSFeedConfig[] = [
  {
    name: 'Börse Frankfurt',
    url: 'https://api.boerse-frankfurt.de/v1/feeds/news.rss',
    language: 'de',
    category: 'market',
    refreshInterval: 5
  },
  // ... more feeds
];

// Example fetch with error handling (backend implementation)
async function fetchRSSFeed(config: RSSFeedConfig): Promise<NewsItem[]> {
  try {
    const response = await fetch(config.url, {
      headers: { 'Accept': 'application/rss+xml, application/xml' }
    });
    
    if (!response.ok) {
      console.error(`RSS fetch failed for ${config.name}: ${response.status}`);
      return [];
    }
    
    const xml = await response.text();
    // Parse XML and validate structure before processing
    // Use established RSS parser library (e.g., rss-parser)
    return parseAndNormalizeRSSItems(xml, config);
  } catch (error) {
    console.error(`RSS feed error for ${config.name}:`, error);
    return [];
  }
}
```

**Note:** RSS feeds should be fetched via the backend proxy to avoid CORS issues. Consider using an established RSS parser library like `rss-parser` for robust XML handling.

### API Provider Pattern (Existing)

New API providers should follow the existing pattern in `frontend/src/services/`:

1. Create provider class (e.g., `marketauxProvider.ts`)
2. Implement standard interface (`fetchStockNews`, `fetchMarketNews`)
3. Add to `dataService.ts` fallback chain
4. Add API key to `.env.example`
5. Update Settings page for key configuration

### News Item Normalization

All sources should normalize to the existing `NewsItem` type:

```typescript
interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // Unix timestamp
  image?: string;
  related?: string[]; // Related ticker symbols
  sentiment?: number; // -1 to 1 if available
  language?: string;  // ISO 639-1 code (e.g., 'de', 'en', 'fr')
                      // Currently focused on 'de' and 'en' in the implementation
}
```

### Backend Proxy Requirements

Some APIs (like NewsAPI) require server-side requests. The backend proxy pattern should be used:

1. Frontend calls `/api/news/...`
2. Backend proxies to actual API
3. Backend handles API key security
4. Backend caches responses (5 min default)

---

## Environment Variables

Add these to `.env.example` when implementing new providers:

```bash
# Marketaux - Finance News API
# Get your free key at: https://www.marketaux.com/register
# VITE_MARKETAUX_API_KEY=your_marketaux_api_key_here

# Financial Modeling Prep - Comprehensive Financial Data
# Get your free key at: https://financialmodelingprep.com/developer
# VITE_FMP_API_KEY=your_fmp_api_key_here

# Tiingo - Institutional News API  
# Get your free key at: https://www.tiingo.com/
# VITE_TIINGO_API_KEY=your_tiingo_api_key_here

# mediastack - Multi-language News API
# Get your free key at: https://mediastack.com/signup
# VITE_MEDIASTACK_API_KEY=your_mediastack_api_key_here
```

---

## Resources

- [RSS 2.0 Specification](https://www.rssboard.org/rss-specification)
- [Atom Feed Specification](https://tools.ietf.org/html/rfc4287)
- [DayTrader News Provider Implementation](../frontend/src/services/newsApiProvider.ts)
- [DayTrader Data Service](../frontend/src/services/dataService.ts)
