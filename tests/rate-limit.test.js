import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanupExpiredRateLimitEntries
} from "../src/rate-limit.js";

test(
  "remove registros expirados e preserva os ativos",
  () => {
    const now = 1500;

    const rateLimitBuckets = new Map([
      [
        "expired-client",
        new Map([
          [
            "contact",
            {
              count: 2,
              resetAt: 1000
            }
          ]
        ])
      ],
      [
        "mixed-client",
        new Map([
          [
            "contact",
            {
              count: 3,
              resetAt: 1000
            }
          ],
          [
            "auth:login",
            {
              count: 1,
              resetAt: 2000
            }
          ]
        ])
      ]
    ]);

    const loginAttempts = new Map([
      [
        "expired-login",
        {
          count: 5,
          resetAt: 1000
        }
      ],
      [
        "active-login",
        {
          count: 2,
          resetAt: 2000
        }
      ]
    ]);

    const result =
      cleanupExpiredRateLimitEntries(
        rateLimitBuckets,
        loginAttempts,
        now
      );

    assert.equal(
      rateLimitBuckets.has("expired-client"),
      false
    );

    assert.equal(
      rateLimitBuckets.has("mixed-client"),
      true
    );

    assert.equal(
      rateLimitBuckets
        .get("mixed-client")
        .has("contact"),
      false
    );

    assert.equal(
      rateLimitBuckets
        .get("mixed-client")
        .has("auth:login"),
      true
    );

    assert.equal(
      loginAttempts.has("expired-login"),
      false
    );

    assert.equal(
      loginAttempts.has("active-login"),
      true
    );

    assert.deepEqual(result, {
      removedBuckets: 1,
      removedEntries: 2,
      removedLoginAttempts: 1
    });
  }
);