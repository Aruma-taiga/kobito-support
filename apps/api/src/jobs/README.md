# Jobs

# Jobs

`pnpm --filter @kobito/api job:daily` runs daily billing for the current Tokyo calendar date.
It creates due billing periods and monthly invoices, expires positive period balances,
and isolates failures in a transaction per contract. It does not call payment providers.
