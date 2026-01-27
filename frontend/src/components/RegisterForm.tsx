/**
 * Registration Form Component
 */

import { useState } from 'react';
import { register, login } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';

interface RegisterFormProps {
  onSuccess?: () => void;
}

export function RegisterForm({ onSuccess }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { t, language } = useSettings();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError(language === 'de' ? 'Passwörter stimmen nicht überein' : 'Passwords do not match');
      return;
    }

    // Validate password strength
    if (password.length < 8) {
      setError(language === 'de' ? 'Passwort muss mindestens 8 Zeichen lang sein' : 'Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    // Register
    const registerResult = await register(email, password, username || undefined);

    if (!registerResult.success) {
      setIsLoading(false);
      setError(registerResult.error || t('register.failed'));
      return;
    }

    // Auto-login after registration
    const loginResult = await login(email, password);

    setIsLoading(false);

    if (loginResult.success) {
      onSuccess?.();
    } else {
      // Registration succeeded but login failed - still call success
      onSuccess?.();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-gray-400 mb-1">
          {t('register.username')} <span className="text-gray-500">({t('trading.optional')})</span>
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder="MaxMustermann"
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">{t('register.email')}</label>
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
        <label className="block text-sm text-gray-400 mb-1">{t('register.password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder={language === 'de' ? 'Mindestens 8 Zeichen' : 'At least 8 characters'}
          required
          minLength={8}
          disabled={isLoading}
        />
      </div>

      <div>
        <label className="block text-sm text-gray-400 mb-1">{t('register.confirmPassword')}</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          placeholder={language === 'de' ? 'Passwort wiederholen' : 'Repeat password'}
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
        className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 rounded-lg text-white text-sm font-medium transition-colors"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {t('register.registering')}
          </span>
        ) : (
          t('register.submit')
        )}
      </button>

      <p className="text-xs text-gray-500 text-center">
        {language === 'de' 
          ? 'Mit der Registrierung akzeptierst du unsere Nutzungsbedingungen.'
          : 'By registering, you accept our terms of service.'}
      </p>
    </form>
  );
}
