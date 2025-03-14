'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import throttle from 'lodash/throttle';

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  author: {
    name: string;
    username: string;
    profile_image_url: string;
  };
}

export default function TweetList() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [rateLimitReset, setRateLimitReset] = useState<number | null>(null);
  const [dailyLimitReset, setDailyLimitReset] = useState<number | null>(null);
  const [dailyRequestsUsed, setDailyRequestsUsed] = useState<number>(0);
  const [dailyRequestsLimit, setDailyRequestsLimit] = useState<number>(25);
  const [rateRequestsRemaining, setRateRequestsRemaining] = useState<number | null>(null);
  const [rateRequestsLimit, setRateRequestsLimit] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [countdownTime, setCountdownTime] = useState<number | null>(null);
  const REFRESH_COOLDOWN = 180 * 1000; // 3 minutes cooldown

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/profile', {
          credentials: 'include',
        });
        const data = await response.json();
        setIsAuthenticated(data.success);
        if (!data.success) {
          setError('Please log in to view your tweets');
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        setIsAuthenticated(false);
        setError('Please log in to view your tweets');
      }
    };

    checkAuth();
  }, []);

  const canRefresh = () => {
    const now = Date.now();
    // Check daily limit first
    if (dailyLimitReset) {
      return now >= dailyLimitReset;
    }
    // Then check rate limit
    if (rateLimitReset) {
      return now >= rateLimitReset;
    }
    const timeSinceLastRefresh = now - lastRefreshTime;
    return timeSinceLastRefresh >= REFRESH_COOLDOWN;
  };

  const formatTimeRemaining = (milliseconds: number) => {
    if (!milliseconds || milliseconds <= 0) return "0 seconds";
    
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
    
    return parts.join(' ');
  };

  const getTimeUntilNextRefresh = useCallback(() => {
    const now = Date.now();
    
    // If we have a daily limit reset time and it's in the future
    if (dailyLimitReset && dailyLimitReset > now) {
      return formatTimeRemaining(dailyLimitReset - now);
    }
    
    // If we have a rate limit reset time and it's in the future
    if (rateLimitReset && rateLimitReset > now) {
      return formatTimeRemaining(rateLimitReset - now);
    }
    
    // If neither limit is active, check the refresh cooldown
    const timeSinceLastRefresh = now - lastRefreshTime;
    if (timeSinceLastRefresh < REFRESH_COOLDOWN) {
      return formatTimeRemaining(REFRESH_COOLDOWN - timeSinceLastRefresh);
    }
    
    return "0 seconds";
  }, [dailyLimitReset, rateLimitReset, lastRefreshTime, REFRESH_COOLDOWN]);

  const fetchTweets = useCallback(
    throttle(async (isManualRefresh = false) => {
      if (!isAuthenticated) {
        setError('Please log in to view tweets');
        return;
      }

      // Don't fetch if we're rate limited
      if (rateLimitReset && rateLimitReset > Date.now()) {
        const timeRemaining = rateLimitReset - Date.now();
        setCountdownTime(timeRemaining);
        setNotice(`Rate limit reached - Please wait ${formatTimeRemaining(timeRemaining)} before refreshing.`);
        return;
      }

      // Don't fetch if we've fetched recently (unless it's a manual refresh)
      if (!isManualRefresh) {
        const now = Date.now();
        const timeSinceLastRefresh = now - lastRefreshTime;
        if (timeSinceLastRefresh < 30000) { // 30 seconds cooldown
          return;
        }
      }

      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch('http://localhost:3001/api/tweets', {
          credentials: 'include',
        });
        
        const data = await response.json();

        // Handle rate limit response
        if (response.status === 429) {
          const resetTime = data.resetTime;
          const remainingTime = data.remainingTime || (resetTime ? resetTime - Date.now() : 60000);
          if (resetTime) {
            setRateLimitReset(resetTime);
            setCountdownTime(remainingTime);
            setNotice(`Rate limit reached - Please wait ${formatTimeRemaining(remainingTime)} before refreshing.`);
          }
          setLoading(false);
          return;
        }

        // Handle authentication error
        if (response.status === 401) {
          setIsAuthenticated(false);
          setError('Please log in to view tweets');
          return;
        }

        // Update rate limit headers if they exist
        const rateLimitReset = response.headers.get('x-rate-limit-reset');
        const rateLimitRemaining = response.headers.get('x-rate-limit-remaining');
        const rateLimitLimit = response.headers.get('x-rate-limit-limit');
        const dailyLimitReset = response.headers.get('x-user-limit-24hour-reset');
        const dailyLimitRemaining = response.headers.get('x-user-limit-24hour-remaining');
        const dailyLimitLimit = response.headers.get('x-user-limit-24hour-limit');

        if (rateLimitReset) setRateLimitReset(parseInt(rateLimitReset) * 1000);
        if (rateLimitRemaining) setRateRequestsRemaining(parseInt(rateLimitRemaining));
        if (rateLimitLimit) setRateRequestsLimit(parseInt(rateLimitLimit));
        if (dailyLimitReset) setDailyLimitReset(parseInt(dailyLimitReset) * 1000);
        if (dailyLimitRemaining) setDailyRequestsUsed(parseInt(dailyLimitRemaining));
        if (dailyLimitLimit) setDailyRequestsLimit(parseInt(dailyLimitLimit));

        // Handle successful response
        if (data.success) {
          if (Array.isArray(data.tweets)) {
            setTweets(data.tweets);
            setLastRefreshTime(Date.now());
            if (data.notice) {
              setNotice(data.notice);
            }
          } else {
            setError('Invalid tweet data received');
          }
        } else {
          setError(data.error || 'Failed to fetch tweets');
        }
      } catch (err: any) {
        console.error('Fetch error:', err);
        if (err.message?.includes('401')) {
          setIsAuthenticated(false);
          setError('Please log in to view tweets');
        } else {
          setError('Failed to connect to the server');
        }
      } finally {
        setLoading(false);
      }
    }, 1000), // Reduced throttle time to 1 second for better responsiveness
    [isAuthenticated]
  );

  // Initial fetch and new tweet listener
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const handleNewTweet = () => {
      // Small delay to ensure the tweet is available on the server
      setTimeout(() => fetchTweets(true), 1000);
    };

    // Initial fetch with a delay to avoid rate limits
    setTimeout(() => {
      fetchTweets();
    }, 2000);
    
    window.addEventListener('newTweetPosted', handleNewTweet);
    return () => window.removeEventListener('newTweetPosted', handleNewTweet);
  }, [isAuthenticated, fetchTweets]);

  // Rate limit notice effect - with stable reference
  const stableNotice = useMemo(() => {
    if (!rateLimitReset || rateLimitReset <= Date.now()) {
      return null;
    }
    const timeRemaining = getTimeUntilNextRefresh();
    return `Rate limit reached - Please wait ${timeRemaining} before refreshing.`;
  }, [rateLimitReset, getTimeUntilNextRefresh]);

  // Update notice with stable value
  useEffect(() => {
    setNotice(stableNotice);
    if (rateLimitReset && rateLimitReset > Date.now()) {
      setCountdownTime(rateLimitReset - Date.now());
    } else {
      setCountdownTime(null);
    }
  }, [stableNotice, rateLimitReset]);

  // Countdown timer effect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdownTime && countdownTime > 0) {
      timer = setInterval(() => {
        setCountdownTime(prev => {
          if (prev && prev > 1000) {
            const newValue = prev - 1000;
            // Update the notice with the new countdown
            setNotice(`Rate limit reached - Please wait ${formatTimeRemaining(newValue)} before refreshing.`);
            return newValue;
          }
          // When countdown reaches zero
          setNotice('You can now refresh tweets');
          return null;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdownTime]);

  const handleManualRefresh = useCallback(() => {
    if (canRefresh()) {
      fetchTweets(true);
    }
  }, [canRefresh, fetchTweets]);

  // Memoize sorted tweets to prevent unnecessary re-renders
  const sortedTweets = useMemo(() => 
    [...tweets].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    [tweets]
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const RateLimitStatus = () => {
    const now = Date.now();
    const timeUntilReset = dailyLimitReset && dailyLimitReset > now ? dailyLimitReset - now : null;
    
    return (
      <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
        <h3 className="font-semibold text-gray-700">API Limits Status</h3>
        
        {/* Daily Limit */}
        <div>
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Daily Requests Used: {dailyRequestsUsed}/{dailyRequestsLimit}</span>
            {timeUntilReset && (
              <span>Resets in: {formatTimeRemaining(timeUntilReset)}</span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                dailyRequestsUsed >= dailyRequestsLimit ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${(dailyRequestsUsed / dailyRequestsLimit) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {dailyRequestsLimit - dailyRequestsUsed} requests remaining today
          </p>
        </div>

        {/* Rate Limit */}
        {rateRequestsLimit && (
          <div>
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Rate Limit: {rateRequestsRemaining}/{rateRequestsLimit} remaining</span>
              {rateLimitReset && rateLimitReset > now && (
                <span>Resets in: {formatTimeRemaining(rateLimitReset - now)}</span>
              )}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  (rateRequestsRemaining ?? 0) === 0 ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ 
                  width: `${((rateRequestsRemaining ?? 0) / (rateRequestsLimit ?? 1)) * 100}%` 
                }}
              />
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500">
          <div>Last updated: {new Date(lastRefreshTime).toLocaleTimeString()}</div>
          {dailyLimitReset && (
            <div>Daily limit resets at: {new Date(dailyLimitReset).toLocaleTimeString()}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Recent Tweets</h2>
          {notice && (
            <p className="text-sm text-blue-600 mt-1">
              {notice}
              {countdownTime && countdownTime > 0 && !notice.includes(formatTimeRemaining(countdownTime)) && (
                <span className="ml-1 font-medium">
                  ({formatTimeRemaining(countdownTime)})
                </span>
              )}
            </p>
          )}
        </div>
        {isAuthenticated && (
          <button
            onClick={handleManualRefresh}
            disabled={loading || !canRefresh()}
            className={`px-4 py-2 bg-blue-500 text-white rounded-lg transition-colors ${
              loading || !canRefresh()
                ? 'opacity-50 cursor-not-allowed' 
                : 'hover:bg-blue-600'
            }`}
          >
            {loading ? 'Refreshing...' : 'Refresh Tweets'}
          </button>
        )}
      </div>

      {isAuthenticated && <RateLimitStatus />}

      {error ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-gray-600 mb-4">{error}</p>
          <a 
            href="http://localhost:3001/auth/twitter" 
            className="inline-block px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Login with Twitter
          </a>
        </div>
      ) : loading && tweets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <p className="text-gray-500">Loading tweets...</p>
        </div>
      ) : tweets.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-gray-600">No tweets found. Start by posting your first tweet!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedTweets.map((tweet) => (
            <div
              key={tweet.id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center mb-4">
                <img
                  src={tweet.author.profile_image_url}
                  alt={tweet.author.name}
                  className="w-12 h-12 rounded-full mr-4"
                />
                <div>
                  <h3 className="font-semibold text-gray-800">{tweet.author.name}</h3>
                  <p className="text-gray-500">@{tweet.author.username}</p>
                </div>
              </div>
              <p className="text-gray-800 mb-4">{tweet.text}</p>
              <div className="flex justify-between text-sm text-gray-500">
                <time>{formatDate(tweet.created_at)}</time>
                <div className="flex space-x-4">
                  <span>🔁 {tweet.metrics.retweet_count}</span>
                  <span>💬 {tweet.metrics.reply_count}</span>
                  <span>❤️ {tweet.metrics.like_count}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 