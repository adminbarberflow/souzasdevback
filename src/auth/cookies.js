export const AUTH_COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME?.trim() ||
  "portfolio_session";

const COOKIE_MAX_AGE = Number(
  process.env.AUTH_COOKIE_MAX_AGE
) || 7200;

const IS_PRODUCTION =
  process.env.NODE_ENV === "production";

export function parseCookies(cookieHeader = "") {
  const cookies = {};

  cookieHeader.split(";").forEach((item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const name = item
      .slice(0, separatorIndex)
      .trim();

    const rawValue = item
      .slice(separatorIndex + 1)
      .trim();

    if (!name) {
      return;
    }

    try {
      cookies[name] =
        decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  });

  return cookies;
}

export function getAuthToken(request) {
  const cookies = parseCookies(
    request.headers.cookie || ""
  );

  return cookies[AUTH_COOKIE_NAME] || "";
}

export function createAuthCookie(token) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${COOKIE_MAX_AGE}`
  ];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearAuthCookie() {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
