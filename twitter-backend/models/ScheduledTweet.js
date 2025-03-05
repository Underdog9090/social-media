import mongoose from 'mongoose';

const scheduledTweetSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
    maxlength: 280,
  },
  scheduleTime: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'posted', 'failed'],
    default: 'pending',
  },
  postedAt: {
    type: Date,
  },
  error: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient querying
scheduledTweetSchema.index({ userId: 1, scheduleTime: 1 });
scheduledTweetSchema.index({ status: 1 });

const ScheduledTweet = mongoose.model('ScheduledTweet', scheduledTweetSchema);

export default ScheduledTweet; 