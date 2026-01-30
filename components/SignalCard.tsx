import React from 'react';
import { Signal } from '../types';

interface SignalCardProps {
  signal: Signal;
}

const SignalCard: React.FC<SignalCardProps> = ({ signal }) => {
  const isCall = signal.type === 'CALL';
  
  let borderColor = 'border-gray-600';
  if (signal.status === 'WIN') borderColor = 'border-green-400';
  if (signal.status === 'LOSS') borderColor = 'border-red-600';
  if (signal.status === 'PENDING') borderColor = isCall ? 'border-green-600' : 'border-red-600';

  // Strength Bar Colors
  const getStrengthColor = (str: string | undefined) => {
      switch(str) {
          case 'MAX': return 'bg-purple-500';
          case 'STRONG': return 'bg-green-500';
          case 'MODERATE': return 'bg-yellow-500';
          default: return 'bg-gray-500';
      }
  };

  const strengthColor = getStrengthColor(signal.signalStrength);

  return (
    <div className={`border-l-4 ${borderColor} bg-gray-800 rounded-lg p-4 mb-2 shadow-lg animate-fade-in-up relative overflow-hidden`}>
       {/* Background Pulse for Pending */}
       {signal.status === 'PENDING' && (
           <div className={`absolute top-0 right-0 w-2 h-2 rounded-full m-2 animate-ping ${isCall ? 'bg-green-500' : 'bg-red-500'}`}></div>
       )}

      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
            <span className={`text-xl font-bold ${isCall ? 'text-green-400' : 'text-red-400'}`}>
                {signal.type}
            </span>
            <div className="flex flex-col">
                 <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
                    {signal.strategy}
                </span>
            </div>
        </div>
        <span className="text-gray-400 text-xs font-mono">{signal.timestampStr}</span>
      </div>

      {/* Signal Strength Meter */}
      <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-400 uppercase">Strength:</span>
          <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full ${strengthColor}`} 
                style={{ 
                    width: signal.signalStrength === 'MAX' ? '100%' : 
                           signal.signalStrength === 'STRONG' ? '75%' : 
                           signal.signalStrength === 'MODERATE' ? '50%' : '25%' 
                }}
              ></div>
          </div>
          <span className={`text-xs font-bold ${strengthColor.replace('bg-', 'text-')}`}>
              {signal.signalStrength || 'WEAK'}
          </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-sm mt-2">
        <div>
            <p className="text-gray-500 text-xs uppercase">Entry Price</p>
            <p className="font-mono text-gray-200 text-base">{signal.price.toFixed(5)}</p>
        </div>
        <div className="text-right">
            <p className="text-gray-500 text-xs uppercase">Exit Price</p>
            {signal.exitPrice ? (
                <p className={`font-mono text-base ${signal.status === 'WIN' ? 'text-green-400' : 'text-red-400'}`}>
                    {signal.exitPrice.toFixed(5)}
                </p>
            ) : (
                <p className="font-mono text-gray-400 text-base animate-pulse">Running...</p>
            )}
        </div>
      </div>

      {signal.aiPrediction && (
          <div className="mt-2 bg-gray-900/50 p-2 rounded text-xs border border-gray-700">
              <div className="flex justify-between items-center mb-1">
                  <span className="text-purple-400 font-bold">🧠 LSTM Target</span>
                  <span className="font-mono text-gray-300">{signal.aiPrediction.toFixed(5)}</span>
              </div>
              {signal.aiConfidenceScore !== undefined && (
                   <div className="flex items-center gap-2">
                       <span className="text-gray-500 scale-90">Conf:</span>
                       <div className="flex-1 h-1 bg-gray-700 rounded-full">
                           <div 
                             className="h-full bg-blue-400 rounded-full" 
                             style={{width: `${Math.min(signal.aiConfidenceScore, 100)}%`}}
                           ></div>
                       </div>
                   </div>
              )}
          </div>
      )}

      <div className="mt-2 pt-2 border-t border-gray-700 flex justify-between items-center">
          <span className="text-xs text-gray-500">{signal.timeframe} Expiry</span>
          <div className="flex items-center justify-end gap-1">
                {signal.status === 'PENDING' ? (
                     <span className="font-bold text-yellow-400 text-xs">IN PROGRESS</span>
                ) : (
                    <span className={`font-bold text-sm ${signal.status === 'WIN' ? 'text-green-400' : 'text-red-500'}`}>
                        {signal.status === 'WIN' ? 'ITM (+85%)' : 'OTM (-100%)'}
                    </span>
                )}
            </div>
      </div>
    </div>
  );
};

export default SignalCard;