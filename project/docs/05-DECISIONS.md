# Architecture and Product Decisions

## DEC-001 — AI onboarding
Status: Accepted

Businesses are onboarded through a conversational AI experience.

Reason: Reduce complexity for businesses with limited technical knowledge.

## DEC-002 — Classic search
Status: Accepted

Classic search remains available and is the default customer search.

Reason: It is fast, predictable, cheap, and familiar.

## DEC-003 — AI search
Status: Accepted

AI search is optional.

Reason: AI should be used when natural-language understanding adds value.

## DEC-004 — AI cost control
Status: Accepted

AI usage must have explicit resource limits.

Reason: AI costs scale with usage and must not become uncontrolled.

## DEC-005 — Promotional credit
Status: Accepted

Client credit is separate from revenue.

Reason: Unconsumed client credit must not be treated as profit.

## DEC-006 — Production resources
Status: Accepted

Expensive production resources should primarily be activated after payment and activation.

Reason: Prevent unnecessary costs from abandoned prospects.

## DEC-007 — Ranking
Status: Accepted

Ranking must not simply reward the highest-paying business.

Ranking should consider:
- relevance
- quality
- performance
- economic value
- exploration

Reason: Maintain customer value and marketplace fairness.

## DEC-008 — AI vs deterministic systems
Status: Accepted

AI is used for interpretation, generation, recommendations, and natural language.

Traditional software is used for:
- billing
- credit calculations
- tracking
- permissions
- database operations
- deterministic validation
- core financial calculations

Reason: Reduce cost and increase reliability.
