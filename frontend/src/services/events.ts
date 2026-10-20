import { parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./aegis";
import { CONFIG } from "../config";
import { ReasonCode, formatReasonCode } from "@aegis-monad/sdk";

export interface AegisHistoryEvent {
  id: string;
  type: "ActionExecuted" | "PolicyViolation";
  user: Address;
  agent: Address;
  target?: Address;
  tokenIn?: Address;
  tokenOut?: Address;
  spent?: bigint;
  received?: bigint;
  decisionHash: Hex;
  reasonCode?: number;
  reasonName?: string;
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface EventSource {
  getEvents(user?: Address, maxCount?: number): Promise<AegisHistoryEvent[]>;
}

const ACTION_EXECUTED_EVENT = parseAbiItem(
  "event ActionExecuted(address indexed user, address indexed agent, address indexed target, address tokenIn, address tokenOut, uint256 spent, uint256 received, bytes32 decisionHash)"
);

const POLICY_VIOLATION_EVENT = parseAbiItem(
  "event PolicyViolation(address indexed user, address indexed agent, uint8 indexed reasonCode, bytes32 decisionHash)"
);

export class ViemChainEventSource implements EventSource {
  async getEvents(user?: Address, maxCount = 50): Promise<AegisHistoryEvent[]> {
    try {
      const latestBlock = await publicClient.getBlockNumber();
      // On Monad testnet, eth_getLogs is strictly capped at a 100-block range
      const fromBlock = latestBlock > 90n ? latestBlock - 90n : 0n;

      const [actionLogs, violationLogs] = await Promise.all([
        publicClient.getLogs({
          address: CONFIG.contracts.agentGuard,
          event: ACTION_EXECUTED_EVENT,
          args: user ? { user } : undefined,
          fromBlock,
          toBlock: latestBlock,
        }),
        publicClient.getLogs({
          address: CONFIG.contracts.agentGuard,
          event: POLICY_VIOLATION_EVENT,
          args: user ? { user } : undefined,
          fromBlock,
          toBlock: latestBlock,
        }),
      ]);

      const events: AegisHistoryEvent[] = [];

      for (const log of actionLogs) {
        events.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          type: "ActionExecuted",
          user: log.args.user as Address,
          agent: log.args.agent as Address,
          target: log.args.target as Address,
          tokenIn: log.args.tokenIn as Address,
          tokenOut: log.args.tokenOut as Address,
          spent: log.args.spent,
          received: log.args.received,
          decisionHash: log.args.decisionHash as Hex,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });
      }

      for (const log of violationLogs) {
        const code = Number(log.args.reasonCode ?? 0);
        const name = formatReasonCode(code as ReasonCode);
        events.push({
          id: `${log.transactionHash}-${log.logIndex}`,
          type: "PolicyViolation",
          user: log.args.user as Address,
          agent: log.args.agent as Address,
          decisionHash: log.args.decisionHash as Hex,
          reasonCode: code,
          reasonName: name,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });
      }

      // Sort descending by block number
      events.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

      return events.slice(0, maxCount);
    } catch (err) {
      console.warn("ViemChainEventSource.getEvents error:", err);
      return [];
    }
  }
}

// Default exportable event source singleton
export const eventSource: EventSource = new ViemChainEventSource();
