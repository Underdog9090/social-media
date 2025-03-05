import request from 'supertest';
import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import User from '../models/User.js';
import ScheduledTweet from '../models/ScheduledTweet.js';

// Mock Twitter API
jest.mock('twitter-api-v2');

const app = express();
app.use(express.json());

// Mock user for testing
const mockUser = {
  userId: '123456789',
  username: 'testuser',
  displayName: 'Test User',
  accessToken: 'test_access_token',
  accessSecret: 'test_access_secret'
};

// Mock tweet response
const mockTweetResponse = {
  data: {
    id: '1234567890',
    text: 'Test tweet'
  }
};

describe('Tweet API', () => {
  beforeEach(async () => {
    // Clear mocks before each test
    jest.clearAllMocks();
    
    // Create test user
    await User.create(mockUser);
    
    // Mock Twitter API response
    TwitterApi.prototype.v2.tweet.mockResolvedValue(mockTweetResponse);
  });

  describe('POST /api/tweet', () => {
    it('should post a tweet successfully', async () => {
      const response = await request(app)
        .post('/api/tweet')
        .set('Content-Type', 'application/json')
        .send({
          message: 'Test tweet',
          userId: mockUser.userId
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tweetId).toBe(mockTweetResponse.data.id);
    });

    it('should schedule a tweet', async () => {
      const scheduleTime = new Date();
      scheduleTime.setHours(scheduleTime.getHours() + 1);

      const response = await request(app)
        .post('/api/tweet')
        .set('Content-Type', 'application/json')
        .send({
          message: 'Scheduled test tweet',
          scheduleTime: scheduleTime.toISOString(),
          userId: mockUser.userId
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.scheduled).toBe(true);

      // Verify tweet was saved to database
      const scheduledTweet = await ScheduledTweet.findOne({
        userId: mockUser.userId,
        message: 'Scheduled test tweet'
      });
      expect(scheduledTweet).toBeTruthy();
      expect(scheduledTweet.status).toBe('pending');
    });
  });

  describe('GET /api/scheduled-tweets', () => {
    it('should get scheduled tweets', async () => {
      // Create a scheduled tweet
      await ScheduledTweet.create({
        userId: mockUser.userId,
        message: 'Test scheduled tweet',
        scheduleTime: new Date(),
        status: 'pending'
      });

      const response = await request(app)
        .get('/api/scheduled-tweets')
        .query({ userId: mockUser.userId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tweets).toHaveLength(1);
      expect(response.body.tweets[0].message).toBe('Test scheduled tweet');
    });
  });
}); 