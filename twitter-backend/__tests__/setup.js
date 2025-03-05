import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Connect to test database
beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/social-media-test');
});

// Clear database after each test
afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  for (let collection of collections) {
    await collection.deleteMany({});
  }
});

// Close database connection after all tests
afterAll(async () => {
  await mongoose.connection.close();
}); 