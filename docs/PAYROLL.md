# Payroll and labour economics

## First principles

A service business does not earn money when a booking is created. It earns money when the service is delivered. The cost of delivery is labour. If booking, delivery, completion and pay live in separate tools, the owner never sees the true margin of a service.

Ojaly closes that loop:

```text
booking → assignment → service completed → labour cost → approved pay → true service margin
```

That is different from generic payroll software. Generic payroll knows an employee and a salary. Ojaly knows the actual service, the customer, the team member who delivered it, whether it was completed, the payment collected and the platform fees. Payroll can therefore be calculated from delivered work rather than from a spreadsheet estimate.

## Supported pay models

- Daily rate
- Weekly rate
- Monthly salary
- Per completed service

The first three are time-based. The fourth pays for actual completed outcomes.

## Automation

Drafts are generated automatically at the relevant boundary:

- daily: previous day
- weekly: previous week, Monday
- monthly: previous month, first day
- per-service: previous month, first day, plus on-demand runs

Automation only creates a draft. The owner reviews and approves it. Money is released only when the owner explicitly triggers Paystack transfer.

## Why approval is required

Automatic salary transfers without review are dangerous: a wrong bank account, a disputed completion or a salary change could move real money. The approval gate keeps the owner in control while removing the calculation and reconciliation work.

## Metrics created

- labour cost per completed service
- completion rate per team member
- assigned vs completed jobs
- gross pay, deductions, net pay
- payout status and references

These turn payroll from an administrative cost into a pricing and margin tool.
