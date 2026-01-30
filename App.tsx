import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import LogConsole from './components/LogConsole';
import ChartWidget from './components/ChartWidget';
import SignalCard from './components/SignalCard';
import { Candle, LogEntry, Signal, BotStats, TelegramConfig, NewsItem } from './types';
import { analyzeMarket, calculateIndicators, checkSignals, resampleCandles, formatToIST, trainLSTMModel, LSTMModelData, generateMarketNews } from './utils/simulation';

// TWELVEDATA API KEYS (For History)
const TD_API_KEYS = [
    "d7b552b650a944b9be511980d28a207e",
    "a4f4b744ea454eec86da0e1c0688bb86",
    "bd350e0aa30d441ca220f04256652b78"
];

// FINNHUB API KEYS (For Live WebSocket)
const FINNHUB_KEYS = [
    "d1ro1s9r01qk8n686hdgd1ro1s9r01qk8n686he0",
    "d4906f1r01qshn3k06u0d4906f1r01qshn3k06ug", 
    "cvh4pg1r01qp24kfssigcvh4pg1r01qp24kfssj0",
    "d472qlpr01qh8nnas0t0d472qlpr01qh8nnas0tg"
];

const SYMBOL = 'EUR/USD'; 
const FINNHUB_SYMBOL = 'OANDA:EUR_USD'; 

// REMOVED 1 MINUTE TIMEFRAME AS REQUESTED
const TIMEFRAMES = [
    { label: '5 min', value: 5, id: '5m' },
    { label: '15 min', value: 15, id: '15m' },
    { label: '30 min', value: 30, id: '30m' },
    { label: '45 min', value: 45, id: '45m' },
    { label: '1 hour', value: 60, id: '1h' },
];

const App: React.FC = () => {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedTf, setSelectedTf] = useState(TIMEFRAMES[0]); // Default 5m now
  const [latestNews, setLatestNews] = useState<NewsItem | null>(null);
  
  // New state for Jitter (High Frequency Display)
  const [displayPrice, setDisplayPrice] = useState<number>(0);
  
  const [stats, setStats] = useState<BotStats>({
    totalSignals: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    activeSignals: 0,
    marketRegime: 'INITIALIZING',
    aiAccuracy: 0,
    isTraining: false
  });
  
  const [tgConfig, setTgConfig] = useState<TelegramConfig>({ botToken: '', chatId: '', enabled: false });
  const [showTgModal, setShowTgModal] = useState(false);

  const currentCandleRef = useRef<Candle | null>(null);
  const candlesRef = useRef<Candle[]>([]); 
  const wsRef = useRef<WebSocket | null>(null);
  
  // Refs for state that shouldn't trigger WS reconnection
  const selectedTfRef = useRef(selectedTf);
  const tgConfigRef = useRef(tgConfig);
  const latestNewsRef = useRef(latestNews);
  
  // Ref to track signals synchronously for duplicate prevention
  const signalsRef = useRef<Signal[]>([]);
  
  // AI Model Ref
  const aiModelRef = useRef<LSTMModelData | undefined>(undefined);

  // Sync refs with state
  useEffect(() => { selectedTfRef.current = selectedTf; }, [selectedTf]);
  useEffect(() => { tgConfigRef.current = tgConfig; }, [tgConfig]);
  useEffect(() => { latestNewsRef.current = latestNews; }, [latestNews]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    const newLog: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      level,
      message
    };
    setLogs(prev => [...prev.slice(-99), newLog]);
  }, []);

  // --- HIGH FREQUENCY JITTER (Simulates Millisecond Ticks) ---
  useEffect(() => {
      const interval = setInterval(() => {
          if (currentCandleRef.current) {
              const base = currentCandleRef.current.close;
              // Very small random fluctuation (+/- 0.00002)
              const jitter = (Math.random() - 0.5) * 0.00004;
              setDisplayPrice(base + jitter);
          }
      }, 50); // Updates 20 times per second
      return () => clearInterval(interval);
  }, []);

  // --- NEWS SIMULATION LOOP ---
  useEffect(() => {
    // Generate initial news
    setLatestNews(generateMarketNews());

    // New news every 3-5 minutes (Simulating realistic updates)
    // Random interval between 3 min and 5 min
    const intervalTime = Math.floor(Math.random() * (300000 - 180000 + 1) + 180000);
    
    const newsInterval = setInterval(() => {
        const news = generateMarketNews();
        setLatestNews(news);
        const color = news.sentiment === 'POSITIVE' ? 'green' : news.sentiment === 'NEGATIVE' ? 'red' : 'gray';
        addLog('INFO', `📰 NEWS: [${news.sentiment}] ${news.headline}`);
    }, intervalTime);

    return () => clearInterval(newsInterval);
  }, [addLog]);

  // Use tgConfigRef to avoid dependency changes
  const sendTelegramAlert = useCallback(async (signal: Signal) => {
      const config = tgConfigRef.current;
      if (!config.enabled || !config.botToken || !config.chatId) return;

      const emoji = signal.type === 'CALL' ? '🟢 ⬆️ CALL' : '🔴 ⬇️ PUT';
      const text = `
🤖 <b>AI/ML BOT ALERT</b> 🤖

Asset: ${SYMBOL}
Type: ${emoji}
Entry: ${signal.price.toFixed(5)}
Timeframe: ${signal.timeframe}
Strength: ${signal.signalStrength || 'N/A'}
LSTM Target: ${signal.aiPrediction?.toFixed(5)}
Strategy: ${signal.strategy}
Conf: ${(signal.confidence * 100).toFixed(0)}%
News Ctx: ${signal.newsContext || 'N/A'}
      `;

      try {
          const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
          await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: config.chatId, text: text, parse_mode: 'HTML' })
          });
          addLog('INFO', 'Telegram sent.');
      } catch (err) {
          addLog('ERROR', 'Telegram failed.');
      }
  }, [addLog]);

  // --- WEBSOCKET (FINNHUB) ---
  const initWebSocket = useCallback((keyIndex: number) => {
      if (wsRef.current) wsRef.current.close();

      const apiKey = FINNHUB_KEYS[keyIndex % FINNHUB_KEYS.length]; 
      const wsUrl = `wss://ws.finnhub.io?token=${apiKey}`;
      
      addLog('DEBUG', `Connecting to Finnhub Stream...`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
          addLog('INFO', `🔌 Connected to Live Stream (Finnhub)`);
          ws.send(JSON.stringify({ type: 'subscribe', symbol: FINNHUB_SYMBOL }));
          setIsConnected(true);
      };

      ws.onmessage = (event) => {
          try {
              const message = JSON.parse(event.data);
              
              if (message.type === 'trade' && message.data) {
                  message.data.forEach((trade: any) => {
                      const price = trade.p;
                      const now = Date.now();
                      const minuteKey = formatToIST(now); // Use IST

                      if (!currentCandleRef.current) {
                          currentCandleRef.current = { 
                              time: minuteKey, 
                              open: price, 
                              high: price, 
                              low: price, 
                              close: price, 
                              volume: 0, 
                              timestamp: now 
                          };
                          setCandles(prev => [...prev, currentCandleRef.current!]);
                          setDisplayPrice(price);
                      } else if (currentCandleRef.current.time !== minuteKey) {
                          // CLOSE PREVIOUS 1M CANDLE
                          const completedCandle = { ...currentCandleRef.current };
                          const newHistory = [...candlesRef.current, completedCandle].slice(-3500);
                          
                          // We calculate indicators on the 1m chart for display purposes
                          const withIndicators = calculateIndicators(newHistory);
                          setCandles(withIndicators);
                          candlesRef.current = withIndicators;

                          // --- PARALLEL TIMEFRAME ANALYSIS ---
                          // Analyzes ALL timeframes every minute (even on forming candles)
                          // ensuring no idle waiting time.
                          const activeTfs = TIMEFRAMES; 
                          let signalsFoundCount = 0;
                          
                          activeTfs.forEach(tf => {
                              // CHECK FOR ACTIVE SIGNAL:
                              // If there is already a PENDING signal for this timeframe, do not generate a new one.
                              // Wait for it to expire (WIN/LOSS).
                              const hasActiveSignal = signalsRef.current.some(
                                  s => s.timeframe === tf.id && s.status === 'PENDING'
                              );

                              if (hasActiveSignal) {
                                  // Skip analysis for this TF until current signal expires
                                  return; 
                              }

                              const tfMinutes = tf.value;
                              
                              // RESAMPLE: Includes the latest closed 1m candle
                              const resampled = resampleCandles(withIndicators, tfMinutes);
                              const resampledWithInd = calculateIndicators(resampled);

                              const { signal, regime, debug } = analyzeMarket(
                                  resampledWithInd, 
                                  tf.id, 
                                  aiModelRef.current
                              );

                              if (signal) {
                                  // STRICT QUALITY FILTER:
                                  // Only accept MODERATE, STRONG, or MAX. Reject WEAK.
                                  if (signal.signalStrength === 'WEAK') {
                                      // addLog('DEBUG', `Skipped WEAK signal on ${tf.id}`);
                                      return;
                                  }

                                  setSignals(prev => [signal, ...prev]);
                                  addLog('INFO', `🤖 SIGNAL (${tf.id}): ${signal.type} [${signal.signalStrength}]`);
                                  sendTelegramAlert(signal);
                                  signalsFoundCount++;
                              }

                              // Update stats if this is the currently viewed timeframe
                              if (tf.id === selectedTfRef.current.id) {
                                  setStats(prevStats => ({ ...prevStats, marketRegime: regime }));
                              }
                          });
                          
                          if (signalsFoundCount > 0) {
                              addLog('DEBUG', `⚡ Generated ${signalsFoundCount} High-Quality Signals`);
                          }

                          // Start new candle
                          currentCandleRef.current = { 
                              time: minuteKey, 
                              open: price, 
                              high: price, 
                              low: price, 
                              close: price, 
                              volume: 0, 
                              timestamp: now 
                          };
                      } else {
                          // UPDATE CURRENT CANDLE (SAME MINUTE)
                          const c = currentCandleRef.current;
                          c.high = Math.max(c.high, price);
                          c.low = Math.min(c.low, price);
                          c.close = price;
                          
                          // Update last candle in state
                          setCandles(prev => {
                              if (prev.length === 0) return [c];
                              const next = [...prev];
                              next[next.length - 1] = { ...c };
                              return next;
                          });
                      }
                  });
              }
          } catch (e) {
              console.error("Error parsing WS message", e);
          }
      };

      ws.onclose = () => {
          setIsConnected(false);
          addLog('WARNING', 'Stream disconnected. Switching key & reconnecting in 2s...');
          setTimeout(() => initWebSocket(keyIndex + 1), 2000);
      };
      
      ws.onerror = (e) => {
          console.error("WebSocket Error", e);
      };

  }, [addLog, sendTelegramAlert]);

  const fetchHistoricalData = useCallback(async () => {
    addLog('INFO', '🚀 Starting AI Bot. Fetching 3000+ Candles from TwelveData...');
    
    let loaded = false;
    for (const apiKey of TD_API_KEYS) {
        if (loaded) break;
        try {
            const url = `https://api.twelvedata.com/time_series?symbol=${SYMBOL}&interval=1min&outputsize=3000&apikey=${apiKey}&order=ASC&timezone=UTC`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'ok' && data.values) {
                const histCandles: Candle[] = data.values.map((v: any) => {
                    const utcString = v.datetime.replace(' ', 'T') + 'Z';
                    const ts = new Date(utcString).getTime();
                    
                    return {
                        time: formatToIST(ts), 
                        open: parseFloat(v.open),
                        high: parseFloat(v.high),
                        low: parseFloat(v.low),
                        close: parseFloat(v.close),
                        volume: parseInt(v.volume || '0'),
                        timestamp: ts
                    };
                });

                const withIndicators = calculateIndicators(histCandles);
                setCandles(withIndicators);
                candlesRef.current = withIndicators;
                
                // Initialize display price
                if(histCandles.length > 0) {
                    setDisplayPrice(histCandles[histCandles.length - 1].close);
                }

                loaded = true;
                addLog('INFO', `✅ Loaded ${histCandles.length} candles.`);
                
                // --- TRAIN AI MODEL ---
                setStats(s => ({...s, isTraining: true}));
                addLog('INFO', '🧠 Training LSTM Neural Network... (Optimized for last 500 candles)');
                
                const startTime = Date.now();
                setTimeout(async () => {
                    try {
                        const modelData = await trainLSTMModel(withIndicators);
                        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                        aiModelRef.current = modelData;
                        addLog('INFO', `🎉 LSTM Model Trained in ${duration}s! AI Online.`);
                    } catch (err) {
                        console.error(err);
                        addLog('ERROR', 'Failed to train AI model: ' + (err as any).message);
                    } finally {
                        setStats(s => ({...s, isTraining: false}));
                    }
                }, 100);

                initWebSocket(0);
            } else {
                addLog('WARNING', `TwelveData API limit: ${data.message}`);
            }
        } catch (e) {
            addLog('ERROR', 'Connection error to TwelveData.');
        }
    }
    if (!loaded) addLog('ERROR', 'CRITICAL: Could not fetch history. Analysis will be delayed.');
  }, [addLog, initWebSocket]);

  useEffect(() => {
      fetchHistoricalData();
      return () => {
          if (wsRef.current) wsRef.current.close();
      };
  }, [fetchHistoricalData]);

  useEffect(() => {
      if(candlesRef.current.length > 0) {
          addLog('INFO', `Timeframe switched to ${selectedTf.label}. Chart updating...`);
      }
  }, [selectedTf, addLog]);

  useEffect(() => {
      const interval = setInterval(() => {
          if (currentCandleRef.current && candlesRef.current.length > 0) {
              const currentPrice = currentCandleRef.current.close;
              
              setSignals(prev => checkSignals(prev, currentPrice));

              setStats(prev => {
                  const finished = signals.filter(s => s.status !== 'PENDING');
                  const wins = finished.filter(s => s.status === 'WIN').length;
                  const losses = finished.filter(s => s.status === 'LOSS').length;
                  const total = finished.length;
                  
                  if (total !== prev.totalSignals || signals.length !== prev.totalSignals + prev.activeSignals) {
                       return { 
                          ...prev, 
                          totalSignals: signals.length, 
                          wins, 
                          losses, 
                          winRate: total > 0 ? (wins / total) * 100 : 0, 
                          activeSignals: signals.filter(s => s.status === 'PENDING').length
                      };
                  }
                  return prev;
              });
          }
      }, 1000);
      return () => clearInterval(interval);
  }, [signals]);

  // --- CHART DATA PREPARATION ---
  // Resample 1m candles to the selected timeframe for the chart
  const processedChartData = useMemo(() => {
      if (candles.length === 0) return [];
      
      // If 1m (though removed from UI, logic stays safe), just return the last 100 raw candles
      if (selectedTf.value === 1) return candles.slice(-100);

      // Resample based on selected Timeframe
      const resampled = resampleCandles(candles, selectedTf.value);
      
      // Return last ~50 resampled candles for a clean view
      return resampled.slice(-50);
  }, [candles, selectedTf]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8 font-sans">
      
      {/* Telegram Modal */}
      {showTgModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
              <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 w-96">
                  <h3 className="text-xl font-bold mb-4">Telegram Configuration</h3>
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs text-gray-400">Bot Token</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                            value={tgConfig.botToken}
                            onChange={(e) => setTgConfig(c => ({...c, botToken: e.target.value}))}
                          />
                      </div>
                      <div>
                          <label className="text-xs text-gray-400">Chat ID</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm"
                            value={tgConfig.chatId}
                            onChange={(e) => setTgConfig(c => ({...c, chatId: e.target.value}))}
                          />
                      </div>
                      <div className="flex gap-2 mt-4">
                          <button onClick={() => {setTgConfig(c=>({...c, enabled: true})); setShowTgModal(false);}} className="flex-1 bg-green-600 hover:bg-green-500 py-2 rounded">Enable</button>
                          <button onClick={() => {setTgConfig(c=>({...c, enabled: false})); setShowTgModal(false);}} className="flex-1 bg-gray-600 hover:bg-gray-500 py-2 rounded">Disable</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-4 border-b border-gray-800 pb-4">
        <div>
            <h1 className="text-2xl md:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            Step 6 AI/ML Trading Bot
            </h1>
            <p className="text-gray-400 text-sm mt-1">Engine: LSTM Deep Learning + Technicals</p>
        </div>
        
        <div className="flex gap-4 mt-4 md:mt-0 flex-wrap justify-end">
            
             {/* Timeframe Selector */}
             <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1 border border-gray-700">
                 <span className="text-xs text-gray-500 pl-2">TF:</span>
                 <select 
                    value={selectedTf.id} 
                    onChange={(e) => {
                        const tf = TIMEFRAMES.find(t => t.id === e.target.value);
                        if(tf) setSelectedTf(tf);
                    }}
                    className="bg-transparent text-sm font-bold text-blue-400 outline-none cursor-pointer"
                 >
                     {TIMEFRAMES.map(tf => (
                         <option key={tf.id} value={tf.id} className="bg-gray-800 text-white">
                             {tf.label}
                         </option>
                     ))}
                 </select>
             </div>

             <button 
                onClick={() => setShowTgModal(true)}
                className={`px-4 py-2 rounded-lg border text-sm font-bold flex items-center gap-2 ${tgConfig.enabled ? 'bg-blue-900/30 border-blue-500 text-blue-400' : 'bg-gray-800 border-gray-600 text-gray-400'}`}
             >
                 <span>✈️ Telegram</span>
             </button>

             <div className={`px-4 py-2 rounded-lg flex items-center gap-3 border ${isConnected ? 'bg-gray-800 border-green-500/30' : 'bg-red-900/20 border-red-500'}`}>
                <span className="relative flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                </span>
                <span className={`font-mono font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                    {isConnected ? 'LIVE FEED' : 'CONNECTING'}
                </span>
            </div>
        </div>
      </header>

      {/* News Ticker */}
      {latestNews && (
          <div className={`mb-6 p-3 rounded-lg flex items-center gap-4 animate-fade-in border ${
              latestNews.impact === 'HIGH' ? 'bg-red-900/20 border-red-500/30' : 'bg-gray-800 border-gray-700'
          }`}>
              <div className="flex items-center gap-2">
                  <span className="text-xl">📢</span>
                  <span className="font-bold text-xs bg-gray-900 px-2 py-1 rounded text-gray-300">LIVE NEWS</span>
              </div>
              <div className="flex-1 overflow-hidden">
                  <p className="whitespace-nowrap font-mono text-sm text-gray-200">
                      {latestNews.headline} 
                      <span className={`ml-3 text-xs font-bold ${
                          latestNews.sentiment === 'POSITIVE' ? 'text-green-400' : 
                          latestNews.sentiment === 'NEGATIVE' ? 'text-red-400' : 'text-gray-400'
                      }`}>
                          [{latestNews.sentiment} - {latestNews.impact} IMPACT]
                      </span>
                  </p>
              </div>
          </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Stats & Logs */}
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <p className="text-gray-400 text-xs uppercase tracking-wider">LSTM Status</p>
                    {stats.isTraining ? (
                        <p className="text-lg font-bold text-yellow-400 animate-pulse">Training...</p>
                    ) : aiModelRef.current ? (
                        <p className="text-lg font-bold text-green-400">Online</p>
                    ) : (
                        <p className="text-lg font-bold text-gray-500">Offline</p>
                    )}
                </div>
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Market Regime</p>
                    <p className={`text-xl font-bold ${stats.marketRegime.includes('NEWS') ? 'text-blue-400 animate-pulse' : 'text-purple-400'}`}>
                        {stats.marketRegime}
                    </p>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Win Rate</p>
                    <p className={`text-2xl font-bold ${stats.winRate > 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {stats.winRate.toFixed(1)}%
                    </p>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <p className="text-gray-400 text-xs uppercase tracking-wider">Live Price</p>
                    <p className="text-lg font-bold text-yellow-400 font-mono">
                        {displayPrice.toFixed(5)}
                    </p>
                </div>
            </div>

            <LogConsole logs={logs} />
        </div>

        {/* Middle Column: Chart */}
        <div className="lg:col-span-2 space-y-6">
            {/* Pass displayPrice to widget for animation */}
            <ChartWidget data={processedChartData} signals={signals} currentPrice={displayPrice} />
            
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <h3 className="text-gray-200 font-bold mb-4">AI Predicted Signals (All Timeframes)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-hide">
                    {signals.length === 0 ? (
                        <p className="text-gray-500 italic col-span-2 text-center py-8">
                             {stats.isTraining ? "AI is training on 3000 candles..." : `Waiting for signal from 5m, 15m, 30m, 1h...`}
                        </p>
                    ) : (
                        signals.slice(0, 50).map(sig => (
                            <SignalCard key={sig.id} signal={sig} />
                        ))
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;