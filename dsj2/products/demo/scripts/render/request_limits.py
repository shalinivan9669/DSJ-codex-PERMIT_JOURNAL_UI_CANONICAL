"""Request capacity shared by Python import, individual and group rendering.

Keep aligned with LIMITS.rows in packages/contracts/src/index.ts and the DEMO
request_rows database constraint. Boundary tests exercise actual 250/251 inputs.
"""

MAX_REQUEST_ROWS = 250
