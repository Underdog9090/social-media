import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import xss from 'xss-clean';
import mongoSanitize from 'express-mongo-sanitize';

// Rate limiting
export const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// API specific rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs
  message: 'Too many API requests from this IP, please try again later.'
});

// Security middleware setup
export const setupSecurityMiddleware = (app) => {
  // Set security headers
  app.use(helmet());

  // Prevent XSS attacks
  app.use(xss());

  // Prevent NoSQL injection
  app.use(mongoSanitize());

  // Apply rate limiting
  app.use('/api/', apiLimiter);
  app.use(limiter);
}; 