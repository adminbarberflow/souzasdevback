export function cleanupExpiredRateLimitEntries(
  rateLimitBuckets,
  loginAttempts,
  now = Date.now()
) {
  let removedBuckets = 0;
  let removedEntries = 0;
  let removedLoginAttempts = 0;

  for (
    const [clientId, bucket]
    of rateLimitBuckets
  ) {
    for (const [key, state] of bucket) {
      if (!state || state.resetAt <= now) {
        bucket.delete(key);
        removedEntries += 1;
      }
    }

    if (bucket.size === 0) {
      rateLimitBuckets.delete(clientId);
      removedBuckets += 1;
    }
  }

  for (
    const [clientId, state]
    of loginAttempts
  ) {
    if (!state || state.resetAt <= now) {
      loginAttempts.delete(clientId);
      removedLoginAttempts += 1;
    }
  }

  return {
    removedBuckets,
    removedEntries,
    removedLoginAttempts
  };
}