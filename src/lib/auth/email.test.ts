import { describe, expect, it } from "vitest";
import { renderSignInEmail } from "./email";

const url = "https://draftroom.online/api/auth/callback/resend?token=abc&email=a%40b.com";
const base = { url, email: "fan@example.com", hours: 24 };

describe("renderSignInEmail", () => {
  it("greets a new account and a returning one differently", () => {
    const signUp = renderSignInEmail({ ...base, isNew: true });
    const signIn = renderSignInEmail({ ...base, isNew: false });
    expect(signUp.subject).not.toBe(signIn.subject);
    expect(signUp.html).toContain("Enter the war room");
    expect(signIn.html).toContain("Sign in");
  });

  it("escapes the link in the HTML and leaves it intact in the text part", () => {
    const { html, text } = renderSignInEmail({ ...base, isNew: false });
    expect(html).toContain('href="https://draftroom.online/api/auth/callback/resend?token=abc&amp;email=a%40b.com"');
    expect(html).not.toContain("token=abc&email");
    expect(text).toContain(url);
  });

  it("escapes the address it names", () => {
    const { html, text } = renderSignInEmail({ ...base, email: '"><script>@x.com', isNew: true });
    expect(html).not.toContain("<script>");
    expect(text).toContain('"><script>@x.com');
  });

  it("states how long the link lasts", () => {
    expect(renderSignInEmail({ ...base, isNew: true }).text).toContain("expires in 24 hours");
    expect(renderSignInEmail({ ...base, hours: 1, isNew: true }).text).toContain("expires in 1 hour.");
  });
});
