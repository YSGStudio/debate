import { SignJWT, jwtVerify } from "jose";

const enc = new TextEncoder();

export async function signToken(
  secret: string,
  payload: Record<string, string>,
  expiresIn: string,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(enc.encode(secret));
}

export async function verifyToken<T extends Record<string, string>>(
  secret: string,
  token: string,
): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, enc.encode(secret));
    return payload as unknown as T;
  } catch {
    return null;
  }
}
