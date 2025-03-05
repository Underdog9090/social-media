import TweetForm from './components/TweetForm';
import TweetList from './components/TweetList';
import TwitterLogin from './components/TwitterLogin';
import Analytics from './components/Analytics';

export default function Home() {
  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <h1 className="text-4xl font-bold mb-8 text-center text-gray-800">
        Twitter Campaign App
      </h1>
      <div className="max-w-3xl mx-auto space-y-8">
        <TwitterLogin />
        <TweetForm />
        <TweetList />
        <Analytics />
      </div>
    </main>
  );
}
