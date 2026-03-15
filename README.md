<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set your API keys in `.env.local` (used by serverless API)
3. Run locally with Vercel (recommended so serverless functions see env vars):
   `npx vercel dev`

Note: `npm run dev` only loads Vite env vars (prefixed with `VITE_`) for the browser.
Serverless API routes read from process env when running via Vercel.
