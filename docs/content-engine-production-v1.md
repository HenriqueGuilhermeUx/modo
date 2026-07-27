# MODO Content Engine v1

## Customer journey

1. The customer chooses a brand, objective, channel and format.
2. MODO combines the briefing with the brand profile, current priorities, available proof, recurring objections, restrictions and performance learning.
3. The content provider produces structured copy and a visual prompt.
4. When `OPENAI_API_KEY` is configured, MODO generates a contextual campaign image and stores it as a durable content asset.
5. The Studio displays the image with the message overlay and exports the final PNG.
6. The customer reviews, edits and approves before publication.

## Reliability

- The legacy n8n content workflow is not used by the production path.
- A provider failure never returns a raw transport error to the customer.
- Text generation remains usable even when image generation is temporarily unavailable.
- Without an OpenAI key, the native provider still produces a contextual draft for review.

## Required production environment

- `OPENAI_API_KEY`: secret configured only in Render.
- `OPENAI_TEXT_MODEL=gpt-5-mini`
- `OPENAI_IMAGE_MODEL=gpt-image-1`
- `PUBLIC_API_URL=https://modo-api-3m10.onrender.com`

## Deployment verification

Open `/health` and confirm:

- `version` is `0.13.0`;
- `buildCommit` matches the deployed Git commit;
- `contentProvider` is `openai` when the API key is configured;
- `imageGeneration` is `generated`;
- `assetStorage` is `postgres` in production.
