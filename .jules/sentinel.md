## 2026-04-15 - [MEDIUM] Error Message Leakage Prevention

**Vulnerability:** The global error handler (`app.onError`) was returning the
raw `error.message` for all unhandled `Error` exceptions. **Learning:** This
could leak internal stack trace, file path, database query details or other
sensitive information directly to a potential attacker. **Prevention:** Catch
all non-API errors and always return a generic `'internal server error'` while
only logging the actual error details to standard error. Always fail securely.
