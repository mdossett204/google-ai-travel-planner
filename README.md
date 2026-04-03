<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`
3. Set the server-side API keys in `.env.local`
   `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, and `TOMTOM_SEARCH_API_KEY`
4. Run locally with Vercel (recommended so serverless functions see env vars):
   `npx vercel dev`

## Notes

- API keys are used only by the backend serverless routes in `api/`. They are not injected into the browser bundle.
- `npm run dev` starts only the Vite frontend. It does not provide the serverless API routes.
- `npx vercel dev` is the recommended local workflow because it serves both the frontend and the backend routes together.
- `OPENAI_API_KEY` is optional and only needed if you switch routing to OpenAI in the backend.
- `DEBUG_LLM_ROUTER=true` enables extra backend logging for LLM and place-search debugging.
