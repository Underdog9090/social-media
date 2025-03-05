'use client';

import { useState } from 'react';

interface TweetAnalytics {
  id: string;
  text: string;
  created_at: string;
  metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

export default function Analytics() {
  const [analytics, setAnalytics] = useState<TweetAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [rateLimitReset, setRateLimitReset] = useState<number | null>(null);
  const REFRESH_COOLDOWN = 60 * 1000; // 1 minute cooldown

  // Calculate total engagement metrics
  const totalEngagement = analytics.reduce((acc, tweet) => ({
    retweets: acc.retweets + tweet.metrics.retweet_count,
    replies: acc.replies + tweet.metrics.reply_count,
    likes: acc.likes + tweet.metrics.like_count,
    quotes: acc.quotes + tweet.metrics.quote_count
  }), { retweets: 0, replies: 0, likes: 0, quotes: 0 });

  // Calculate average engagement per tweet
  const avgEngagement = analytics.length > 0 ? {
    retweets: (totalEngagement.retweets / analytics.length).toFixed(1),
    replies: (totalEngagement.replies / analytics.length).toFixed(1),
    likes: (totalEngagement.likes / analytics.length).toFixed(1),
    quotes: (totalEngagement.quotes / analytics.length).toFixed(1)
  } : null;

  // Find most engaged tweet
  const mostEngagedTweet = analytics.length > 0 
    ? analytics.reduce((max, tweet) => {
        const currentEngagement = tweet.metrics.retweet_count + 
                                tweet.metrics.reply_count + 
                                tweet.metrics.like_count + 
                                tweet.metrics.quote_count;
        const maxEngagement = max.metrics.retweet_count + 
                            max.metrics.reply_count + 
                            max.metrics.like_count + 
                            max.metrics.quote_count;
        return currentEngagement > maxEngagement ? tweet : max;
      }, analytics[0])
    : null;

  const canRefresh = () => {
    const now = Date.now();
    if (rateLimitReset && rateLimitReset > now) {
      return false;
    }
    const timeSinceLastRefresh = now - lastRefreshTime;
    return timeSinceLastRefresh >= REFRESH_COOLDOWN;
  };

  const formatTimeRemaining = (milliseconds: number) => {
    if (!milliseconds || milliseconds <= 0) return "0 seconds";
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    const parts = [];
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
    
    return parts.join(' ');
  };

  const fetchAnalytics = async () => {
    if (!canRefresh()) {
      const timeRemaining = rateLimitReset 
        ? formatTimeRemaining(rateLimitReset - Date.now())
        : formatTimeRemaining(REFRESH_COOLDOWN - (Date.now() - lastRefreshTime));
      setError(`Please wait ${timeRemaining} before refreshing analytics`);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetch('http://localhost:3001/api/analytics', {
        credentials: 'include',
      });

      // Handle rate limiting
      if (response.status === 429) {
        const data = await response.json();
        const resetTime = data.resetTime || (Date.now() + REFRESH_COOLDOWN);
        setRateLimitReset(resetTime);
        const timeRemaining = formatTimeRemaining(resetTime - Date.now());
        setError(`Rate limit reached. Please wait ${timeRemaining} before refreshing.`);
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch analytics');
      }

      setAnalytics(data.analytics);
      setShowAnalytics(true);
      setLastRefreshTime(Date.now());
      setRateLimitReset(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-gray-800">Tweet Analytics</h2>
        <button
          onClick={fetchAnalytics}
          disabled={loading || !canRefresh()}
          className={`px-4 py-2 bg-blue-500 text-white rounded-lg transition-colors ${
            loading || !canRefresh() ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
          }`}
        >
          {loading ? 'Loading...' : 'Refresh Analytics'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {showAnalytics && analytics.length > 0 ? (
        <div className="space-y-6">
          {/* Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-blue-800">Total Tweets</h3>
              <p className="text-2xl font-bold text-blue-600">{analytics.length}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-green-800">Total Likes</h3>
              <p className="text-2xl font-bold text-green-600">{totalEngagement.likes}</p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-yellow-800">Total Retweets</h3>
              <p className="text-2xl font-bold text-yellow-600">{totalEngagement.retweets}</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-purple-800">Total Replies</h3>
              <p className="text-2xl font-bold text-purple-600">{totalEngagement.replies}</p>
            </div>
          </div>

          {/* Average Engagement */}
          {avgEngagement && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Average Engagement per Tweet</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-sm text-gray-600">Likes</p>
                  <p className="text-xl font-bold text-gray-800">{avgEngagement.likes}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Retweets</p>
                  <p className="text-xl font-bold text-gray-800">{avgEngagement.retweets}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Replies</p>
                  <p className="text-xl font-bold text-gray-800">{avgEngagement.replies}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Quotes</p>
                  <p className="text-xl font-bold text-gray-800">{avgEngagement.quotes}</p>
                </div>
              </div>
            </div>
          )}

          {/* Most Engaged Tweet */}
          {mostEngagedTweet && (
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Most Engaged Tweet</h3>
              <p className="text-gray-800 mb-2">{mostEngagedTweet.text}</p>
              <div className="flex justify-between items-center text-sm text-gray-600">
                <time>{formatDate(mostEngagedTweet.created_at)}</time>
                <div className="flex space-x-4">
                  <span>🔁 {mostEngagedTweet.metrics.retweet_count}</span>
                  <span>💬 {mostEngagedTweet.metrics.reply_count}</span>
                  <span>❤️ {mostEngagedTweet.metrics.like_count}</span>
                  <span>🔄 {mostEngagedTweet.metrics.quote_count}</span>
                </div>
              </div>
            </div>
          )}

          {/* Individual Tweet Analytics */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Tweet Performance</h3>
            {analytics.map((tweet) => (
              <div key={tweet.id} className="border border-gray-200 rounded-lg p-4">
                <p className="text-gray-800 mb-2">{tweet.text}</p>
                <div className="flex justify-between items-center text-sm text-gray-600">
                  <time>{formatDate(tweet.created_at)}</time>
                  <div className="flex space-x-4">
                    <span>🔁 {tweet.metrics.retweet_count}</span>
                    <span>💬 {tweet.metrics.reply_count}</span>
                    <span>❤️ {tweet.metrics.like_count}</span>
                    <span>🔄 {tweet.metrics.quote_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : showAnalytics ? (
        <div className="text-center py-8 text-gray-500">
          No analytics data available
        </div>
      ) : null}
    </div>
  );
} 