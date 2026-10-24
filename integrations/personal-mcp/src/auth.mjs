import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const hash = (value) => createHash("sha256").update(value).digest();
export function createAuth(config, environment = process.env) {
  const auth = config.auth;
  if (auth.mode === "private") return async () => "private-local";
  if (auth.mode === "bearer") {
    const expected = environment[auth.tokenEnv];
    if (!expected || expected.length < 32)
      throw new Error(
        "Bearer token environment variable must contain at least 32 characters.",
      );
    const expectedHash = hash(expected);
    return async (request) => {
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer (.+)$/u)?.[1];
      if (!token || !timingSafeEqual(hash(token), expectedHash))
        throw new Error("Unauthorized");
      return "bearer-owner";
    };
  }
  const keys = createRemoteJWKSet(new URL(auth.jwksUrl));
  return async (request) => {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/u)?.[1];
    if (!token) throw new Error("Unauthorized");
    const { payload } = await jwtVerify(token, keys, {
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["exp", "sub"],
    });
    if (!auth.allowedSubjects.includes(payload.sub))
      throw new Error("Unauthorized");
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!scopes.includes(auth.requiredScope)) throw new Error("Unauthorized");
    return hash(`${auth.issuer}\n${payload.sub}`).toString("hex");
  };
}

export function protectedResource(config) {
  return {
    resource: config.publicUrl,
    authorization_servers: [config.auth.issuer],
    scopes_supported: [config.auth.requiredScope],
    bearer_methods_supported: ["header"],
  };
}
