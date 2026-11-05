import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { installationToken } from "../worker/src/github-app";

afterEach(() => vi.unstubAllGlobals());

it("GitHub 給的 PKCS#1 私鑰可以簽出有效的 App JWT（含被轉成 \\n 的寫法）", async () => {
  // GitHub App 下載的私鑰是 PKCS#1（BEGIN RSA PRIVATE KEY）
  const { privateKey: pem, publicKey: pub } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  expect(pem).toContain("BEGIN RSA PRIVATE KEY");

  let id = 1;
  for (const key of [pem, pem.replace(/\n/g, "\\n")]) {
    let jwt = "";
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      jwt = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
      return new Response(JSON.stringify({ token: "t", expires_at: new Date(Date.now() + 3600e3).toISOString() }));
    });
    await installationToken({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: key }, id++);
    const [h, b, s] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${b}`).verify(pub, Buffer.from(s, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(b, "base64url").toString()).iss).toBe("123");
  }
});
