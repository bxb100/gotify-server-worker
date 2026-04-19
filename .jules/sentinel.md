## 2024-04-19 - [Stored XSS via MIME-Type Spoofing]

**Vulnerability:** The application used the client-provided `File.type` property
when uploading application images to R2 storage, which could be spoofed by
attackers (e.g., uploading an image with a `.jpg` extension but setting the
content-type to `text/html`). When served back, the image could execute Stored
XSS. **Learning:** Never trust client-provided file types or headers for
`Content-Type` metadata in file storage. Cloud storage uses this metadata to
tell the browser how to render the file, leading directly to Stored XSS if
spoofed. **Prevention:** Strictly determine the `Content-Type` on the
server-side based on a validated file extension list (e.g., `.jpg` ->
`image/jpeg`) and disregard any client-provided types.
