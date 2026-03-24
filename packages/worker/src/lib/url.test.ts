import { describe, it, expect } from "vitest";
import { siteUrl, apiUrl } from "./url";

const prodEnv = { DOMAIN: "tinycloud.dev", API_HOST: "api.tinycloud.dev" } as any;

describe("siteUrl", () => {
  it("returns subdomain URL in production", () => {
    expect(siteUrl("https://api.tinycloud.dev/publish", prodEnv, "my-site"))
      .toBe("https://my-site.tinycloud.dev");
  });

  it("returns /s/:slug path on localhost", () => {
    expect(siteUrl("http://localhost:8787/publish", prodEnv, "my-site"))
      .toBe("http://localhost:8787/s/my-site");
  });

  it("returns /s/:slug path on 127.0.0.1", () => {
    expect(siteUrl("http://127.0.0.1:8787/publish", prodEnv, "my-site"))
      .toBe("http://127.0.0.1:8787/s/my-site");
  });

  it("handles localhost without port", () => {
    expect(siteUrl("http://localhost/publish", prodEnv, "my-site"))
      .toBe("http://localhost/s/my-site");
  });
});

describe("apiUrl", () => {
  it("returns production API host URL", () => {
    expect(apiUrl("https://api.tinycloud.dev/publish", prodEnv, "/finalize/abc"))
      .toBe("https://api.tinycloud.dev/finalize/abc");
  });

  it("returns localhost origin URL on localhost", () => {
    expect(apiUrl("http://localhost:8787/publish", prodEnv, "/finalize/abc"))
      .toBe("http://localhost:8787/finalize/abc");
  });

  it("returns 127.0.0.1 origin URL", () => {
    expect(apiUrl("http://127.0.0.1:8787/publish", prodEnv, "/finalize/abc"))
      .toBe("http://127.0.0.1:8787/finalize/abc");
  });
});
