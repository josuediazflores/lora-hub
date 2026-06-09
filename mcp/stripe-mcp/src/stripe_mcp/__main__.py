import os
import sys

import stripe

from .server import mcp


def main() -> None:
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        sys.stderr.write(
            "stripe-mcp: STRIPE_SECRET_KEY is not set. Export it in the shell "
            "that launches this server (use a sk_test_... key in dev — every "
            "tool here mutates real Stripe state).\n"
        )
        sys.exit(1)
    stripe.api_key = key
    mcp.run()


if __name__ == "__main__":
    main()
