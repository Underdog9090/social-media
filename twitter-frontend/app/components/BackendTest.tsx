'use client';

import { useState } from 'react';

export default function BackendTest() {
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testBackend = async () => {
    try {
      const res = await fetch('http://localhost:3001/');
      const data = await res.json();
      setResponse(data.message);
      setError(null);
    } catch (err) {
      setError('Failed to connect to backend');
      setResponse(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={testBackend}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition-colors"
      >
        Test Backend
      </button>
      
      {response && (
        <div className="p-4 bg-green-100 text-green-700 rounded">
          {response}
        </div>
      )}
      
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          {error}
        </div>
      )}
    </div>
  );
} 