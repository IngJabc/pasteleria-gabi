-- 013_quote_guard_helpers_grants.sql
-- Forward fix: 011 revoked helper EXECUTE from PUBLIC/anon/authenticated but
-- did not grant to service_role. register_payment/submit_payment_evidence run as
-- service_role (SECURITY INVOKER) and call these helpers, causing permission
-- denied during checkout payment registration. Additive, safe to apply after 011.

grant execute on function private.order_requires_quote_pending(public.orders) to service_role;
grant execute on function private.order_requires_quote_acceptance(public.orders) to service_role;
