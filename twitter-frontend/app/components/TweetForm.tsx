'use client';

import { useState, useEffect } from 'react';

interface ScheduledTweet {
  id: string;
  message: string;
  scheduleTime: string;
  status: 'pending' | 'posted' | 'failed';
  error?: string;
}

export default function TweetForm() {
  const [message, setMessage] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [result, setResult] = useState<{ 
    success?: boolean; 
    tweetId?: string; 
    scheduled?: boolean;
    scheduleId?: string;
    scheduledFor?: string;
    error?: string;
    resetTime?: number;
    remainingTime?: number;
    remainingCount?: number;
    totalLimit?: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scheduledTweets, setScheduledTweets] = useState<ScheduledTweet[]>([]);
  const [showCancelConfirm, setShowCancelConfirm] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    remainingTweets?: number;
    totalLimit?: number;
    usedCount?: number;
    windowReset?: number;
    cooldownTime?: number;
  } | null>(null);
  const [recentTweets, setRecentTweets] = useState<any[]>([]);
  const [tweetsLoading, setTweetsLoading] = useState(false);
  const [tweetsError, setTweetsError] = useState<string | null>(null);
  const [tweetRateLimit, setTweetRateLimit] = useState<{
    remainingRequests?: number;
    totalLimit?: number;
    usedCount?: number;
    windowReset?: number;
  } | null>(null);

  // Add function to fetch recent tweets
  const fetchRecentTweets = async () => {
    try {
      setTweetsLoading(true);
      setTweetsError(null);
      
      const response = await fetch('http://localhost:3001/api/tweets', {
        credentials: 'include',
      });
      
      if (response.status === 429) {
        const data = await response.json();
        const resetTime = data.resetTime;
        const waitTime = resetTime ? resetTime - Date.now() : 60000; // Default to 1 minute
        setTweetsError(`Rate limit reached. Please wait ${formatTimeRemaining(waitTime)} before refreshing.`);
        setTweetsLoading(false);
        return;
      }
      
      const data = await response.json();
      
      if (data.success) {
        setRecentTweets(data.tweets || []);
        
        // Handle rate limit info if available
        if (data.remainingRequests !== undefined || data.rateLimit) {
          const rateLimit = data.rateLimit || {};
          setTweetRateLimit({
            remainingRequests: data.remainingRequests || rateLimit.remaining,
            totalLimit: data.totalLimit || rateLimit.limit,
            usedCount: data.usedCount,
            windowReset: data.windowReset || (rateLimit.reset ? rateLimit.reset * 1000 : null)
          });
        }
        
        // Handle notices
        if (data.notice) {
          setTweetsError(data.notice);
        } else {
          setTweetsError(null);
        }
      } else {
        setTweetsError(data.error || 'Failed to fetch tweets');
      }
    } catch (err) {
      console.error('Failed to fetch recent tweets:', err);
      setTweetsError('Failed to fetch tweets');
    } finally {
      setTweetsLoading(false);
    }
  };

  // Update useEffect to fetch recent tweets on mount and authentication
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/profile', {
          credentials: 'include',
        });
        const data = await response.json();
        setIsAuthenticated(data.success);
        if (data.success) {
          fetchScheduledTweets();
          fetchRecentTweets();
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        setIsAuthenticated(false);
      }
    };

    checkAuth();
  }, []);

  // Add auto-refresh for recent tweets
  useEffect(() => {
    let refreshTimer: NodeJS.Timeout;
    if (isAuthenticated) {
      // Initial fetch
      fetchRecentTweets();
      // Set up periodic refresh with a longer interval to avoid rate limits
      refreshTimer = setInterval(() => {
        // Only refresh if not currently loading and no rate limit error
        if (!tweetsLoading && !tweetsError?.includes('Rate limit')) {
          fetchRecentTweets();
        }
      }, 30000); // Increase to 30 seconds to avoid hitting rate limits
    }
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [isAuthenticated, tweetsLoading, tweetsError]);

  // Add countdown timer effect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (rateLimitCountdown && rateLimitCountdown > 0) {
      timer = setInterval(() => {
        setRateLimitCountdown(prev => {
          if (prev && prev > 0) {
            return prev - 1000; // Decrease by 1 second (1000ms)
          }
          setRateLimitInfo(null); // Clear rate limit info when countdown ends
          return null;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [rateLimitCountdown]);

  const fetchScheduledTweets = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/scheduled-tweets', {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (data.success) {
        setScheduledTweets(data.tweets);
      } else {
        setValidationError(data.error || 'Failed to fetch scheduled tweets');
      }
    } catch (err) {
      console.error('Failed to fetch scheduled tweets:', err);
      setValidationError('Failed to fetch scheduled tweets');
    }
  };

  // Validate schedule time
  const validateScheduleTime = (time: string) => {
    if (!time) return null;
    const selectedTime = new Date(time);
    const now = new Date();
    
    if (selectedTime <= now) {
      return 'Schedule time must be in the future';
    }
    
    // Limit scheduling to 30 days in the future
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    if (selectedTime > thirtyDaysFromNow) {
      return 'Cannot schedule tweets more than 30 days in advance';
    }
    
    return null;
  };

  // Cancel a scheduled tweet
  const cancelScheduledTweet = async (id: string) => {
    try {
      await fetch(`http://localhost:3001/api/scheduled-tweets/${id}`, {
        method: 'DELETE',
      });
      setScheduledTweets(tweets => tweets.filter(tweet => tweet.id !== id));
      setShowCancelConfirm(null);
    } catch (error) {
      console.error('Failed to cancel tweet:', error);
      setResult({ 
        success: false, 
        error: 'Failed to cancel scheduled tweet. Please try again.' 
      });
    }
  };

  // Update handleSubmit to handle recent tweets
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);
    setValidationError(null);
    setError(null);

    // Validate message
    if (!message.trim()) {
      setValidationError('Please enter a message');
      setIsSubmitting(false);
      return;
    }

    // Validate schedule time if provided
    if (scheduleTime) {
      const timeError = validateScheduleTime(scheduleTime);
      if (timeError) {
        setValidationError(timeError);
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const endpoint = 'http://localhost:3001/api/tweet';
      const payload = {
        message: message.trim(),
        ...(scheduleTime && { scheduleTime: new Date(scheduleTime).toISOString() })
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      
      if (response.status === 429) {
        const resetTime = data.resetTime;
        const remainingTime = data.remainingTime || (resetTime - Date.now());
        setRateLimitCountdown(remainingTime);
        setResult({
          success: false,
          error: data.error || 'Rate limit exceeded',
          resetTime: data.resetTime,
          remainingTime: remainingTime,
          remainingCount: data.remainingCount,
          totalLimit: data.totalLimit
        });
        setError(`Rate limit reached. Please wait ${formatTimeRemaining(remainingTime)} before trying again.`);
        fetchRecentTweets(); // Add this line to refresh tweets even during rate limit
        setIsSubmitting(false);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to post tweet');
      }

      setResult(data);
      
      if (data.success) {
        setMessage('');
        setScheduleTime('');
        setSuccess('Tweet posted successfully!');
        if (data.scheduled) {
          fetchScheduledTweets();
        } else {
          fetchRecentTweets(); // Replace window.dispatchEvent with direct fetch
        }
      }
    } catch (error: any) {
      console.error('Tweet posting error:', error);
      setError(error.message || 'Failed to post tweet');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format tweet preview with basic Twitter-style formatting
  const formatPreview = (text: string) => {
    return text
      .replace(/(https?:\/\/[^\s]+)/g, '<span class="text-blue-500">$1</span>')
      .replace(/@(\w+)/g, '<span class="text-blue-500">@$1</span>')
      .replace(/#(\w+)/g, '<span class="text-blue-500">#$1</span>');
  };

  // Helper function to format time remaining
  const formatTimeRemaining = (milliseconds: number): string => {
    if (milliseconds <= 0) return "0 seconds";
    
    const seconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6 border border-gray-100">
        <h2 className="text-2xl font-semibold text-gray-800 mb-6">Post a Tweet</h2>
        
        {!isAuthenticated ? (
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4 text-lg">Please log in to post tweets</p>
            <a 
              href="http://localhost:3001/auth/twitter" 
              className="inline-flex items-center px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-lg hover:shadow-xl"
            >
              <svg className="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
              </svg>
              <span className="font-medium">Login with Twitter</span>
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-6">
              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  Tweet Message
                </label>
                <textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  rows={4}
                  maxLength={280}
                  placeholder="What's happening?"
                />
                <div className="flex justify-between items-center mt-2">
                  <p className="text-sm text-gray-500">
                    {message.length}/280 characters
                  </p>
                  {message.length > 0 && (
                    <button
                      onClick={() => setMessage('')}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {message && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Tweet Preview:</h3>
                  <div 
                    className="text-gray-800 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: formatPreview(message) }}
                  />
                </div>
              )}
              
              <div>
                <label htmlFor="schedule" className="block text-sm font-medium text-gray-700 mb-2">
                  Schedule Tweet (Optional)
                </label>
                <input
                  type="datetime-local"
                  id="schedule"
                  value={scheduleTime}
                  onChange={(e) => {
                    setScheduleTime(e.target.value);
                    setValidationError(null);
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
                {validationError && (
                  <p className="mt-2 text-sm text-red-600">{validationError}</p>
                )}
              </div>

              {(error || rateLimitCountdown) && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-yellow-800">
                    {error}
                    {rateLimitCountdown && rateLimitCountdown > 0 && (
                      <span className="block mt-2 font-medium">
                        Time remaining: {formatTimeRemaining(rateLimitCountdown)}
                      </span>
                    )}
                    {result?.remainingCount !== undefined && result?.totalLimit !== undefined && (
                      <span className="block mt-2">
                        Tweets remaining: {result.remainingCount} of {result.totalLimit} in the current 15-minute window
                      </span>
                    )}
                  </p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={!message.trim() || isSubmitting}
                className={`w-full px-6 py-3 bg-blue-500 text-white rounded-lg transition-all ${
                  !message.trim() || isSubmitting
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-blue-600 hover:shadow-lg'
                } flex items-center justify-center space-x-2`}
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Posting...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                    </svg>
                    <span>{scheduleTime ? 'Schedule Tweet' : 'Post Tweet'}</span>
                  </>
                )}
              </button>
            </div>

            {result && (
              <div className={`mt-6 p-4 rounded-lg ${
                result.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {result.success
                  ? result.scheduled
                    ? `Tweet scheduled for ${new Date(result.scheduledFor!).toLocaleString()}`
                    : `Tweet posted successfully! ID: ${result.tweetId}`
                  : `Error: ${result.error}`
                }
              </div>
            )}
          </>
        )}
      </div>

      {isAuthenticated && (
        <>
          {/* Recent Tweets Section */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-800">Recent Tweets</h2>
              {tweetRateLimit && (
                <div className="text-sm text-gray-600">
                  {tweetRateLimit.remainingRequests !== undefined && (
                    <span className="mr-4">
                      Remaining refreshes: {tweetRateLimit.remainingRequests} of {tweetRateLimit.totalLimit}
                    </span>
                  )}
                  {tweetRateLimit.windowReset && (
                    <span>
                      Resets in: {formatTimeRemaining(tweetRateLimit.windowReset - Date.now())}
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {tweetsError && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-800">{tweetsError}</p>
              </div>
            )}

            {tweetsLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            ) : (
              <div className="space-y-4">
                {recentTweets.map((tweet) => (
                  <div
                    key={tweet.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                  >
                    <p className="text-gray-800">{tweet.text}</p>
                    <div className="mt-3 flex justify-between items-center text-sm">
                      <span className="text-gray-500">
                        Posted: {new Date(tweet.created_at).toLocaleString()}
                      </span>
                      <div className="flex space-x-4">
                        <span className="text-gray-600">
                          ♥ {tweet.metrics?.like_count || 0}
                        </span>
                        <span className="text-gray-600">
                          ↺ {tweet.metrics?.retweet_count || 0}
                        </span>
                        <span className="text-gray-600">
                          💬 {tweet.metrics?.reply_count || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                {recentTweets.length === 0 && !tweetsError && (
                  <p className="text-gray-500 text-center py-4">No recent tweets to display</p>
                )}
              </div>
            )}
          </div>

          {/* Scheduled Tweets Section */}
          <div className="bg-white rounded-lg shadow-lg p-6 border border-gray-100">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">Scheduled Tweets</h2>
            <div className="space-y-4">
              {scheduledTweets.map((tweet) => (
                <div
                  key={tweet.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                >
                  <p className="text-gray-800">{tweet.message}</p>
                  <div className="mt-3 flex justify-between items-center text-sm">
                    <span className="text-gray-500">
                      Scheduled for: {new Date(tweet.scheduleTime).toLocaleString()}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      tweet.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      tweet.status === 'posted' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {tweet.status.charAt(0).toUpperCase() + tweet.status.slice(1)}
                    </span>
                  </div>
                  {tweet.error && (
                    <p className="mt-2 text-sm text-red-600">{tweet.error}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
} 