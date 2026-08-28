# System Architecture

## High-Level Architecture

Customer
↓
Frontend
↓
API
↓
Search / Business / Campaign / Billing Services
↓
Database

AI operates as an intelligent layer over the platform.

## Main Systems

- Frontend
- Backend API
- Database
- Authentication
- Search Engine
- Ranking Engine
- AI Services
- Billing
- Campaign Management
- Analytics
- Admin

## External Integrations

- Stripe
- Google Ads
- AI provider
- Voice provider
- Avatar provider
- Email/SMS provider

## Core Principle

External providers should be isolated behind internal service interfaces.

This makes providers replaceable later.
