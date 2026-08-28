# Database

## Core Entities

User
Company
BusinessProfile
BusinessService
BusinessLocation

Website
WebsiteTemplate
WebsiteVersion

Campaign
CampaignBudget
CampaignEvent

ClientCredit
CreditTransaction

StripeTransaction
Refund

TrafficEvent
Click
Lead
Call

GoogleCampaign
GoogleSpend

Search
SearchQuery

AIConversation
AIMessage
AIUsage

RankingScore
BusinessPerformance

Notification
AuditLog

## Important Separation

Financial entities must remain separate.

Do not combine:
- client credit
- revenue
- cash
- Google cost
- profit

into a single balance field.
