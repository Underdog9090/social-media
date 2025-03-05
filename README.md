# Social Media Application with Twitter Integration

A full-stack social media application that allows users to post tweets, schedule tweets, and view their Twitter analytics.

## Features

- Twitter OAuth Authentication
- Post tweets directly
- Schedule tweets for future posting
- View tweet analytics
- Modern, responsive UI
- Real-time updates

## Tech Stack

### Backend
- Node.js
- Express.js
- MongoDB
- Twitter API v2
- Passport.js for authentication

### Frontend
- Next.js 14
- TypeScript
- Tailwind CSS
- React Query for data fetching

## Prerequisites

- Node.js (v18 or higher)
- MongoDB
- Twitter Developer Account with API access
- npm or yarn

## Environment Variables

### Backend (.env)
```env
MONGODB_URI=your_mongodb_uri
TWITTER_API_KEY=your_twitter_api_key
TWITTER_API_SECRET=your_twitter_api_secret
TWITTER_CALLBACK_URL=http://localhost:3001/api/twitter/callback
SESSION_SECRET=your_session_secret
PORT=3001
```

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/Underdog9090/social-media.git
cd social-media
```

2. Install backend dependencies:
```bash
cd twitter-backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../twitter-frontend
npm install
```

## Running the Application

1. Start the backend server:
```bash
cd twitter-backend
npm run dev
```

2. Start the frontend development server:
```bash
cd twitter-frontend
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## API Endpoints

### Authentication
- `GET /auth/twitter` - Initiate Twitter OAuth
- `GET /api/twitter/callback` - Twitter OAuth callback
- `GET /auth/logout` - Logout user

### Tweets
- `POST /api/tweet` - Post a new tweet
- `GET /api/tweets` - Get user's timeline
- `GET /api/scheduled-tweets` - Get scheduled tweets
- `DELETE /api/scheduled-tweets/:id` - Cancel a scheduled tweet

### Analytics
- `GET /api/analytics` - Get tweet analytics

## Project Structure

```
social-media/
├── twitter-backend/
│   ├── models/         # MongoDB models
│   ├── server.js       # Express server
│   └── package.json
└── twitter-frontend/
    ├── app/           # Next.js app directory
    ├── components/    # React components
    ├── public/        # Static files
    └── package.json
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Twitter API Documentation
- Next.js Documentation
- MongoDB Documentation 