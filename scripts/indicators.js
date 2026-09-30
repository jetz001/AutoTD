// AutoTD Quantitative Multi-Indicator Math Engine
// Pure mathematical implementation with zero external dependencies
// Compatible with Node.js CommonJS (GitHub Actions / Cloud Runner)

// 1. Basic Moving Averages
function calculateSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      result.push(sum / period);
    }
  }
  return result;
}

function calculateEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let prevEma = NaN;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      prevEma = sum / period;
      result.push(prevEma);
    } else {
      prevEma = data[i] * k + prevEma * (1 - k);
      result.push(prevEma);
    }
  }
  return result;
}

// 2. Average True Range (ATR 14)
function calculateATR(candles, period = 14) {
  if (candles.length < 2) return candles.map(() => 0);
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  const atr = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      sum += tr[i];
      atr.push(NaN);
    } else if (i === period - 1) {
      sum += tr[i];
      atr.push(sum / period);
    } else {
      const prev = atr[i - 1];
      atr.push((prev * (period - 1) + tr[i]) / period);
    }
  }
  return atr;
}

// 3. SuperTrend (10, 3)
function calculateSuperTrend(candles, period = 10, multiplier = 3.0) {
  const atr = calculateATR(candles, period);
  const result = []; // { supertrend, direction: 1 (bullish) | -1 (bearish) }

  let prevUpper = 0;
  let prevLower = 0;
  let prevSupertrend = 0;
  let prevDirection = 1;

  for (let i = 0; i < candles.length; i++) {
    if (isNaN(atr[i])) {
      result.push({ supertrend: candles[i].close, direction: 1 });
      continue;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    let basicUpper = hl2 + multiplier * atr[i];
    let basicLower = hl2 - multiplier * atr[i];

    let finalUpper = basicUpper;
    let finalLower = basicLower;

    if (i > 0) {
      const prevClose = candles[i - 1].close;
      finalUpper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
      finalLower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;
    }

    let direction = prevDirection;
    let supertrend = prevSupertrend;

    if (prevSupertrend === prevUpper) {
      direction = candles[i].close > finalUpper ? 1 : -1;
    } else {
      direction = candles[i].close < finalLower ? -1 : 1;
    }

    supertrend = direction === 1 ? finalLower : finalUpper;

    prevUpper = finalUpper;
    prevLower = finalLower;
    prevSupertrend = supertrend;
    prevDirection = direction;

    result.push({ supertrend, direction });
  }

  return result;
}

// 4. Relative Strength Index (RSI 14)
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return closes.map(() => 50);
  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  const rsi = [50];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - (100 / (1 + rs)));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }

  return rsi;
}

// 5. Stochastic RSI (14, 14, 3, 3)
function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const rsi = calculateRSI(closes, rsiPeriod);
  const stochKRaw = [];

  for (let i = 0; i < rsi.length; i++) {
    if (i < stochPeriod - 1) {
      stochKRaw.push(50);
    } else {
      let minRsi = Infinity;
      let maxRsi = -Infinity;
      for (let j = 0; j < stochPeriod; j++) {
        const val = rsi[i - j];
        if (val < minRsi) minRsi = val;
        if (val > maxRsi) maxRsi = val;
      }
      const range = maxRsi - minRsi;
      stochKRaw.push(range === 0 ? 50 : ((rsi[i] - minRsi) / range) * 100);
    }
  }

  const k = calculateSMA(stochKRaw, kPeriod).map(v => isNaN(v) ? 50 : v);
  const d = calculateSMA(k, dPeriod).map(v => isNaN(v) ? 50 : v);

  return { k, d };
}

// 6. Bollinger Bands (20, 2)
function calculateBollingerBands(closes, period = 20, multiplier = 2.0) {
  const sma = calculateSMA(closes, period);
  const result = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(sma[i])) {
      result.push({ middle: closes[i], upper: closes[i] * 1.02, lower: closes[i] * 0.98, percentB: 50, bandwidth: 4 });
      continue;
    }
    let variance = 0;
    for (let j = 0; j < period; j++) {
      variance += Math.pow(closes[i - j] - sma[i], 2);
    }
    const stdDev = Math.sqrt(variance / period);
    const upper = sma[i] + multiplier * stdDev;
    const lower = sma[i] - multiplier * stdDev;
    const bandwidth = sma[i] === 0 ? 0 : ((upper - lower) / sma[i]) * 100;
    const percentB = upper === lower ? 50 : ((closes[i] - lower) / (upper - lower)) * 100;

    result.push({ middle: sma[i], upper, lower, percentB, bandwidth });
  }

  return result;
}

// 7. MACD (12, 26, 9)
function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);
  const macdLine = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(fastEma[i]) || isNaN(slowEma[i])) {
      macdLine.push(0);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }

  const signalLine = calculateEMA(macdLine, signalPeriod).map(v => isNaN(v) ? 0 : v);
  const histogram = macdLine.map((val, idx) => val - signalLine[idx]);

  return { macdLine, signalLine, histogram };
}

// 8. Choppiness Index (CHOP 14)
function calculateChoppinessIndex(candles, period = 14) {
  if (candles.length < period + 1) return candles.map(() => 50);

  // True Range calculation
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }

  const result = [];
  const logPeriod = Math.log10(period);

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      result.push(50);
      continue;
    }

    let sumTr = 0;
    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = 0; j < period; j++) {
      sumTr += tr[i - j];
      if (candles[i - j].high > highestHigh) highestHigh = candles[i - j].high;
      if (candles[i - j].low < lowestLow) lowestLow = candles[i - j].low;
    }

    const hlRange = highestHigh - lowestLow;
    if (hlRange === 0 || sumTr === 0) {
      result.push(50);
    } else {
      const chop = (100 * Math.log10(sumTr / hlRange)) / logPeriod;
      result.push(Math.min(100, Math.max(0, chop)));
    }
  }

  return result;
}

// 9. Volume Weighted Average Price (VWAP)
function calculateVWAP(candles) {
  let cumVolume = 0;
  let cumTypicalVolume = 0;
  const vwap = [];

  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = candles[i].volume || 1;
    cumVolume += vol;
    cumTypicalVolume += typicalPrice * vol;
    vwap.push(cumVolume > 0 ? cumTypicalVolume / cumVolume : candles[i].close);
  }

  return vwap;
}

// 10. Money Flow Index (MFI 14)
function calculateMFI(candles, period = 14) {
  if (candles.length < period + 1) return candles.map(() => 50);

  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const rmf = tp.map((p, idx) => p * (candles[idx].volume || 1));

  const posFlow = [0];
  const negFlow = [0];

  for (let i = 1; i < candles.length; i++) {
    if (tp[i] > tp[i - 1]) {
      posFlow.push(rmf[i]);
      negFlow.push(0);
    } else if (tp[i] < tp[i - 1]) {
      posFlow.push(0);
      negFlow.push(rmf[i]);
    } else {
      posFlow.push(0);
      negFlow.push(0);
    }
  }

  const mfi = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      mfi.push(50);
      continue;
    }

    let posSum = 0;
    let negSum = 0;
    for (let j = 0; j < period; j++) {
      posSum += posFlow[i - j];
      negSum += negFlow[i - j];
    }

    if (negSum === 0) {
      mfi.push(100);
    } else {
      const mr = posSum / negSum;
      mfi.push(100 - (100 / (1 + mr)));
    }
  }

  return mfi;
}

// 11. Auto Fibonacci Retracement & Extension
function calculateFibonacci(candles, lookback = 20) {
  const windowCandles = candles.slice(-lookback);
  let high = -Infinity;
  let low = Infinity;

  for (const c of windowCandles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }

  const diff = high - low;
  return {
    high,
    low,
    diff,
    retrace236: high - diff * 0.236,
    retrace382: high - diff * 0.382,
    retrace500: high - diff * 0.500,
    retrace618: high - diff * 0.618,
    retrace786: high - diff * 0.786,
    ext1272: high + diff * 0.272,
    ext1618: high + diff * 0.618,
  };
}

// =========================================================================
// 12. QUANT CONFLUENCE SCORING ENGINE (Single Timeframe)
// =========================================================================
function analyzeTimeframeIndicators(candles) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      score: 50,
      trendScore: 50,
      momentumScore: 50,
      volatilityScore: 50,
      volumeScore: 50,
      chopIndex: 50,
      supertrendDir: 1,
      rsiVal: 50,
      stochK: 50,
      bollPctB: 50,
      atrVal: 0,
      dominantSignal: 'NEUTRAL'
    };
  }

  const closes = candles.map(c => c.close);
  const lastIdx = candles.length - 1;
  const currentPrice = closes[lastIdx];

  // 1. Trend: SuperTrend + EMA Ribbon (9, 21, 50)
  const stSeries = calculateSuperTrend(candles, 10, 3.0);
  const stCurrent = stSeries[lastIdx];
  const ema9 = calculateEMA(closes, 9)[lastIdx];
  const ema21 = calculateEMA(closes, 21)[lastIdx];
  const ema50 = calculateEMA(closes, 50)[lastIdx];

  let trendScore = 50;
  if (stCurrent.direction === 1) trendScore += 25; // SuperTrend Bullish
  else trendScore -= 20;

  if (currentPrice > ema21) trendScore += 15;
  if (ema9 > ema21 && ema21 > ema50) trendScore += 10; // Bullish alignment
  trendScore = Math.min(100, Math.max(0, trendScore));

  // 2. Momentum: RSI (14) + MACD (12, 26, 9) + Stoch RSI (14, 14, 3, 3)
  const rsiSeries = calculateRSI(closes, 14);
  const rsiCurrent = rsiSeries[rsiSeries.length - 1];
  const stochRsi = calculateStochRSI(closes);
  const stochK = stochRsi.k[stochRsi.k.length - 1];
  const stochD = stochRsi.d[stochRsi.d.length - 1];
  const macd = calculateMACD(closes);
  const macdHist = macd.histogram[macd.histogram.length - 1];
  const prevMacdHist = macd.histogram[macd.histogram.length - 2] || 0;

  let momentumScore = 50;
  // RSI Oversold / Dip bounce bonus
  if (rsiCurrent <= 32) momentumScore += 35;
  else if (rsiCurrent <= 42) momentumScore += 25;
  else if (rsiCurrent <= 55) momentumScore += 12;
  else if (rsiCurrent >= 75) momentumScore -= 25; // Overbought penalty

  // Stoch RSI Bullish turn
  if (stochK <= 25 && stochK > stochD) momentumScore += 15;
  // MACD turning positive
  if (macdHist > prevMacdHist) momentumScore += 10;
  momentumScore = Math.min(100, Math.max(0, momentumScore));

  // 3. Volatility & Dip: Bollinger Bands (%B) + ATR
  const bbSeries = calculateBollingerBands(closes, 20, 2.0);
  const bbCurrent = bbSeries[lastIdx];
  const atrSeries = calculateATR(candles, 14);
  const atrCurrent = atrSeries[lastIdx];

  let volScore = 50;
  // Close near lower band (%B < 25%) indicates prime dip buy zone
  if (bbCurrent.percentB <= 15) volScore += 35;
  else if (bbCurrent.percentB <= 35) volScore += 25;
  else if (bbCurrent.percentB <= 55) volScore += 15;
  else if (bbCurrent.percentB >= 85) volScore -= 20;
  volScore = Math.min(100, Math.max(0, volScore));

  // 4. Volume & Money Flow: MFI + VWAP
  const mfiSeries = calculateMFI(candles, 14);
  const mfiCurrent = mfiSeries[lastIdx];
  const vwapSeries = calculateVWAP(candles);
  const vwapCurrent = vwapSeries[lastIdx];

  let volumeScore = 50;
  if (mfiCurrent <= 30) volumeScore += 30; // MFI oversold accumulation
  else if (mfiCurrent <= 45) volumeScore += 18;
  else if (mfiCurrent >= 75) volumeScore -= 15;

  if (currentPrice >= vwapCurrent * 0.99 && currentPrice <= vwapCurrent * 1.02) {
    volumeScore += 15; // Clean bounce from intraday VWAP
  }
  volumeScore = Math.min(100, Math.max(0, volumeScore));

  // 5. Market Regime Filter: Choppiness Index (CHOP)
  const chopSeries = calculateChoppinessIndex(candles, 14);
  const chopCurrent = chopSeries[lastIdx];

  // Confluence Calculation: Momentum 30% + Trend 25% + Volatility Dip 25% + Volume 20%
  let rawConfluence = (momentumScore * 0.30) + (trendScore * 0.25) + (volScore * 0.25) + (volumeScore * 0.20);

  // CHOP Filter: If market is sideways chop (CHOP > 61.8), apply penalty
  if (chopCurrent > 61.8) {
    rawConfluence = rawConfluence * 0.85; // 15% discount for choppy market
  }

  const finalScore = Math.min(99, Math.max(10, Math.round(rawConfluence)));

  // Identify Dominant Trigger
  let dominantSignal = 'NEUTRAL';
  if (bbCurrent.percentB <= 25 && rsiCurrent <= 38) dominantSignal = 'BOLL_RSI_DIP';
  else if (stCurrent.direction === 1 && stochK <= 30 && stochK > stochD) dominantSignal = 'SUPERTREND_STOCH_CROSS';
  else if (rsiCurrent <= 35) dominantSignal = 'RSI_OVERSOLD';
  else if (mfiCurrent <= 30) dominantSignal = 'MFI_ACCUMULATION';
  else if (trendScore >= 75) dominantSignal = 'TREND_ALIGNMENT';
  else if (bbCurrent.percentB <= 20) dominantSignal = 'BOLLINGER_LOWER_BOUNCE';

  return {
    score: finalScore,
    trendScore,
    momentumScore,
    volatilityScore: volScore,
    volumeScore,
    chopIndex: Math.round(chopCurrent),
    supertrendDir: stCurrent.direction,
    supertrendPrice: stCurrent.supertrend,
    rsiVal: Math.round(rsiCurrent),
    stochK: Math.round(stochK),
    bollPctB: Math.round(bbCurrent.percentB),
    bollLower: bbCurrent.lower,
    bollUpper: bbCurrent.upper,
    atrVal: atrCurrent,
    dominantSignal
  };
}

// =========================================================================
// 13. MULTI-TIMEFRAME CONFLUENCE AGGREGATOR (5m, 15m, 1h)
// =========================================================================
function calculateMultiTimeframeConfluence(candles5m, candles15m, candles1h) {
  const ana5m = analyzeTimeframeIndicators(candles5m);
  const ana15m = analyzeTimeframeIndicators(candles15m);
  const ana1h = analyzeTimeframeIndicators(candles1h);

  // Weighted Timeframe Confluence: 5m (35%), 15m (40%), 1h (25%)
  const totalScore = Math.round(
    (ana5m.score * 0.35) +
    (ana15m.score * 0.40) +
    (ana1h.score * 0.25)
  );

  // Grade: A+ (>= 80), A (70-79), B (55-69), C (< 55)
  let grade = 'C';
  if (totalScore >= 80) grade = 'A+';
  else if (totalScore >= 70) grade = 'A';
  else if (totalScore >= 55) grade = 'B';

  // Best Timeframe Anchor: whichever gave the cleanest dip/reversal
  let bestTf = '15m';
  if (ana5m.score >= ana15m.score && ana5m.score >= ana1h.score) bestTf = '5m';
  else if (ana1h.score > ana15m.score && ana1h.score > ana5m.score) bestTf = '1h';

  // Primary trigger description
  const primaryIndicator = ana15m.dominantSignal !== 'NEUTRAL' 
    ? ana15m.dominantSignal 
    : ana5m.dominantSignal !== 'NEUTRAL' 
    ? ana5m.dominantSignal 
    : ana1h.dominantSignal;

  return {
    totalScore,
    grade,
    bestTf,
    primaryIndicator,
    isSupertrendBullish: ana15m.supertrendDir === 1 || ana1h.supertrendDir === 1,
    timeframes: {
      '5m': ana5m,
      '15m': ana15m,
      '1h': ana1h
    }
  };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateATR,
  calculateSuperTrend,
  calculateRSI,
  calculateStochRSI,
  calculateBollingerBands,
  calculateMACD,
  calculateChoppinessIndex,
  calculateVWAP,
  calculateMFI,
  calculateFibonacci,
  analyzeTimeframeIndicators,
  calculateMultiTimeframeConfluence
};
