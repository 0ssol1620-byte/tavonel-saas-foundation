import { describe, expect, it } from "vitest";
import { createSupabaseBrowserClient } from "./providerClients";

describe("provider browser clients", () => {
  it("does not create a Supabase browser client without a dedicated HTTPS configuration", () => {
    expect(createSupabaseBrowserClient({})).toBeNull();
    expect(createSupabaseBrowserClient({ supabaseUrl: "http://unsafe.example", supabaseAnonKey: "publishable" })).toBeNull();
  });
});
