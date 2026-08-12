import { describe, expect, it } from "vitest";

import {
  isProtectedPath,
  isPublicAuthPath,
  loginRedirectUrl,
  safeNextPath,
  PROTECTED_PREFIXES,
  PUBLIC_AUTH_PATHS,
} from "@/lib/auth/guards";

describe("isProtectedPath", () => {
  it("matches every protected prefix", () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(isProtectedPath(prefix)).toBe(true);
      expect(isProtectedPath(`${prefix}/`)).toBe(true);
    }
  });

  it("matches nested routes", () => {
    expect(isProtectedPath("/settings/sales-profile")).toBe(true);
    expect(isProtectedPath("/calls/practice")).toBe(true);
    expect(isProtectedPath("/calls/9c2d0b45-1d3a-4f1a-9f2b-0c1a2b3c4d5e/live")).toBe(
      true
    );
    expect(isProtectedPath("/prospects/new")).toBe(true);
  });

  it("rejects public paths and lookalikes", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/signup")).toBe(false);
    expect(isProtectedPath("/forgot-password")).toBe(false);
    expect(isProtectedPath("/calls-not-real")).toBe(false);
    expect(isProtectedPath("/homepage")).toBe(false);
  });
});

describe("isPublicAuthPath", () => {
  it("matches exactly the public auth pages", () => {
    for (const path of PUBLIC_AUTH_PATHS) {
      expect(isPublicAuthPath(path)).toBe(true);
    }
    expect(isPublicAuthPath("/login/")).toBe(false);
    expect(isPublicAuthPath("/home")).toBe(false);
    expect(isPublicAuthPath("/")).toBe(false);
  });
});

describe("loginRedirectUrl", () => {
  it("builds a next-preserving login URL", () => {
    expect(loginRedirectUrl("/calls/practice")).toBe(
      "/login?next=%2Fcalls%2Fpractice"
    );
    expect(loginRedirectUrl("/settings/sales-profile")).toBe(
      "/login?next=%2Fsettings%2Fsales-profile"
    );
  });
});

describe("safeNextPath", () => {
  it("allows internal absolute paths", () => {
    expect(safeNextPath("/home")).toBe("/home");
    expect(safeNextPath("/prospects/new")).toBe("/prospects/new");
    expect(safeNextPath("/calls/practice?x=1")).toBe("/calls/practice?x=1");
  });

  it("falls back to /home for missing or unsafe values", () => {
    expect(safeNextPath(null)).toBe("/home");
    expect(safeNextPath(undefined)).toBe("/home");
    expect(safeNextPath("")).toBe("/home");
    expect(safeNextPath("https://evil.example.com")).toBe("/home");
    expect(safeNextPath("//evil.example.com")).toBe("/home");
    expect(safeNextPath("javascript:alert(1)")).toBe("/home");
  });
});
