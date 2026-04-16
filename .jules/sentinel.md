## 2024-05-28 - Authorization Bypass on Plugin Endpoints
**Vulnerability:** The 6 API endpoints related to plugin management (`/plugin`, `/plugin/:id/config`, `/plugin/:id/display`, `/plugin/:id/enable`, `/plugin/:id/disable`) used the `requireClient` middleware instead of `requireAdmin`, allowing normal users/clients to list, configure, enable, or disable plugins.
**Learning:** Middleware handling permissions can easily be set too loosely if copied from other standard user routes. Since plugins alter system behavior, only administrators should have access to these endpoints.
**Prevention:** Always verify the authorization middleware on administrative endpoints and use `requireAdmin` for operations that affect application-wide configuration or plugin state.
