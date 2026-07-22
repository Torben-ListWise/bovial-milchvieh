---
name: Milchvieh DWD Weather-Conception Correlation
description: Architecture decisions for the DWD weather × conception rate correlation feature
---

## Overview
Correlates DWD temperature/THI with monthly conception rates (BRED→PREG events) per dataset.

## Data source
- **Bright Sky API** (`https://api.brightsky.dev`) wraps DWD open data (CDC), CC BY 4.0
- No API key required; `lat` + `lon` + `date` + `last_date` → hourly JSON
- Aggregate hourly to daily: tempMean/tempMax/tempMin, humidityMean, thiMax/thiMean
- Batch size: 90 days per request to be conservative

## DB table: weather_daily_cache
```sql
CREATE TABLE weather_daily_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lat100 INTEGER NOT NULL,   -- ROUND(lat * 100) — integer key avoids float comparison issues
  lon100 INTEGER NOT NULL,   -- ROUND(lon * 100)
  date TEXT NOT NULL,        -- YYYY-MM-DD
  temp_mean REAL, temp_max REAL, temp_min REAL,
  humidity_mean REAL, thi_max REAL, thi_mean REAL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX weather_daily_cache_unique ON weather_daily_cache (lat100, lon100, date);
```

**Why integer keys:** Floating point equality in SQL causes silent misses. Integer keys (lat*100) avoid this.

**Why shared cache:** Farms in the same ~1.1km grid share weather rows — reduces API calls.

## Key files
- `lib/db/src/schema/weatherCache.ts` — Drizzle schema
- `artifacts/api-server/src/lib/weatherClient.ts` — Bright Sky fetch + ensureWeatherCached + getWeatherForDates
- `artifacts/api-server/src/lib/weatherConception.ts` — computeWeatherConceptionCorrelation + Pearson r
- `artifacts/api-server/src/routes/weather-conception.ts` — GET /api/datasets/:id/weather-conception?offset=0
- `artifacts/milchvieh/src/pages/app/weather-conception.tsx` — WeatherConceptionPage + WeatherConceptionCard

## Agent tool
- Name: `get_weather_conception_correlation`
- Input: `offset_days` (0 = breeding day, negative = days before)
- Handler uses `(usersTable as any).lat/lng` pattern (same as THI batch)
- After returning data, agent MUST call emit_chart with dual-axis (yAxisId left/right)

## Offset parameter
- 0 = temperature on day of insemination (sperm quality / early embryo)  
- -21 to -56 = temperature during oocyte maturation (3-8 weeks before)
- Frontend offers -56 to 0 in 7-day steps

## Pearson r interpretation
- |r| >= 0.5 = strong, |r| >= 0.3 = moderate, else = none
- Negative r = heat stress reduces conception rate (expected relationship)
