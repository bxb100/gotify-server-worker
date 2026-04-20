## 2024-05-15 - Missing Authorization on Plugin Routes & Information Disclosure in Error Handling

**Vulnerability:**

1. Missing Authorization: Global plugin administration endpoints (`/plugin` and
   `/plugin/*`) were accessible to any authenticated client (`requireClient`),
   allowing non-admins or applications to read/modify plugin state.
2. Information Disclosure: The unhandled error handler (`app.onError`) exposed
   internal `Error` messages to API consumers for 500-level errors.
   **Learning:**
3. When migrating or reimplementing administrative functionality, it's easy to
   default to the standard authentication middleware (`requireClient`) rather
   than the more restrictive one (`requireAdmin`). Global state shouldn't be
   mutable by standard clients.
4. Hono's default error handling or simple custom implementations might pass
   `error.message` through to the client. This is dangerous because runtime
   errors can contain database schema details, stack traces, or other internal
   implementation details. **Prevention:**
5. Always map out the required privilege level for each new group of routes and
   ensure the correct middleware is applied. Administrative actions MUST use
   `requireAdmin`.
6. Fail securely. Unhandled exceptions should log the detailed error internally
   but only return a generic, static message like "internal server error" to the
   client.
