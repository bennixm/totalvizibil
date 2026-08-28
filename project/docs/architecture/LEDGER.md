# Financial Ledger

## Purpose

Maintain an auditable financial record of money movement and service delivery.

## Transaction Types

Potential transaction types:
- CREDIT_PURCHASE
- CREDIT_CONSUMPTION
- REFUND
- GOOGLE_COST_ACCRUED
- GOOGLE_COST_PAID
- STRIPE_FEE
- ADJUSTMENT

## Example

Business purchases 250 RON:

CLIENT_CREDIT +250

Business receives 5 RON worth of billable service:

CLIENT_CREDIT -5
REVENUE +5

Google traffic costs 3 RON:

GOOGLE_COST_ACCRUED +3

Google invoice is paid:

GOOGLE_COST_PAID +3

## Rule

Every financial state change should be traceable to a ledger transaction.
