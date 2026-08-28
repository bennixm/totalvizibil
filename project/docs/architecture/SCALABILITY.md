# Scalability

## Main Scaling Risks

- AI usage
- Voice sessions
- Avatar sessions
- Google Ads volume
- Search traffic
- Database size
- Analytics events
- Financial transactions

## Principle

Expensive AI should not be placed in every request path.

## Search

Use traditional search infrastructure for the majority of queries.

Use AI only for natural-language interpretation when needed.

## AI

AI usage must have quotas and cost controls.

## Caching

Cache repeated:
- search interpretations
- templates
- generated content where appropriate
- common queries

## Goal

Maintain predictable cost per active business and per customer interaction.
