import { cookies } from "next/headers";
import { z } from "zod";

const oauthSchema = z.object({ state: z.string(), verifier: z.string(), clientId: z.string() });
const sessionSchema = z.object({
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  user: z.object({ id: z.string(), displayName: z.string() }),
});
export type OAuthState = z.infer<typeof oauthSchema>;
export type Session = z.infer<typeof sessionSchema>;

async function deriveKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("s2s-cookie-v1") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(value: unknown, name: string) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) }, key, data);
  return Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url");
}

export async function decrypt<T>(token: string, name: string, schema: z.ZodType<T>): Promise<T | null> {
  const key = await deriveKey();
  const bytes = Buffer.from(token, "base64url");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(name) },
      key,
      bytes.subarray(12),
    );
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(plain)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const secure = () => !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(process.env.APP_URL ?? "");

export const cookie = <T>(name: string, schema: z.ZodType<T>, maxAge: number) => ({
  get: async () => {
    const raw = (await cookies()).get(name)?.value;
    return raw ? decrypt(raw, name, schema) : null;
  },
  set: async (value: T) => {
    const store = await cookies();
    store.set(name, await encrypt(value, name), { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge });
  },
  delete: async () => {
    (await cookies()).delete(name);
  },
});

export const oauthCookie = cookie("ts_oauth", oauthSchema, 10 * 60);
export const sessionCookie = cookie("ts_session", sessionSchema, 30 * 24 * 60 * 60);
