'use client';

import { useState, useEffect } from 'react';

interface User {
  id: string;
  username: string;
  displayName: string;
  photos: Array<{ value: string }> | string[];
}

export default function TwitterLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/profile', {
        credentials: 'include',
      });
      const data = await response.json();
      setIsAuthenticated(data.success);
      if (data.success) {
        setUser(data.user);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setIsAuthenticated(false);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('http://localhost:3001/auth/logout', {
        method: 'GET',
        credentials: 'include',
      });
      
      if (response.ok) {
        setIsAuthenticated(false);
        setUser(null);
        // Force a hard refresh to clear all state
        window.location.href = '/';
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Failed to log out');
      }
    } catch (err: any) {
      console.error('Logout failed:', err);
      setError(err.message || 'Failed to log out. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getUserPhoto = (user: User) => {
    if (Array.isArray(user.photos) && user.photos.length > 0) {
      if (typeof user.photos[0] === 'string') {
        return user.photos[0];
      }
      return user.photos[0].value;
    }
    return 'https://abs.twimg.com/sticky/default_profile_images/default_profile.png';
  };

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <img
            src={getUserPhoto(user)}
            alt={user.displayName}
            className="w-10 h-10 rounded-full border-2 border-blue-500"
          />
          <div className="text-left">
            <p className="font-medium text-gray-900">{user.displayName}</p>
            <p className="text-sm text-gray-500">@{user.username}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          disabled={isLoading}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Logging out...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Logout</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4">
      <a
        href="http://localhost:3001/auth/twitter"
        className="inline-flex items-center px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-lg hover:shadow-xl"
      >
        <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 24 24">
          <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
        </svg>
        <span className="font-medium">Login with Twitter</span>
      </a>
      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}
    </div>
  );
} 