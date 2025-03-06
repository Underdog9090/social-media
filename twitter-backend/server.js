import express from 'express';
import dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import session from 'express-session';
import passport from 'passport';
import { Strategy as TwitterStrategy } from 'passport-twitter';
import cron from 'node-cron';
import connectDB from './models/db.js';
import ScheduledTweet from './models/ScheduledTweet.js';
import UserSettings from './models/UserSettings.js';
import User from './models/User.js';

// Load environment variables
dotenv.config();

// Constants for URLs
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Connect to MongoDB
connectDB();

// Initialize Twitter client
let twitterClient = null;

// Helper function to initialize Twitter client with user tokens
const initializeTwitterClient = (user) => {
  if (!user?.accessToken || !user?.accessSecret) {
    throw new Error('User tokens not available');
  }
  
  twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: user.accessToken,
    accessSecret: user.accessSecret,
  });
};

const app = express();
const port = process.env.PORT || 3001;

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport and restore authentication state from session
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Configure Twitter Strategy
passport.use(new TwitterStrategy({
    consumerKey: process.env.TWITTER_API_KEY,
    consumerSecret: process.env.TWITTER_API_SECRET,
    callbackURL: process.env.TWITTER_CALLBACK_URL
  },
  async (token, tokenSecret, profile, done) => {
    try {
      // Create or update user settings
      await UserSettings.findOneAndUpdate(
        { userId: profile.id },
        {
          userId: profile.id,
          defaultScheduleTime: "09:00",
          timezone: "UTC",
          analyticsPreferences: {
            showRetweets: true,
            showReplies: true,
            showQuotes: true
          }
        },
        { upsert: true, new: true }
      );

      // Create or update user with tokens
      await User.findOneAndUpdate(
        { userId: profile.id },
        {
          userId: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          photos: profile.photos ? profile.photos.map(photo => photo.value) : [],
          accessToken: token,
          accessSecret: tokenSecret
        },
        { upsert: true, new: true }
      );

      // Store the user's access tokens
      return done(null, {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        photos: profile.photos,
        accessToken: token,
        accessSecret: tokenSecret
      });
    } catch (error) {
      return done(error, null);
    }
  }
));

// Store scheduled tweets in memory (in a real app, you'd use a database)
const scheduledTweets = new Map();

// Function to check and post scheduled tweets
const checkScheduledTweets = async () => {
  const now = new Date();
  
  try {
    // Find all pending tweets that are due
    const pendingTweets = await ScheduledTweet.find({
      status: 'pending',
      scheduleTime: { $lte: now }
    });

    for (const tweet of pendingTweets) {
      try {
        // Get user from database
        const user = await User.findOne({ userId: tweet.userId });
        if (!user) {
          throw new Error('User not found');
        }

        // Initialize Twitter client with user tokens
        initializeTwitterClient(user);
        
        // Post the tweet
        await twitterClient.v2.tweet(tweet.message);
        
        // Update tweet status
        tweet.status = 'posted';
        tweet.postedAt = new Date();
        await tweet.save();
        
        console.log(`Successfully posted scheduled tweet ${tweet._id}`);
      } catch (error) {
        console.error(`Failed to post scheduled tweet ${tweet._id}:`, error);
        tweet.status = 'failed';
        tweet.error = error.message;
        await tweet.save();
      }
    }
  } catch (error) {
    console.error('Error checking scheduled tweets:', error);
  }
};

// Function to retry failed tweets
const retryFailedTweets = async () => {
  try {
    const failedTweets = await ScheduledTweet.find({
      status: 'failed',
      scheduleTime: { $lte: new Date() }
    });

    for (const tweet of failedTweets) {
      try {
        // Get user from database
        const user = await User.findOne({ userId: tweet.userId });
        if (!user) {
          console.error(`User not found for tweet ${tweet._id}`);
          continue;
        }

        // Initialize Twitter client with user tokens
        initializeTwitterClient(user);
        
        // Post the tweet
        await twitterClient.v2.tweet(tweet.message);
        
        // Update tweet status
        tweet.status = 'posted';
        tweet.postedAt = new Date();
        tweet.error = null;
        await tweet.save();
        
        console.log(`Successfully posted failed tweet ${tweet._id}`);
      } catch (error) {
        console.error(`Failed to retry tweet ${tweet._id}:`, error);
        tweet.error = error.message;
        await tweet.save();
      }
    }
  } catch (error) {
    console.error('Error retrying failed tweets:', error);
  }
};

// Schedule cron jobs
cron.schedule('* * * * *', checkScheduledTweets);
cron.schedule('*/5 * * * *', retryFailedTweets); // Retry failed tweets every 5 minutes

// Cache for tweets and user ID
let tweetsCache = {
  data: null,
  lastFetched: null,
  rateLimit: null
};
let cachedUserId = null;

// Add analytics cache
let analyticsCache = {
  data: null,
  lastFetched: null,
  rateLimit: null
};

// Add rate limit tracking
const rateLimitTracker = {
  tweets: new Map(),
  analytics: new Map(),
  
  check(userId, type) {
    if (!userId || !this[type]) {
      return { allowed: false, reset: Date.now() + 2000, remaining: 0 };
    }

    const now = Date.now();
    const tracker = this[type];
    const userLimits = tracker.get(userId) || {
      count: 0,
      reset: now + (15 * 60 * 1000), // 15 minutes from first request
      lastRequest: 0
    };

    // Reset if the reset time has passed
    if (now >= userLimits.reset) {
      userLimits.count = 0;
      userLimits.reset = now + (15 * 60 * 1000); // 15 minutes
      userLimits.lastRequest = 0;
      tracker.set(userId, userLimits); // Save the reset state
    }

    // Different cooldowns for tweets and analytics
    const cooldown = type === 'tweets' ? 60000 : 120000; // 60 seconds for tweets, 2 minutes for analytics
    const timeSinceLastRequest = now - userLimits.lastRequest;
    
    if (timeSinceLastRequest < cooldown) {
      return {
        allowed: false,
        reset: userLimits.lastRequest + cooldown,
        remaining: type === 'tweets' ? 15 - userLimits.count : 10 - userLimits.count,
        nextAllowedTime: userLimits.lastRequest + cooldown,
        remainingTime: cooldown - timeSinceLastRequest
      };
    }

    // Different limits for tweets and analytics
    const limit = type === 'tweets' ? 15 : 10; // 15 tweets/15min, 10 analytics/15min
    const withinLimits = userLimits.count < limit;
    
    // Update tracking if within limits
    if (withinLimits) {
      userLimits.count++;
      userLimits.lastRequest = now;
      tracker.set(userId, userLimits);
    }

    return {
      allowed: withinLimits,
      reset: userLimits.reset,
      remaining: limit - userLimits.count,
      nextAllowedTime: withinLimits ? now : userLimits.lastRequest + cooldown,
      remainingTime: withinLimits ? 0 : cooldown
    };
  },

  // Add method to get next allowed time
  getNextAllowedTime(userId, type) {
    const tracker = this[type];
    const userLimits = tracker.get(userId);
    if (!userLimits) return Date.now();

    const now = Date.now();
    if (now >= userLimits.reset) return now;

    const cooldown = type === 'tweets' ? 60000 : 120000;
    return Math.max(userLimits.lastRequest + cooldown, now);
  },
  
  // Add method to get remaining count
  getRemainingCount(userId, type) {
    const tracker = this[type];
    const userLimits = tracker.get(userId);
    if (!userLimits) return type === 'tweets' ? 15 : 10;
    
    const limit = type === 'tweets' ? 15 : 10;
    return Math.max(0, limit - userLimits.count);
  }
};

// Helper function to format time remaining
const formatTimeRemaining = (milliseconds) => {
  if (milliseconds <= 0) return "0 seconds";
  
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
};

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running' });
});

// Constants
const TWEET_CACHE_DURATION = 30 * 1000;  // Increase to 30 seconds for tweets
const ANALYTICS_CACHE_DURATION = 120 * 1000;  // 2 minutes for analytics
const EXTENDED_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes for extended caching during rate limits

// Tweet endpoint
app.post('/api/tweet', async (req, res) => {
  try {
    const { message, scheduleTime } = req.body;
    const userId = req.user?.id;

    console.log('Tweet request received:', {
      userId,
      messageLength: message?.length,
      scheduleTime,
      isAuthenticated: req.isAuthenticated(),
      user: req.user ? {
        id: req.user.id,
        hasTokens: !!(req.user.accessToken && req.user.accessSecret)
      } : null
    });

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Please log in to post tweets'
      });
    }

    // Check rate limits for tweets
    const rateLimit = rateLimitTracker.check(userId, 'tweets');
    if (!rateLimit.allowed) {
      const waitTime = rateLimit.remainingTime || (rateLimit.nextAllowedTime - Date.now());
      const remaining = rateLimitTracker.getRemainingCount(userId, 'tweets');
      return res.status(429).json({
        success: false,
        error: `Please wait ${formatTimeRemaining(waitTime)} before posting another tweet`,
        resetTime: rateLimit.nextAllowedTime,
        remainingTime: waitTime,
        remainingCount: remaining,
        totalLimit: 15
      });
    }

    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    if (message.length > 280) {
      return res.status(400).json({
        success: false,
        error: 'Tweet exceeds 280 characters'
      });
    }

    // Handle scheduled tweets
    if (scheduleTime) {
      const scheduledTime = new Date(scheduleTime);
      
      if (isNaN(scheduledTime.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid schedule time'
        });
      }

      if (scheduledTime <= new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Schedule time must be in the future'
        });
      }

      // Create new scheduled tweet in database
      const scheduledTweet = await ScheduledTweet.create({
        userId,
        message: message.trim(),
        scheduleTime: scheduledTime,
        status: 'pending'
      });

      return res.json({
        success: true,
        scheduled: true,
        scheduleId: scheduledTweet._id,
        scheduledFor: scheduledTime
      });
    }

    // Post immediate tweet
    try {
      initializeTwitterClient(req.user);
      const tweet = await twitterClient.v2.tweet(message.trim());
      
      return res.json({
        success: true,
        scheduled: false,
        tweetId: tweet.data.id
      });
    } catch (twitterError) {
      console.error('Twitter API error:', twitterError);
      
      // Handle specific Twitter API errors
      if (twitterError.code === 429) {
        const now = Date.now();
        const resetTime = twitterError._headers?.get('x-rate-limit-reset');
        const defaultResetTime = Math.floor((now + 15 * 60 * 1000) / 1000); // 15 minutes from now
        
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          resetTime: resetTime ? parseInt(resetTime) * 1000 : defaultResetTime * 1000
        });
      }

      throw twitterError;
    }
  } catch (error) {
    console.error('Tweet error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to post tweet'
    });
  }
});

// Get scheduled tweets
app.get('/api/scheduled-tweets', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Please log in to view scheduled tweets'
      });
    }

    const tweets = await ScheduledTweet.find({ userId })
      .sort({ scheduleTime: 1 });
    
    res.json({
      success: true,
      tweets: tweets.map(tweet => ({
        id: tweet._id,
        message: tweet.message,
        scheduleTime: tweet.scheduleTime,
        status: tweet.status,
        postedAt: tweet.postedAt,
        error: tweet.error
      }))
    });
  } catch (error) {
    console.error('Error fetching scheduled tweets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch scheduled tweets'
    });
  }
});

// Cancel scheduled tweet
app.delete('/api/scheduled-tweets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Please log in to cancel scheduled tweets'
      });
    }

    const tweet = await ScheduledTweet.findOneAndDelete({
      _id: id,
      userId,
      status: 'pending'
    });
    
    if (!tweet) {
      return res.status(404).json({
        success: false,
        error: 'Scheduled tweet not found or already posted'
      });
    }

    res.json({
      success: true,
      message: 'Scheduled tweet cancelled'
    });
  } catch (error) {
    console.error('Error cancelling scheduled tweet:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel scheduled tweet'
    });
  }
});

// Helper function to set rate limit headers
const setRateLimitHeaders = (res, rateLimit, now) => {
  // More generous rate limits
  const defaultRateLimit = {
    limit: 100,              // Increased limit
    remaining: 95,          // More available requests
    reset: Math.floor((now + 60 * 60 * 1000) / 1000) // 1 hour from now
  };

  const finalRateLimit = {
    ...defaultRateLimit,
    ...rateLimit
  };
  
  res.set({
    'x-rate-limit-limit': finalRateLimit.limit.toString(),
    'x-rate-limit-remaining': finalRateLimit.remaining.toString(),
    'x-rate-limit-reset': finalRateLimit.reset.toString(),
    'x-user-limit-24hour-limit': '1000',           // Increased significantly
    'x-user-limit-24hour-remaining': '950',       // More available requests
    'x-user-limit-24hour-reset': Math.floor((now + 24 * 60 * 60 * 1000) / 1000).toString()
  });
};

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Get user timeline tweets
app.get('/api/tweets', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  const now = Date.now();
  const hasCachedData = tweetsCache.data && Array.isArray(tweetsCache.data);
  const cacheAge = now - (tweetsCache.lastFetched || 0);
  const userId = req.user?.id;

  // Check if we're hitting our internal rate limit
  const rateLimit = rateLimitTracker.check(userId, 'tweets');
  if (!rateLimit.allowed) {
    const waitTime = rateLimit.remainingTime || (rateLimit.nextAllowedTime - now);
    const remaining = rateLimitTracker.getRemainingCount(userId, 'tweets');
    
    // Return cached data if available
    if (hasCachedData) {
      return res.json({
        success: true,
        tweets: tweetsCache.data,
        cached: true,
        notice: `Rate limit reached - Please wait ${formatTimeRemaining(waitTime)} before refreshing`,
        resetTime: rateLimit.nextAllowedTime,
        remainingTime: waitTime,
        remainingRequests: remaining,
        totalLimit: 15
      });
    }
    
    return res.status(429).json({
      success: false,
      error: `Please wait ${formatTimeRemaining(waitTime)} before refreshing tweets`,
      resetTime: rateLimit.nextAllowedTime,
      remainingTime: waitTime,
      remainingRequests: remaining,
      totalLimit: 15
    });
  }

  // Return cached data if it's fresh enough
  if (hasCachedData && cacheAge < TWEET_CACHE_DURATION) {
    return res.json({
      success: true,
      tweets: tweetsCache.data,
      cached: true,
      remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
      totalLimit: 15
    });
  }

  // Set default rate limit headers
  const defaultRateLimit = {
    limit: 900,
    remaining: 850,
    reset: Math.floor((now + 15 * 60 * 1000) / 1000)
  };
  setRateLimitHeaders(res, defaultRateLimit, now);

  try {
    // Initialize Twitter client with user tokens
    try {
      initializeTwitterClient(req.user);
    } catch (error) {
      console.error('Failed to initialize Twitter client:', error);
      if (hasCachedData) {
        return res.json({
          success: true,
          tweets: tweetsCache.data,
          cached: true,
          notice: 'Authentication error - showing cached tweets',
          remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
          totalLimit: 15
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Twitter authentication failed'
      });
    }

    // Try to fetch fresh data
    const tweets = await twitterClient.v2.userTimeline(req.user.id, {
      max_results: 10,
      exclude: ['retweets', 'replies'],
      expansions: ['author_id'],
      'tweet.fields': ['created_at', 'public_metrics', 'text'],
      'user.fields': ['name', 'username', 'profile_image_url']
    });

    // Update rate limit info from timeline response
    if (tweets._headers) {
      const timelineRateLimit = {
        limit: parseInt(tweets._headers['x-rate-limit-limit']) || 900,
        remaining: parseInt(tweets._headers['x-rate-limit-remaining']) || 850,
        reset: parseInt(tweets._headers['x-rate-limit-reset']) || Math.floor((now + 15 * 60 * 1000) / 1000)
      };
      setRateLimitHeaders(res, timelineRateLimit, now);
      tweetsCache.rateLimit = timelineRateLimit;
    }

    // Check if we have valid tweet data
    if (!tweets.data?.data || !Array.isArray(tweets.data.data) || tweets.data.data.length === 0) {
      // If we have cached data, return it
      if (hasCachedData) {
        return res.json({
          success: true,
          tweets: tweetsCache.data,
          cached: true,
          notice: 'No recent tweets found - showing cached tweets',
          remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
          totalLimit: 15
        });
      }
      
      return res.json({
        success: true,
        tweets: [],
        cached: false,
        notice: 'No recent tweets found',
        remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
        totalLimit: 15
      });
    }

    // Get user data from the includes
    const users = tweets.includes?.users || [];
    const userMap = new Map(users.map(user => [user.id, user]));

    // Process tweets with user data
    const processedTweets = tweets.data.data.map(tweet => {
      const user = userMap.get(tweet.author_id) || {
        name: req.user.displayName,
        username: req.user.username,
        profile_image_url: req.user.photos?.[0]?.value
      };

      return {
        id: tweet.id,
        text: tweet.text,
        created_at: tweet.created_at,
        metrics: tweet.public_metrics,
        author: {
          name: user.name,
          username: user.username,
          profile_image_url: user.profile_image_url
        }
      };
    });

    // Update cache
    tweetsCache.data = processedTweets;
    tweetsCache.lastFetched = now;

    return res.json({
      success: true,
      tweets: processedTweets,
      cached: false,
      remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
      totalLimit: 15
    });
  } catch (error) {
    console.error('Error in /api/tweets:', error);
    
    // Handle rate limit error
    if (error.code === 429) {
      const resetTime = error._headers?.get('x-rate-limit-reset');
      const defaultResetTime = Math.floor((now + 15 * 60 * 1000) / 1000);
      const actualResetTime = resetTime ? parseInt(resetTime) * 1000 : defaultResetTime * 1000;
      
      // Update our internal rate limit tracker to respect Twitter's rate limit
      if (userId) {
        const tracker = rateLimitTracker.tweets;
        const userLimits = tracker.get(userId) || {
          count: 15, // Set to max to prevent further requests
          reset: actualResetTime,
          lastRequest: now
        };
        userLimits.count = 15; // Max out the count
        userLimits.reset = actualResetTime;
        tracker.set(userId, userLimits);
      }
      
      // If we have cached data, return it
      if (hasCachedData) {
        return res.json({
          success: true,
          tweets: tweetsCache.data,
          cached: true,
          notice: 'Twitter API rate limit reached - showing cached tweets',
          resetTime: actualResetTime,
          remainingTime: actualResetTime - now,
          remainingRequests: 0,
          totalLimit: 15
        });
      }
      
      return res.status(429).json({
        success: false,
        error: 'Twitter API rate limit exceeded',
        resetTime: actualResetTime,
        remainingTime: actualResetTime - now,
        remainingRequests: 0,
        totalLimit: 15
      });
    }

    // For other errors, return cached data if available
    if (hasCachedData) {
      return res.json({
        success: true,
        tweets: tweetsCache.data,
        cached: true,
        notice: 'Error fetching new tweets - showing cached tweets',
        remainingRequests: rateLimitTracker.getRemainingCount(userId, 'tweets'),
        totalLimit: 15
      });
    }

    return res.status(500).json({
      success: false,
      error: `Error: ${error.message || 'Unknown error'}`
    });
  }
});

// Add rate limits debug endpoint
app.get('/api/rate-limits', async (req, res) => {
  try {
    const me = await twitterClient.v2.me();
    const rateLimit = {
      limit: parseInt(me._headers['x-rate-limit-limit']) || 900,
      remaining: parseInt(me._headers['x-rate-limit-remaining']) || 0,
      reset: parseInt(me._headers['x-rate-limit-reset']) || 0
    };
    res.json({ success: true, rateLimit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Twitter Authentication Routes
app.get('/auth/twitter', passport.authenticate('twitter'));

app.get('/api/twitter/callback', 
  passport.authenticate('twitter', { 
    failureRedirect: `${FRONTEND_URL}/login`,
    session: true 
  }),
  (req, res) => {
    res.redirect(FRONTEND_URL);
  }
);

// Logout route
app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Error logging out' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Protected route example
app.get('/api/profile', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ 
      success: false, 
      error: 'Not authenticated' 
    });
  }
  res.json({ 
    success: true, 
    user: req.user 
  });
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Please log in to view analytics'
      });
    }

    const now = Date.now();
    const hasCachedData = analyticsCache.data && analyticsCache.data.length > 0;
    const cacheAge = now - (analyticsCache.lastFetched || 0);

    // Check rate limits
    const rateLimit = rateLimitTracker.check(req.user.id, 'analytics');
    if (!rateLimit.allowed) {
      const waitTime = rateLimit.remainingTime || (rateLimit.nextAllowedTime - now);
      const remaining = rateLimitTracker.getRemainingCount(req.user.id, 'analytics');
      
      // Return cached data if available and not too old
      if (hasCachedData && cacheAge < ANALYTICS_CACHE_DURATION * 3) { // Allow slightly older cache during rate limit
        return res.json({
          success: true,
          analytics: analyticsCache.data,
          cached: true,
          notice: `Rate limited - Please wait ${formatTimeRemaining(waitTime)} before refreshing`,
          resetTime: rateLimit.nextAllowedTime,
          remainingTime: waitTime,
          remainingCount: remaining,
          totalLimit: 10
        });
      }

      return res.status(429).json({
        success: false,
        error: `Please wait ${formatTimeRemaining(waitTime)} before refreshing analytics`,
        resetTime: rateLimit.nextAllowedTime,
        remainingTime: waitTime,
        remainingCount: remaining,
        totalLimit: 10
      });
    }

    // Initialize Twitter client with user tokens
    try {
      initializeTwitterClient(req.user);
    } catch (error) {
      console.error('Failed to initialize Twitter client:', error);
      if (hasCachedData) {
        return res.json({
          success: true,
          analytics: analyticsCache.data,
          cached: true,
          notice: 'Authentication error - showing cached analytics'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Twitter authentication failed'
      });
    }

    // Get user's tweets with engagement metrics
    const tweets = await twitterClient.v2.userTimeline(req.user.id, {
      max_results: 5,
      exclude: ['replies', 'retweets'],
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
    });

    // Update rate limit info from response
    if (tweets._headers) {
      const rateLimit = {
        limit: parseInt(tweets._headers['x-rate-limit-limit']) || 900,
        remaining: parseInt(tweets._headers['x-rate-limit-remaining']) || 850,
        reset: parseInt(tweets._headers['x-rate-limit-reset']) || Math.floor((now + 15 * 60 * 1000) / 1000)
      };
      setRateLimitHeaders(res, rateLimit, now);
      analyticsCache.rateLimit = rateLimit;
    }

    // Check if we have valid tweet data
    if (!tweets.data?.data || !Array.isArray(tweets.data.data) || tweets.data.data.length === 0) {
      // Return cached data if available
      if (hasCachedData) {
        return res.json({
          success: true,
          analytics: analyticsCache.data,
          cached: true,
          notice: 'No recent tweets found - showing cached analytics'
        });
      }
      
      return res.json({
        success: true,
        analytics: [],
        cached: false,
        notice: 'No recent tweets found for analytics'
      });
    }

    const analytics = tweets.data.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      created_at: tweet.created_at,
      metrics: {
        retweet_count: tweet.public_metrics.retweet_count,
        reply_count: tweet.public_metrics.reply_count,
        like_count: tweet.public_metrics.like_count,
        quote_count: tweet.public_metrics.quote_count
      }
    }));

    // Update analytics cache
    analyticsCache.data = analytics;
    analyticsCache.lastFetched = now;

    return res.json({
      success: true,
      analytics,
      cached: false
    });
  } catch (error) {
    console.error('Analytics error:', error);
    
    // Return cached data if available during error
    if (analyticsCache.data && analyticsCache.data.length > 0) {
      return res.json({
        success: true,
        analytics: analyticsCache.data,
        cached: true,
        notice: 'Error fetching analytics - showing cached data'
      });
    }
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch analytics'
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 