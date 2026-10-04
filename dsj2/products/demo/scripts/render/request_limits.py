"""Request capacity shared by Python import, individual and group rendering.

Keep aligned with LIMITS.rows in packages/contracts/src/index.ts and the DEMO
request_rows database constraint. This is a resource guard, not a group size rule.
"""

MAX_REQUEST_ROWS = 10_000
