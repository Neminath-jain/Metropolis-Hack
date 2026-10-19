/**
 * Aegis-Monad Events & Decoders
 * Typed decoders and event watchers for AgentGuard onchain audit logs.
 */

import {
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  decodeEventLog,
} from "viem";
import { AGENT_GUARD_ABI } from "./contracts/generated.js";

/** Policy violation reasons emitted by AgentGuard._validatePreCall */
export enum ReasonCode {
  NO_SESSION = 0,
  EXPIRED = 1,
  TARGET_NOT_ALLOWED = 2,
  SELECTOR_NOT_ALLOWED = 3,
  TOKEN_NOT_ALLOWED = 4,
  EXCEEDS_PER_TRADE = 5,
  EXCEEDS_DAILY = 6,
  INSUFFICIENT_BALANCE = 7,
  BAD_PAIR = 8,
}

export const REASON_CODE_NAMES: Record<ReasonCode, string> = {
  [ReasonCode.NO_SESSION]: "NO_SESSION (Session not active)",
  [ReasonCode.EXPIRED]: "EXPIRED (Session deadline has passed)",
  [ReasonCode.TARGET_NOT_ALLOWED]: "TARGET_NOT_ALLOWED (Venue address not allowlisted)",
  [ReasonCode.SELECTOR_NOT_ALLOWED]: "SELECTOR_NOT_ALLOWED (Function selector not approved)",
  [ReasonCode.TOKEN_NOT_ALLOWED]: "TOKEN_NOT_ALLOWED (Token spending disabled / zero limit)",
  [ReasonCode.EXCEEDS_PER_TRADE]: "EXCEEDS_PER_TRADE (Trade size exceeds per-trade limit)",
  [ReasonCode.EXCEEDS_DAILY]: "EXCEEDS_DAILY (Trade size exceeds rolling 24-hour daily budget)",
  [ReasonCode.INSUFFICIENT_BALANCE]: "INSUFFICIENT_BALANCE (Vault balance lower than amountIn)",
  [ReasonCode.BAD_PAIR]: "BAD_PAIR (Trade pair invalid or target equals token/guard)",
};

/** Translates numeric reason code to human-readable string description */
export function formatReasonCode(code: number): string {
  const reason = REASON_CODE_NAMES[code as ReasonCode];
  return reason ?? `UNKNOWN_REASON_CODE (${code})`;
}

export interface DecodedPolicyCreated {
  readonly eventName: "PolicyCreated";
  readonly user: Address;
  readonly agent: Address;
  readonly agentId: bigint;
  readonly expiresAt: bigint;
  readonly policyHash: Hex;
  readonly log: Log;
}

export interface DecodedSessionRevoked {
  readonly eventName: "SessionRevoked";
  readonly user: Address;
  readonly agent: Address;
  readonly log: Log;
}

export interface DecodedActionExecuted {
  readonly eventName: "ActionExecuted";
  readonly user: Address;
  readonly agent: Address;
  readonly target: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly spent: bigint;
  readonly received: bigint;
  readonly decisionHash: Hex;
  readonly log: Log;
}

export interface DecodedPolicyViolation {
  readonly eventName: "PolicyViolation";
  readonly user: Address;
  readonly agent: Address;
  readonly reasonCode: ReasonCode;
  readonly reasonName: string;
  readonly decisionHash: Hex;
  readonly log: Log;
}

export type DecodedAgentGuardEvent =
  | DecodedPolicyCreated
  | DecodedSessionRevoked
  | DecodedActionExecuted
  | DecodedPolicyViolation;

/**
 * Decodes a raw log emitted by the AgentGuard contract.
 *
 * @param log - Raw EVM log
 * @returns Decoded event object or null if not a recognized AgentGuard event
 */
export function decodeAgentGuardLog(log: Log): DecodedAgentGuardEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: AGENT_GUARD_ABI,
      data: log.data,
      topics: log.topics,
    });

    if (decoded.eventName === "PolicyViolation") {
      const args = decoded.args as {
        user: Address;
        agent: Address;
        reasonCode: number;
        decisionHash: Hex;
      };
      return {
        eventName: "PolicyViolation",
        user: args.user,
        agent: args.agent,
        reasonCode: args.reasonCode,
        reasonName: formatReasonCode(args.reasonCode),
        decisionHash: args.decisionHash,
        log,
      };
    }

    if (decoded.eventName === "ActionExecuted") {
      const args = decoded.args as {
        user: Address;
        agent: Address;
        target: Address;
        tokenIn: Address;
        tokenOut: Address;
        spent: bigint;
        received: bigint;
        decisionHash: Hex;
      };
      return {
        eventName: "ActionExecuted",
        user: args.user,
        agent: args.agent,
        target: args.target,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        spent: args.spent,
        received: args.received,
        decisionHash: args.decisionHash,
        log,
      };
    }

    if (decoded.eventName === "PolicyCreated") {
      const args = decoded.args as {
        user: Address;
        agent: Address;
        agentId: bigint;
        expiresAt: bigint;
        policyHash: Hex;
      };
      return {
        eventName: "PolicyCreated",
        user: args.user,
        agent: args.agent,
        agentId: args.agentId,
        expiresAt: args.expiresAt,
        policyHash: args.policyHash,
        log,
      };
    }

    if (decoded.eventName === "SessionRevoked") {
      const args = decoded.args as {
        user: Address;
        agent: Address;
      };
      return {
        eventName: "SessionRevoked",
        user: args.user,
        agent: args.agent,
        log,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Watches onchain PolicyViolation events in real-time.
 */
export function watchViolations(
  publicClient: PublicClient,
  guardAddress: Address,
  onViolation: (violation: DecodedPolicyViolation) => void,
  onError?: (error: Error) => void
): () => void {
  return publicClient.watchContractEvent({
    address: guardAddress,
    abi: AGENT_GUARD_ABI,
    eventName: "PolicyViolation",
    onLogs: (logs) => {
      for (const log of logs) {
        const decoded = decodeAgentGuardLog(log);
        if (decoded && decoded.eventName === "PolicyViolation") {
          onViolation(decoded);
        }
      }
    },
    onError,
  });
}

/**
 * Watches onchain ActionExecuted events in real-time.
 */
export function watchExecutions(
  publicClient: PublicClient,
  guardAddress: Address,
  onExecution: (execution: DecodedActionExecuted) => void,
  onError?: (error: Error) => void
): () => void {
  return publicClient.watchContractEvent({
    address: guardAddress,
    abi: AGENT_GUARD_ABI,
    eventName: "ActionExecuted",
    onLogs: (logs) => {
      for (const log of logs) {
        const decoded = decodeAgentGuardLog(log);
        if (decoded && decoded.eventName === "ActionExecuted") {
          onExecution(decoded);
        }
      }
    },
    onError,
  });
}
