# ApplyStronger

ApplyStronger is an AI-powered job search, resume matching, and application assistance platform.

## Cloudflare Workers Static Assets

The browser application is deployed as the existing `applystronger` assets-only Cloudflare Worker. Supabase remains the database, authentication, storage, and Edge Functions backend. The isolated `applystronger-preview` environment is used for validation before production deployment.

Install dependencies:

```bash
npm install
```

Run a local preview:

```bash
npm run dev
```

Validate the preview deployment without publishing:

```bash
npm run check
```

Deploy the isolated preview Worker:

```bash
npm run deploy:preview
```

The production deployment command is intentionally separate:

```bash
npm run deploy
```

The production custom domain is declared only on the default `applystronger` Worker. The preview environment overrides `routes` with an empty list, so deploying `applystronger-preview` cannot take over `applystronger.com`.
