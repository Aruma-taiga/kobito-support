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

`pnpm --filter @kobito/api job:notifications` dispatches due email notifications in
scheduled order. Rows are locked with `skip locked`, and transient failures are retried
up to three times. Without `MAIL_PROVIDER`, the job leaves queued notices untouched. Set
`MAIL_PROVIDER=log` to use the development sink, which logs only the notification kind,
subject, and a masked recipient; it does not send email. A production mail provider has
not been selected. Implement its adapter under `integrations/mail/` after the provider is
decided. This job handles NT-01, S-03, NT-02, NT-02b, and NT-05 email notices only.

`pnpm --filter @kobito/api job:retention` anonymizes due customer personal data for
contracts whose Tokyo calendar retention date has arrived. Use `--dry-run` to inspect
counts without changes; pass `--contract-id=<uuid>` to scope a local run. The job keeps
contracts, invoices and their name snapshots, payments, credits, agreements, and rewards.
It removes pending notifications and unlinks local login mappings. It returns the Firebase
UIDs that would need external account deletion, but **does not delete Firebase accounts**;
that external operation remains unimplemented and requires separate authorization. A
customer with any non-terminal contract is skipped. There is no schema field for an admin
retention hold, so exclusions are not currently supported.
