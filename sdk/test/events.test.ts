import { describe, it, expect } from "vitest";
import {
  ReasonCode,
  formatReasonCode,
  decodeAgentGuardLog,
} from "../src/events.js";
import { encodeEventTopics, type Log } from "viem";
import { AGENT_GUARD_ABI } from "../src/contracts/generated.js";

describe("Events Module & Decoders", () => {
  it("maps all ReasonCode enum variants to descriptive strings", () => {
    expect(formatReasonCode(ReasonCode.NO_SESSION)).toContain("NO_SESSION");
    expect(formatReasonCode(ReasonCode.EXPIRED)).toContain("EXPIRED");
    expect(formatReasonCode(ReasonCode.TARGET_NOT_ALLOWED)).toContain("TARGET_NOT_ALLOWED");
    expect(formatReasonCode(ReasonCode.SELECTOR_NOT_ALLOWED)).toContain("SELECTOR_NOT_ALLOWED");
    expect(formatReasonCode(ReasonCode.TOKEN_NOT_ALLOWED)).toContain("TOKEN_NOT_ALLOWED");
    expect(formatReasonCode(ReasonCode.EXCEEDS_PER_TRADE)).toContain("EXCEEDS_PER_TRADE");
    expect(formatReasonCode(ReasonCode.EXCEEDS_DAILY)).toContain("EXCEEDS_DAILY");
    expect(formatReasonCode(ReasonCode.INSUFFICIENT_BALANCE)).toContain("INSUFFICIENT_BALANCE");
    expect(formatReasonCode(ReasonCode.BAD_PAIR)).toContain("BAD_PAIR");
  });

  it("handles unknown reason codes gracefully", () => {
    expect(formatReasonCode(99)).toContain("UNKNOWN_REASON_CODE (99)");
  });

  it("decodes a PolicyViolation event log properly", () => {
    const user = "0x0000000000000000000000000000000000000001";
    const agent = "0x0000000000000000000000000000000000000002";
    const reasonCode = ReasonCode.EXCEEDS_PER_TRADE;
    const decisionHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    const topics = encodeEventTopics({
      abi: AGENT_GUARD_ABI,
      eventName: "PolicyViolation",
      args: {
        user,
        agent,
        reasonCode,
      },
    });

    const mockLog: Log = {
      address: "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618",
      blockHash: "0x" as any,
      blockNumber: 12345n,
      data: decisionHash,
      logIndex: 0,
      removed: false,
      topics: topics as any,
      transactionHash: "0x" as any,
      transactionIndex: 0,
    };

    const decoded = decodeAgentGuardLog(mockLog);
    expect(decoded).not.toBeNull();
    if (decoded && decoded.eventName === "PolicyViolation") {
      expect(decoded.user.toLowerCase()).toBe(user.toLowerCase());
      expect(decoded.agent.toLowerCase()).toBe(agent.toLowerCase());
      expect(decoded.reasonCode).toBe(ReasonCode.EXCEEDS_PER_TRADE);
      expect(decoded.reasonName).toContain("EXCEEDS_PER_TRADE");
      expect(decoded.decisionHash).toBe(decisionHash);
    }
  });

  it("decodes SessionRevoked event log properly", () => {
    const user = "0x0000000000000000000000000000000000000001";
    const agent = "0x0000000000000000000000000000000000000002";

    const topics = encodeEventTopics({
      abi: AGENT_GUARD_ABI,
      eventName: "SessionRevoked",
      args: { user, agent },
    });

    const mockLog: Log = {
      address: "0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618",
      blockHash: "0x" as any,
      blockNumber: 12345n,
      data: "0x",
      logIndex: 0,
      removed: false,
      topics: topics as any,
      transactionHash: "0x" as any,
      transactionIndex: 0,
    };

    const decoded = decodeAgentGuardLog(mockLog);
    expect(decoded).not.toBeNull();
    if (decoded && decoded.eventName === "SessionRevoked") {
      expect(decoded.user.toLowerCase()).toBe(user.toLowerCase());
      expect(decoded.agent.toLowerCase()).toBe(agent.toLowerCase());
    }
  });
});
