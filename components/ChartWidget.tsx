import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Candle, Signal } from '../types';

interface ChartWidgetProps {
  data: Candle[];
  signals: Signal[];
  currentPrice?: number;
}

const ChartWidget: React.FC<ChartWidgetProps> = ({ data, signals, currentPrice }) => {
  const latestPrice = currentPrice || (data.length > 0 ? data[data.length - 1].close : 0);
  
  // Calculate domain based on data + current price to keep lines in view
  const allLows = data.map(d => d.low);
  if (currentPrice) allLows.push(currentPrice);
  
  const allHighs = data.map(d => d.high);
  if (currentPrice) allHighs.push(currentPrice);

  const minPrice = Math.min(...allLows) * 0.9995;
  const maxPrice = Math.max(...allHighs) * 1.0005;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 h-64 md:h-96 w-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-200">EUR/USD - Chart</h3>
        <span className="text-2xl font-mono text-green-400">{latestPrice.toFixed(5)}</span>
      </div>
      
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="time" 
            stroke="#9CA3AF" 
            tick={{fontSize: 10}}
            interval={Math.floor(data.length / 5)}
          />
          <YAxis 
            domain={[minPrice, maxPrice]} 
            stroke="#9CA3AF" 
            tick={{fontSize: 10}} 
            tickFormatter={(val) => val.toFixed(5)}
            width={60}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1F2937', border: 'none', color: '#F3F4F6' }}
            itemStyle={{ color: '#F3F4F6' }}
            labelStyle={{ color: '#9CA3AF' }}
          />
          <Area 
            type="monotone" 
            dataKey="close" 
            stroke="#10B981" 
            fillOpacity={1} 
            fill="url(#colorPrice)" 
            isAnimationActive={false}
          />
          {/* Signal Markers */}
          {signals.map(sig => (
             <ReferenceLine 
                key={sig.id} 
                x={sig.timestampStr} 
                stroke={sig.type === 'CALL' ? '#34D399' : '#F87171'} 
                label={{ 
                    value: sig.type === 'CALL' ? '⬆' : '⬇', 
                    position: 'top', 
                    fill: sig.type === 'CALL' ? '#34D399' : '#F87171',
                    fontSize: 20
                }} 
             />
          ))}
          {/* Current Price Line */}
          {currentPrice && (
              <ReferenceLine y={currentPrice} stroke="#FBBF24" strokeDasharray="3 3" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ChartWidget;