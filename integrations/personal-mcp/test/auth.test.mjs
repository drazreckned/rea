import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createAuth, protectedResource } from "../src/auth.mjs";

test("OAuth verifies signature, issuer, audience, expiry, subject and scope", async (t) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = {
    publicUrl: "https://rea.example.invalid/mcp",
    auth: {
      mode: "oauth",
      issuer: "https://issuer.example.invalid/",
      jwksUrl: `http://127.0.0.1:${server.address().port}/jwks`,
      audience: "rea-test",
      requiredScope: "rea:use",
      allowedSubjects: ["owner"],
    },
  };
  const auth = createAuth(config);
  const sign = (claims = {}) =>
    new SignJWT({
      scope: "rea:use",
      iss: config.auth.issuer,
      aud: "rea-test",
      sub: "owner",
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
  const request = (token) =>
    new Request("https://rea.example.invalid/mcp", {
      headers: { Authorization: `Bearer ${token}` },
    });
  const owner = await auth(request(await sign()));
  assert.equal(owner.length, 64);
  for (const claims of [
    { iss: "https://other.invalid/" },
    { aud: "other" },
    { sub: "other" },
    { scope: "different" },
    { exp: 1 },
  ]) {
    await assert.rejects(auth(request(await sign(claims))));
  }
  await assert.rejects(auth(request("invalid")));
  assert.equal(protectedResource(config).resource, config.publicUrl);
});

test("bearer mode refuses missing or weak configured credentials", () => {
  assert.throws(() =>
    createAuth({ auth: { mode: "bearer", tokenEnv: "TEST_KEY" } }, {}),
  );
  assert.throws(() =>
    createAuth(
      { auth: { mode: "bearer", tokenEnv: "TEST_KEY" } },
      { TEST_KEY: "short" },
    ),
  );
});
