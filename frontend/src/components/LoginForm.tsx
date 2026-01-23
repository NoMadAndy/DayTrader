/**
 * Login Form Component
 */

import { useState } from 'react';
import { login } from '../services/authService';

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password);

    setIsLoading(false);

    if (result.success) {
      onSuccess?.();
    } else {
      setError(result.error || 'Login fehlgeschlagen');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-gray-400 mb-1">E-Mail</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="name@example.com"
          required
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">Passwort</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="••••••••"
          required
          disabled={isLoading}
        />
      </div>

      {error && (
        <div className="p-2 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 rounded-lg text-white text-sm font-medium transition-colors"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Einloggen...
          </span>
        ) : (
          'Einloggen'
        )}
      </button>
    </form>
  );
}
