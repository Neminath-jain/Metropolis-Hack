/**
 * Aegis-Monad Mera Helper (Optional Identity Path A)
 * Integrates @category-labs/mera to derive a secp256k1 EOA LocalAccount from a passkey.
 */

import type { LocalAccount } from "viem";
import {
  createSecp256k1SigningSession,
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  type PasskeyCredentialMetadata,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";

export interface DeriveEoaFromPasskeyOptions {
  /** Relying party configuration. */
  readonly rp?: { readonly id?: string; readonly name?: string };
  /** User display information. */
  readonly user?: { readonly name: string; readonly displayName: string };
  /** Optional existing passkey credential metadata. If omitted, prompts to create one. */
  readonly credential?: PasskeyCredentialMetadata;
  /** Explicit 32-byte secp256k1 private key or PRF output. */
  readonly privateKey?: Uint8Array;
}

/**
 * Derives a secp256k1 EOA viem LocalAccount from a WebAuthn passkey using Category Labs' Mera SDK.
 *
 * This provides Identity Path A (Passkey-Derived EOA):
 * 1. Evaluates 32 bytes of deterministic entropy using WebAuthn PRF extension.
 * 2. Instantiates a secp256k1 signing session with createSecp256k1SigningSession.
 * 3. Adapts the session into a standard viem LocalAccount capable of signing transactions and messages.
 *
 * @param options - Configuration options
 * @returns A viem LocalAccount with source 'mera'
 */
export async function deriveEoaFromPasskey(
  options?: DeriveEoaFromPasskeyOptions
): Promise<LocalAccount<"mera">> {
  let privateKey = options?.privateKey;

  if (!privateKey) {
    if (typeof window === "undefined") {
      throw new Error(
        "deriveEoaFromPasskey() requires a browser environment supporting WebAuthn PRF."
      );
    }

    const rp = {
      id: options?.rp?.id ?? window.location.hostname,
      name: options?.rp?.name ?? "Aegis-Monad",
    };

    if (options?.credential) {
      const { prfOutput } = await getPasskeyPrfOutput({
        rpId: rp.id,
        credential: options.credential,
      });
      privateKey = prfOutput;
    } else {
      const { prfOutput } = await createPasskeyWithPrfOutput({
        rp,
        user: options?.user ?? {
          name: "aegis-user@monad",
          displayName: "Aegis User",
        },
      });
      privateKey = prfOutput;
    }
  }

  const session = createSecp256k1SigningSession({ privateKey });
  return toViemAccount(session);
}
