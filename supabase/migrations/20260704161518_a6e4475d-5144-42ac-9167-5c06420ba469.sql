ALTER TABLE public.artist_public_pages
  ADD COLUMN footer_badge_text TEXT NOT NULL DEFAULT 'Verified info',
  ADD COLUMN footer_caption TEXT NOT NULL DEFAULT 'ChatGPT, Claude, Perplexity and Gemini pull answers from this page.';