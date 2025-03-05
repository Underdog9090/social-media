import express from 'express';
import dotenv from 'dotenv';
import { TwitterApi } from 'twitter-api-v2';
import session from 'express-session';
import passport from 'passport';
import { Strategy as TwitterStrategy } from 'passport-twitter';
import connectDB from '../models/db.js';
import ScheduledTweet from '../models/ScheduledTweet.js';
import UserSettings from '../models/UserSettings.js';
import User from '../models/User.js';
import { setupSecurityMiddleware } from '../middleware/security.js';

// Load environment variables
dotenv.config();

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

// Setup security middleware
setupSecurityMiddleware(app);

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

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Backend is running' });
});

// Tweet endpoint
app.post('/api/tweet', async (req, res) => {
  try {
    const { message, scheduleTime } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Please log in to post tweets'
      });
    }

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
      
      if (twitterError.code === 429) {
        const resetTime = twitterError._headers?.get('x-rate-limit-reset');
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          resetTime: resetTime ? parseInt(resetTime) * 1000 : null
        });
      }

      throw twitterError;
    }
  } catch (error) {
    console.error('Tweet error:', error);
    return res.status(500).json({
      success: false,
      error: `Twitter API Error: ${error.message || 'Unknown error'}`
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

// Twitter Authentication Routes
app.get('/auth/twitter', passport.authenticate('twitter'));

app.get('/api/twitter/callback', 
  passport.authenticate('twitter', { 
    failureRedirect: process.env.FRONTEND_URL + '/login',
    session: true 
  }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
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

    initializeTwitterClient(req.user);

    const tweets = await twitterClient.v2.userTimeline(req.user.id, {
      max_results: 5,
      exclude: ['replies', 'retweets'],
      'tweet.fields': ['public_metrics', 'created_at', 'text'],
    });

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

    return res.json({
      success: true,
      analytics
    });

  } catch (error) {
    console.error('Analytics error:', error);
    
    if (error.code === 429) {
      const resetTime = error._headers?.get('x-rate-limit-reset');
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        resetTime: resetTime ? parseInt(resetTime) * 1000 : null
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

// Export the Express app for Vercel
export default app; 