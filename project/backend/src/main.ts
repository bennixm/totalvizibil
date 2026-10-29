import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/env';

/**
 * `/api/v1/public/*` (lead submission, appointment slots/booking, the public
 * company lookup, the published-bundle HTML) is the one slice of the API
 * meant to be called from ANY origin, not just our own frontend: a company's
 * AI-built site can be exported as a zip and self-hosted on the owner's own
 * domain (see WebsiteSettingsView's file export), and its contact/booking
 * forms call these same endpoints by absolute URL from wherever they end up
 * running (see ProV2AgentService.buildSystemPrompt). None of them read the
 * session cookie or require auth — they're already fully public and
 * unauthenticated by design, callable from a plain `curl` with no CORS
 * involved at all — so reflecting any browser Origin back here (with
 * `credentials: false`, never sending/accepting the cookie) doesn't expose
 * anything a non-browser client couldn't already reach; it only lets a
 * browser call them cross-origin too. Every other route keeps the strict,
 * single-origin, credentialed policy below — that one guards real session
 * state and must never be opened up the same way.
 */
const PUBLIC_API_PREFIX = '/api/v1/public';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // We always run behind exactly one nginx reverse proxy, which sets
  // `X-Forwarded-For`. Without this, Express reports the proxy's own loopback
  // address as `req.ip` for EVERY request — and since `@nestjs/throttler`
  // keys its buckets by `req.ip`, every rate limit in the app (login,
  // password reset, lead submission, ad clicks…) silently collapsed into a
  // single global bucket shared by all visitors. Trusting exactly one hop
  // (not `true`) means only nginx's own appended entry is honoured, so a
  // client can't spoof its address by sending its own `X-Forwarded-For`.
  // Must come before anything that reads `req.ip` — i.e. before every
  // middleware and guard below.
  app.set('trust proxy', 1);

  const config = app.get(ConfigService<AppConfig, true>);

  app.setGlobalPrefix('api/v1');
  // Simple-site image uploads arrive as base64 data-URIs in the JSON body.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  app.use(cookieParser());
  app.use(
    helmet({
      // Only the published-bundle HTML (`/public/companies/:id/site/index.html`,
      // rendered inside an <iframe> on the public company page and the
      // dashboard preview) is actually an HTML document subject to this —
      // every other route is a JSON API response CSP doesn't apply to.
      // Helmet's own default `img-src 'self' data:` blocked the Pexels
      // photos the Website Builder (PRO V2) embeds via `search_images`,
      // even though the SAME image loaded fine in the builder's own preview
      // (a different, unrestricted origin) — extend it with Pexels' CDN
      // rather than dropping the directive entirely.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', 'https://images.pexels.com'],
        },
      },
    }),
  );
  const publicCors = cors({ origin: true, credentials: false });
  const strictCors = cors({
    origin: config.get('frontendOrigin', { infer: true }),
    credentials: true,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    (req.path.startsWith(PUBLIC_API_PREFIX) ? publicCors : strictCors)(req, res, next);
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`Totalvizibil API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
