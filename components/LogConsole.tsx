import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogConsoleProps {
  logs: LogEntry[];
}

const LogConsole: React.FC<LogConsoleProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'INFO': return 'text-blue-400';
      case 'WARNING': return 'text-yellow-400';
      case 'ERROR': return 'text-red-400';
      case 'DEBUG': return 'text-gray-500';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="bg-black/50 backdrop-blur-sm border border-gray-800 rounded-lg p-4 h-64 md:h-96 flex flex-col font-mono text-xs md:text-sm">
      <div className="flex items-center justify-between mb-2 border-b border-gray-800 pb-2">
        <span className="font-semibold text-gray-400">Step6EURUSDBot.log</span>
        <div className="flex gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide space-y-1">
        {logs.map((log) => (
          <div key={log.id} className="break-words">
            <span className="text-gray-500">[{log.timestamp}]</span>{' '}
            <span className={`font-bold ${getLevelColor(log.level)}`}>{log.level}</span>{' '}
            <span className="text-gray-300">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default LogConsole;