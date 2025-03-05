import mongoose from 'mongoose';

const userSettingsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  defaultScheduleTime: {
    type: String, // Format: "HH:mm" (24-hour)
    default: "09:00",
  },
  timezone: {
    type: String,
    default: "UTC",
  },
  analyticsPreferences: {
    showRetweets: {
      type: Boolean,
      default: true,
    },
    showReplies: {
      type: Boolean,
      default: true,
    },
    showQuotes: {
      type: Boolean,
      default: true,
    },
  },
  lastAnalyticsFetch: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt timestamp before saving
userSettingsSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const UserSettings = mongoose.model('UserSettings', userSettingsSchema);

export default UserSettings; 