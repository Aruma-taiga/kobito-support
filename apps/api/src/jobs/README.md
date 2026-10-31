# Jobs

# Jobs

`pnpm --filter @kobito/api job:daily` runs daily billing and lifecycle processing for the
current Tokyo calendar date, in that order. Billing creates due periods and monthly
invoices and expires positive period balances. Lifecycle processing lapses unpaid initial
invoices after their due date and unapproved custom plan quotes after their expiry date.
Each contract is rechecked under a row lock and processed in its own transaction; failures
are isolated by contract. The output contains separate `billing` and `lifecycle` results.
This job does not call payment providers. Cancellation completion remains part of daily
billing and does not create a period or invoice after the scheduled end date.
