export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // Unix timestamp for sorting/merging
  smaFast?: number;
  smaSlow?: number;
  ema200?: number;
  macd?: {
    line: number;
    signal: number;
    hist: number;
  };
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
  };
  adx?: number;
  atr?: number;
  rsi?: number;
  isNewsCandle?: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  message: string;
}

export interface NewsItem {
  headline: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: number;
  source: string;
}

export interface Signal {
  id: string;
  timestamp: number; 
  timestampStr: string;
  type: 'CALL' | 'PUT';
  price: number; // Entry Price
  exitPrice?: number; // Exit Price
  confidence: number;
  timeframe: string;
  regime: string;
  status: 'PENDING' | 'WIN' | 'LOSS';
  pnl?: number;
  strategy?: string;
  aiPrediction?: number; // Predicted price by ML model
  signalStrength?: 'WEAK' | 'MODERATE' | 'STRONG' | 'MAX';
  aiConfidenceScore?: number; // 0-100 score derived from AI certainty
  newsContext?: string; // Which news triggered/influenced this
}

export interface BotStats {
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  activeSignals: number;
  marketRegime: string;
  aiAccuracy: number;
  isTraining?: boolean;
  lastNews?: NewsItem;
}

export interface TelegramConfig {
    botToken: string;
    chatId: string;
    enabled: boolean;
}