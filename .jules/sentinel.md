## 2024-05-24 - Global Plugin Authorization Bypass

**Vulnerability:** The `/plugin` endpoints (listing, configuring, enabling,
disabling plugins) were accessible to any authenticated user (`requireClient`)
rather than being restricted to administrators (`requireAdmin`). **Learning:**
In a multi-tenant or multi-user environment, any configuration that affects the
global state of the application (like plugins) MUST be restricted to admin
roles. Allowing standard users to manage plugins can lead to privilege
escalation or denial of service for the entire instance. **Prevention:** Always
verify the scope of an endpoint. If an endpoint modifies global application
state rather than user-specific state, ensure the authorization middleware
checks for administrative privileges (e.g., `requireAdmin`), not just basic
authentication (`requireClient`).
