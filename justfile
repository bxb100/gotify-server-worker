default:
    @just --list

[group('dev')]
migrate *remote:
    #!/usr/bin/env bash
    flags={{ if remote != '' { '--remote' } else { '' } }}
    npx wrangler d1 migrations apply gotify $flags

[group('dev')]
fmt:
    @pnpm run format
