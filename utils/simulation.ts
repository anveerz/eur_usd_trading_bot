import { Candle, Signal, NewsItem } from '../types';
import * as tf from '@tensorflow/tfjs';

// --- HELPERS ---

export const formatToIST = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

export const resampleCandles = (candles: Candle[], timeframeMinutes: number): Candle[] => {
    if (timeframeMinutes === 1) return candles;

    const intervalMs = timeframeMinutes * 60 * 1000;
    const groups = new Map<number, Candle[]>();

    for (const c of candles) {
        const bucket = Math.floor(c.timestamp / intervalMs) * intervalMs;
        if (!groups.has(bucket)) groups.set(bucket, []);
        groups.get(bucket)!.push(c);
    }

    const sortedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);
    const resampled: Candle[] = [];

    for (const ts of sortedBuckets) {
        const group = groups.get(ts)!;
        const open = group[0].open;
        const close = group[group.length - 1].close;
        const high = Math.max(...group.map(c => c.high));
        const low = Math.min(...group.map(c => c.low));
        const volume = group.reduce((sum, c) => sum + c.volume, 0);
        
        // Use IST formatter
        const timeStr = formatToIST(ts);

        resampled.push({
            time: timeStr,
            open,
            high,
            low,
            close,
            volume,
            timestamp: ts
        });
    }

    return resampled;
};

// --- NEWS & SENTIMENT ENGINE ---

// Singleton to manage rolling sentiment
export class MarketSentiment {
    private static score: number = 0; // -100 to 100
    private static lastUpdate: number = Date.now();

    static addNews(item: NewsItem) {
        let impactVal = 0;
        if (item.impact === 'HIGH') impactVal = 25;
        if (item.impact === 'MEDIUM') impactVal = 15;
        if (item.impact === 'LOW') impactVal = 5;

        if (item.sentiment === 'NEGATIVE') impactVal = -impactVal;
        if (item.sentiment === 'NEUTRAL') impactVal = 0;

        // Add to rolling score
        this.score += impactVal;
        
        // Cap score
        this.score = Math.max(-100, Math.min(100, this.score));
        this.lastUpdate = Date.now();
    }

    static getScore(): number {
        // Decay score over time (move towards 0)
        // Every request, decay by 1% for simulated realism
        this.score = this.score * 0.995; 
        if (Math.abs(this.score) < 1) this.score = 0;
        return this.score;
    }
}

const NEWS_TEMPLATES = [
    { text: "US CPI Inflation data shows cooling trend", sentiment: 'POSITIVE', impact: 'HIGH' },
    { text: "Federal Reserve hints at interest rate hold", sentiment: 'POSITIVE', impact: 'HIGH' },
    { text: "ECB President Lagarde warning on Eurozone growth", sentiment: 'NEGATIVE', impact: 'MEDIUM' },
    { text: "US Jobless claims higher than expected", sentiment: 'NEGATIVE', impact: 'HIGH' },
    { text: "Geopolitical tensions easing in key regions", sentiment: 'POSITIVE', impact: 'MEDIUM' },
    { text: "Tech sector rally boosting market confidence", sentiment: 'POSITIVE', impact: 'LOW' },
    { text: "Crude Oil inventory surplus reported", sentiment: 'NEGATIVE', impact: 'MEDIUM' },
    { text: "Market consolidation ahead of FOMC minutes", sentiment: 'NEUTRAL', impact: 'LOW' },
    { text: "Retail Sales data disappoints analysts", sentiment: 'NEGATIVE', impact: 'MEDIUM' },
    { text: "German Manufacturing PMI beats expectations", sentiment: 'POSITIVE', impact: 'MEDIUM' }
];

export const generateMarketNews = (): NewsItem => {
    const template = NEWS_TEMPLATES[Math.floor(Math.random() * NEWS_TEMPLATES.length)];
    const item: NewsItem = {
        headline: template.text,
        sentiment: template.sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL',
        impact: template.impact as 'HIGH' | 'MEDIUM' | 'LOW',
        timestamp: Date.now(),
        source: 'Bloomberg (Sim)'
    };
    MarketSentiment.addNews(item);
    return item;
};

// --- DEEP LEARNING: LSTM ---

export interface LSTMModelData {
    model: tf.LayersModel;
    min: number;
    max: number;
    windowSize: number;
}

export const trainLSTMModel = async (candles: Candle[]): Promise<LSTMModelData> => {
    // We need at least 100 candles to train decently
    if(candles.length < 100) throw new Error("Not enough data to train LSTM");

    // OPTIMIZATION: Only use the last 500 candles for training to keep UI responsive
    // Using 3000 candles can freeze the main thread during WebGL texture uploads
    const recentCandles = candles.slice(-500);

    // 1. Preprocess Data (Normalization)
    const closes = recentCandles.map(c => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);

    // Avoid division by zero
    if (max === min) throw new Error("Price data has zero variance, cannot train.");

    const normalized = closes.map(p => (p - min) / (max - min));

    // 2. Create Sequences (Windowing)
    const windowSize = 30;
    const X_data = [];
    const y_data = [];

    for (let i = 0; i < normalized.length - windowSize; i++) {
        X_data.push(normalized.slice(i, i + windowSize));
        y_data.push(normalized[i + windowSize]);
    }

    if (X_data.length === 0) throw new Error("Not enough data for windowing");

    const xs = tf.tensor2d(X_data, [X_data.length, windowSize]);
    const ys = tf.tensor2d(y_data, [y_data.length, 1]);

    // Reshape for LSTM: [batch, timeSteps, features]
    const xsReshaped = xs.reshape([X_data.length, windowSize, 1]);

    // 3. Build LSTM Architecture
    const model = tf.sequential();
    
    // LSTM Layer
    model.add(tf.layers.lstm({
        units: 32, // Reduced units slightly for speed
        returnSequences: false,
        inputShape: [windowSize, 1]
    }));
    
    // Dense Hidden Layer
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    
    // Output Layer
    model.add(tf.layers.dense({ units: 1 }));

    model.compile({ 
        optimizer: tf.train.adam(0.01), 
        loss: 'meanSquaredError' 
    });

    // 4. Train Model
    // epochs: 5 is sufficient for a demo of this scale
    await model.fit(xsReshaped, ys, {
        epochs: 5,
        batchSize: 32,
        shuffle: true,
        verbose: 0 // silent training
    });

    // Cleanup tensors
    xs.dispose();
    ys.dispose();
    xsReshaped.dispose();

    return { model, min, max, windowSize };
};

export const predictLSTM = (modelData: LSTMModelData, recentCandles: Candle[]): number | null => {
    const { model, min, max, windowSize } = modelData;
    
    if (recentCandles.length < windowSize) return null;

    // Extract window and normalize
    const slice = recentCandles.slice(-windowSize).map(c => c.close);
    const normalized = slice.map(p => (p - min) / (max - min));

    // Predict
    return tf.tidy(() => {
        // Fix: Pass 'normalized' (flat array) directly with the shape [1, windowSize, 1].
        // Do NOT wrap 'normalized' in another array, as that creates a 2D array which tensor3d rejects.
        const input = tf.tensor3d(normalized, [1, windowSize, 1]);
        const prediction = model.predict(input) as tf.Tensor;
        const result = prediction.dataSync()[0];
        
        // Denormalize
        return result * (max - min) + min;
    });
};

// --- MATH HELPERS ---
const calcEMA = (val: number, prevEMA: number | undefined, period: number) => {
  if (prevEMA === undefined) return val;
  const k = 2 / (period + 1);
  return val * k + prevEMA * (1 - k);
};

const calcRMA = (val: number, prevRMA: number | undefined, period: number) => {
    if (prevRMA === undefined) return val;
    return (prevRMA * (period - 1) + val) / period;
};

// --- INDICATOR CALCULATION ---
export const calculateIndicators = (candles: Candle[]): Candle[] => {
  const macdFast = 12, macdSlow = 26, macdSignal = 9;
  const bbPeriod = 20, bbMult = 2;
  const adxPeriod = 14;
  const rsiPeriod = 14;

  let ema12: number | undefined, ema26: number | undefined, macdSignalLine: number | undefined;
  let ema200: number | undefined;
  let tr: number, plusDM: number, minusDM: number;
  let smoothTR: number | undefined, smoothPlusDM: number | undefined, smoothMinusDM: number | undefined;
  let prevAdx: number | undefined;
  let avgGain: number | undefined, avgLoss: number | undefined;

  return candles.map((candle, index, array) => {
    const prev = array[index - 1];
    
    // 1. MACD
    ema12 = calcEMA(candle.close, ema12, macdFast);
    ema26 = calcEMA(candle.close, ema26, macdSlow);
    let macd = undefined;
    if (index >= macdSlow) {
        const line = (ema12 || 0) - (ema26 || 0);
        macdSignalLine = calcEMA(line, macdSignalLine, macdSignal);
        macd = { line, signal: macdSignalLine || 0, hist: line - (macdSignalLine || 0) };
    }

    // 2. EMA 200
    ema200 = calcEMA(candle.close, ema200, 200);

    // 3. Bollinger Bands
    let bollinger = undefined;
    if (index >= bbPeriod) {
        const slice = array.slice(index - bbPeriod + 1, index + 1);
        const closes = slice.map(c => c.close);
        const mean = closes.reduce((a, b) => a + b, 0) / bbPeriod;
        const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / bbPeriod;
        const stdDev = Math.sqrt(variance);
        bollinger = { middle: mean, upper: mean + (stdDev * bbMult), lower: mean - (stdDev * bbMult) };
    }

    // 4. ADX & ATR
    let adxVal = undefined;
    let atrVal = undefined;
    if (prev) {
        const highLow = candle.high - candle.low;
        const highClose = Math.abs(candle.high - prev.close);
        const lowClose = Math.abs(candle.low - prev.close);
        tr = Math.max(highLow, highClose, lowClose);
        
        const upMove = candle.high - prev.high;
        const downMove = prev.low - candle.low;
        
        plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
        minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;

        smoothTR = calcRMA(tr, smoothTR, adxPeriod);
        smoothPlusDM = calcRMA(plusDM, smoothPlusDM, adxPeriod);
        smoothMinusDM = calcRMA(minusDM, smoothMinusDM, adxPeriod);
        atrVal = smoothTR;

        if (index > adxPeriod * 2) {
             const plusDI = 100 * (smoothPlusDM || 0) / (smoothTR || 1);
             const minusDI = 100 * (smoothMinusDM || 0) / (smoothTR || 1);
             const dx = 100 * Math.abs(plusDI - minusDI) / ((plusDI + minusDI) || 1);
             prevAdx = calcRMA(dx, prevAdx, adxPeriod);
             adxVal = prevAdx;
        }
    }

    // 5. RSI
    let rsiVal = undefined;
    if (prev) {
        const change = candle.close - prev.close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        if (avgGain === undefined || avgLoss === undefined) {
             if (index === rsiPeriod) {
                 const initialSlice = array.slice(1, rsiPeriod + 1); 
                 const initialGains = initialSlice.reduce((acc, c, i) => {
                     const chg = c.close - array[i].close;
                     return acc + (chg > 0 ? chg : 0);
                 }, 0);
                 const initialLosses = initialSlice.reduce((acc, c, i) => {
                     const chg = c.close - array[i].close;
                     return acc + (chg < 0 ? Math.abs(chg) : 0);
                 }, 0);
                 avgGain = initialGains / rsiPeriod;
                 avgLoss = initialLosses / rsiPeriod;
             }
        } else {
             avgGain = ((avgGain * (rsiPeriod - 1)) + gain) / rsiPeriod;
             avgLoss = ((avgLoss * (rsiPeriod - 1)) + loss) / rsiPeriod;
        }

        if (avgGain !== undefined && avgLoss !== undefined) {
             const rs = avgGain / (avgLoss || 0.0000001);
             rsiVal = 100 - (100 / (1 + rs));
        }
    }

    return { ...candle, macd, bollinger, ema200, adx: adxVal, atr: atrVal, rsi: rsiVal };
  });
};

// --- ADVANCED SIGNAL LOGIC ---
export const analyzeMarket = (
    candles: Candle[], 
    timeframeStr: string,
    aiModelData?: LSTMModelData
): { signal: Signal | null, regime: string, debug?: string } => {
  if (candles.length < 30) return { signal: null, regime: 'GATHERING_DATA' };
  
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  if (!last.macd || !prev.macd || !last.bollinger || !last.adx || !last.rsi || !prev.rsi) {
      return { signal: null, regime: 'CALCULATING' };
  }

  // --- AI PREDICTION (LSTM) ---
  let aiPricePrediction: number | null = null;
  if (aiModelData) {
      try {
        aiPricePrediction = predictLSTM(aiModelData, candles);
      } catch (e) { console.error(e); }
  }
  
  const aiTrend = aiPricePrediction ? (aiPricePrediction > last.close ? 'UP' : 'DOWN') : 'NEUTRAL';
  const aiBullish = aiTrend === 'UP';
  const aiBearish = aiTrend === 'DOWN';

  // Regime Detection
  let regime = 'RANGING';
  const ema200 = last.ema200 || 0;
  if (last.adx > 25) {
      regime = last.close > ema200 ? 'STRONG_BULL_TREND' : 'STRONG_BEAR_TREND';
  } else if (last.adx < 20) {
      regime = 'CHOPPY/SIDEWAYS';
  }

  // --- SCORING ---
  let callScore = 0;
  let putScore = 0;
  let strategyName = "";
  let debugStr = "";

  // 1. SENTIMENT ANALYSIS (ROLLING)
  const sentimentScore = MarketSentiment.getScore();
  let sentimentContext = "";
  
  if (sentimentScore > 5) {
      callScore += Math.min(sentimentScore, 30); // Cap sentiment influence
      sentimentContext = `Bullish Sentiment (+${Math.floor(Math.min(sentimentScore, 30))})`;
      regime = 'NEWS_BULLISH';
  } else if (sentimentScore < -5) {
      putScore += Math.min(Math.abs(sentimentScore), 30);
      sentimentContext = `Bearish Sentiment (+${Math.floor(Math.min(Math.abs(sentimentScore), 30))})`;
      regime = 'NEWS_BEARISH';
  }

  // Include technicals...
  const rsi = last.rsi;
  const isOverbought = rsi > 70;
  const isOversold = rsi < 30;
  const isAboveEma = last.close > ema200;
  
  const bullCross = prev.macd.line < prev.macd.signal && last.macd.line > last.macd.signal;
  const bearCross = prev.macd.line > prev.macd.signal && last.macd.line < last.macd.signal;
  const histImproving = last.macd.hist > prev.macd.hist;
  const histDeclining = last.macd.hist < prev.macd.hist;

  const bbLowerBreak = last.close < last.bollinger.lower;
  const bbUpperBreak = last.close > last.bollinger.upper;
  const bbMidCrossUp = prev.close < last.bollinger.middle && last.close > last.bollinger.middle;
  const bbMidCrossDown = prev.close > last.bollinger.middle && last.close < last.bollinger.middle;

  // STRATEGY A: TREND FOLLOWING
  if (last.adx > 25) {
      if (isAboveEma) {
          if (bullCross) callScore += 25; 
          if (bbMidCrossUp) callScore += 20; 
          if (rsi > 50 && rsi < 70) callScore += 10; 
          if (histImproving && last.macd.hist > 0) callScore += 5;
          if (callScore > 20) strategyName = "Trend Alpha";
      }
      if (!isAboveEma) {
          if (bearCross) putScore += 25;
          if (bbMidCrossDown) putScore += 20;
          if (rsi < 50 && rsi > 30) putScore += 10;
          if (histDeclining && last.macd.hist < 0) putScore += 5;
          if (putScore > 20) strategyName = "Trend Alpha";
      }
  }

  // STRATEGY B: REVERSION (Effective in Ranging or weak trend)
  if (last.adx <= 30) { 
      if (bbLowerBreak) callScore += 30; 
      if (isOversold) callScore += 20; 
      if (bullCross) callScore += 10; 
      if (callScore > 20 && strategyName === "") strategyName = "BB Reversion";

      if (bbUpperBreak) putScore += 30;
      if (isOverbought) putScore += 20;
      if (bearCross) putScore += 10;
      if (putScore > 20 && strategyName === "") strategyName = "BB Reversion";
  }

  // --- AI CONFIDENCE FUSION ---
  let aiConfidence = 0;
  if (aiPricePrediction) {
      const diff = Math.abs(aiPricePrediction - last.close);
      const threshold = last.close * 0.0005; 
      const ratio = Math.min(diff / threshold, 2.0); 
      
      aiConfidence = ratio * 50; 

      if (aiBullish) {
          callScore += aiConfidence;
          if (strategyName) strategyName += " + LSTM";
          else strategyName = "LSTM Pure";
      } else if (aiBearish) {
          putScore += aiConfidence;
          if (strategyName) strategyName += " + LSTM";
          else strategyName = "LSTM Pure";
      }
  }

  if (sentimentContext) {
      strategyName = strategyName ? `${strategyName} & News` : "News Event";
      debugStr += ` [${sentimentContext}]`;
  }

  // OPTIMIZED THRESHOLD: Increased to 70 to ensure High Probability / Strong signals only
  const THRESHOLD = 70;

  // Determine Signal Strength
  const getStrength = (score: number): 'WEAK' | 'MODERATE' | 'STRONG' | 'MAX' => {
      if (score > 100) return 'MAX';
      if (score > 85) return 'STRONG';
      if (score > 70) return 'MODERATE';
      return 'WEAK';
  };

  debugStr = `Call: ${callScore.toFixed(0)}, Put: ${putScore.toFixed(0)} (Req: ${THRESHOLD})${debugStr}`;

  if (callScore >= THRESHOLD && callScore > putScore) {
      return {
          signal: {
              id: `sig_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
              timestamp: Date.now(),
              timestampStr: new Date().toLocaleTimeString(),
              type: 'CALL',
              price: last.close,
              confidence: Math.min(callScore / 150, 0.99), 
              timeframe: timeframeStr, 
              regime,
              status: 'PENDING',
              strategy: strategyName || "Hybrid",
              aiPrediction: aiPricePrediction || 0,
              signalStrength: getStrength(callScore),
              aiConfidenceScore: aiConfidence,
              newsContext: sentimentContext || undefined
          },
          regime,
          debug: debugStr
      };
  }

  if (putScore >= THRESHOLD && putScore > callScore) {
      return {
          signal: {
              id: `sig_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
              timestamp: Date.now(),
              timestampStr: new Date().toLocaleTimeString(),
              type: 'PUT',
              price: last.close,
              confidence: Math.min(putScore / 150, 0.99),
              timeframe: timeframeStr,
              regime,
              status: 'PENDING',
              strategy: strategyName || "Hybrid",
              aiPrediction: aiPricePrediction || 0,
              signalStrength: getStrength(putScore),
              aiConfidenceScore: aiConfidence,
              newsContext: sentimentContext || undefined
          },
          regime,
          debug: debugStr
      };
  }

  return { signal: null, regime, debug: debugStr };
};

export const checkSignals = (signals: Signal[], currentPrice: number): Signal[] => {
    return signals.map(sig => {
        if (sig.status !== 'PENDING') return sig;

        const now = Date.now();
        
        let minutes = 5; // Default fallback
        if (sig.timeframe.endsWith('m')) minutes = parseInt(sig.timeframe);
        if (sig.timeframe.endsWith('h')) minutes = parseInt(sig.timeframe) * 60;
        
        const duration = minutes * 60 * 1000;
        const elapsed = now - sig.timestamp;

        if (elapsed >= duration) {
            let status: 'WIN' | 'LOSS' = 'LOSS';
            let pnl = -1;
            
            if (sig.type === 'CALL' && currentPrice > sig.price) {
                status = 'WIN';
                pnl = 0.85; 
            } else if (sig.type === 'PUT' && currentPrice < sig.price) {
                status = 'WIN';
                pnl = 0.85;
            }

            return { ...sig, status, pnl, exitPrice: currentPrice };
        }
        return sig;
    });
};