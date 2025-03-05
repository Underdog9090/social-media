import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    required: true,
  },
  displayName: String,
  photos: {
    type: [String],
    default: [],
    transform: function(v) {
      // If v is already an array, return it
      if (Array.isArray(v)) return v;
      // If v is a single string, wrap it in an array
      if (typeof v === 'string') return [v];
      // If v is an array of objects with value property, extract the values
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && 'value' in v[0]) {
        return v.map(photo => photo.value);
      }
      return [];
    }
  },
  accessToken: {
    type: String,
    required: true,
  },
  accessSecret: {
    type: String,
    required: true,
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
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const User = mongoose.model('User', userSchema);

export default User; 