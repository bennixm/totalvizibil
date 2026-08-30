-- WebsiteDraft carries the chosen exact-niche category slug, copied onto the
-- Company at claim time so every business has a category for the feed.
ALTER TABLE "website_drafts" ADD COLUMN "category_slug" TEXT;
