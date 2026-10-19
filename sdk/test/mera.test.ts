import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deriveEoaFromPasskey } from "../src/mera.js";

describe("Mera Helper (Identity Path A: Passkey-Derived EOA)", () => {
  const dummyEntropy = new Uint8Array(32);
  dummyEntropy[31] = 0x01; // Valid 32-byte secp256k1 private key: 0x00...01

  it("derives a valid viem LocalAccount when explicit PRF entropy / private key is provided", async () => {
    const account = await deriveEoaFromPasskey({
      privateKey: dummyEntropy,
    });

    expect(account).toBeDefined();
    expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(account.source).toBe("mera");
    expect(typeof account.signMessage).toBe("function");
    expect(typeof account.signTransaction).toBe("function");

    // Known address for private key 1: 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
    expect(account.address.toLowerCase()).toBe(
      "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
    );
  });

  it("throws descriptive error in headless / Node environment when no privateKey is provided", async () => {
    // In Node.js, window is undefined
    await expect(deriveEoaFromPasskey()).rejects.toThrow(
      "deriveEoaFromPasskey() requires a browser environment supporting WebAuthn PRF."
    );
  });

  describe("Browser Environment (Mocked WebAuthn PRF)", () => {
    beforeEach(() => {
      // Mock browser window object
      (globalThis as any).window = {
        location: {
          hostname: "test.aegis.monad",
        },
      };
    });

    afterEach(() => {
      delete (globalThis as any).window;
      vi.restoreAllMocks();
    });

    it("creates passkey with PRF output and returns derived viem account", async () => {
      const { createPasskeyWithPrfOutput } = await import("@category-labs/mera");
      const mockPrfOutput = new Uint8Array(32).fill(0x42);

      vi.spyOn({ createPasskeyWithPrfOutput }, "createPasskeyWithPrfOutput").mockResolvedValueOnce({
        credential: { id: "test-cred-id", rawId: new Uint8Array([1, 2, 3]) } as any,
        prfOutput: mockPrfOutput,
      });

      const account = await deriveEoaFromPasskey({
        privateKey: mockPrfOutput, // Provide the derived PRF output
        rp: { id: "test.aegis.monad", name: "Aegis Test" },
        user: { name: "alice@monad", displayName: "Alice" },
      });

      expect(account).toBeDefined();
      expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });
});
