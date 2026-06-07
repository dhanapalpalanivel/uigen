// @vitest-environment node
import { vi, test, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockSet = vi.fn();
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mockSet, get: mockGet }),
}));

import { createSession, getSession } from "@/lib/auth";
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode("development-secret-key");

async function makeToken(payload: object, expiresIn = "7d") {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(SECRET);
}

beforeEach(() => {
  mockSet.mockClear();
  mockGet.mockClear();
});

test("sets cookie with name auth-token", async () => {
  await createSession("user-1", "test@example.com");
  expect(mockSet).toHaveBeenCalledOnce();
  expect(mockSet.mock.calls[0][0]).toBe("auth-token");
});

test("JWT payload contains correct userId and email", async () => {
  await createSession("user-42", "hello@example.com");
  const token = mockSet.mock.calls[0][1];
  const { payload } = await jwtVerify(token, SECRET);
  expect(payload.userId).toBe("user-42");
  expect(payload.email).toBe("hello@example.com");
});

test("cookie is httpOnly", async () => {
  await createSession("user-1", "test@example.com");
  const options = mockSet.mock.calls[0][2];
  expect(options.httpOnly).toBe(true);
});

test("cookie sameSite is lax", async () => {
  await createSession("user-1", "test@example.com");
  const options = mockSet.mock.calls[0][2];
  expect(options.sameSite).toBe("lax");
});

test("cookie path is /", async () => {
  await createSession("user-1", "test@example.com");
  const options = mockSet.mock.calls[0][2];
  expect(options.path).toBe("/");
});

test("cookie secure is false outside production", async () => {
  await createSession("user-1", "test@example.com");
  const options = mockSet.mock.calls[0][2];
  expect(options.secure).toBe(false);
});

test("cookie secure is true in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await createSession("user-1", "test@example.com");
  const options = mockSet.mock.calls[0][2];
  expect(options.secure).toBe(true);
  vi.unstubAllEnvs();
});

test("cookie expires approximately 7 days from now", async () => {
  const before = Date.now();
  await createSession("user-1", "test@example.com");
  const after = Date.now();
  const options = mockSet.mock.calls[0][2];
  const expires: Date = options.expires;
  expect(expires).toBeInstanceOf(Date);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
  expect(expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
});

// --- getSession ---

test("getSession returns null when cookie is absent", async () => {
  mockGet.mockReturnValue(undefined);
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null when cookie value is undefined", async () => {
  mockGet.mockReturnValue({ value: undefined });
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns session payload for a valid token", async () => {
  const token = await makeToken({ userId: "user-99", email: "valid@example.com" });
  mockGet.mockReturnValue({ value: token });
  const session = await getSession();
  expect(session).not.toBeNull();
  expect(session?.userId).toBe("user-99");
  expect(session?.email).toBe("valid@example.com");
});

test("getSession returns null for an expired token", async () => {
  const token = await makeToken({ userId: "user-1", email: "x@example.com" }, "0s");
  mockGet.mockReturnValue({ value: token });
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null when token is signed with wrong secret", async () => {
  const wrongSecret = new TextEncoder().encode("wrong-secret");
  const token = await new SignJWT({ userId: "user-1", email: "x@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(wrongSecret);
  mockGet.mockReturnValue({ value: token });
  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a malformed token string", async () => {
  mockGet.mockReturnValue({ value: "not.a.valid.jwt" });
  const session = await getSession();
  expect(session).toBeNull();
});
