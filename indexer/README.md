# Aegis Indexer (Envio HyperIndex)

This directory contains the Envio HyperIndex configuration for indexing Aegis-Monad onchain events on Monad Testnet (Chain ID `10143`).

## Monad Testnet Setup

- **Chain ID:** `10143`
- **HyperSync Endpoint:** `https://monad-testnet.hypersync.xyz`
- **HyperRPC Endpoint:** `https://monad-testnet.rpc.hypersync.xyz`

## Events to Index

1. `PolicyCreated(address indexed user, address indexed agent, uint64 expiresAt)`
2. `SessionRevoked(address indexed user, address indexed agent)`
3. `Deposited(address indexed user, address indexed token, uint256 amount)`
4. `Withdrawn(address indexed user, address indexed token, uint256 amount)`
5. `ActionExecuted(address indexed user, address indexed agent, address indexed target, address tokenIn, address tokenOut, uint256 spent, uint256 received, bytes32 decisionHash)`
6. `PolicyViolation(address indexed user, address indexed agent, uint8 reasonCode, bytes32 decisionHash)`

## Quickstart (Phase 4)

```bash
pnpm install
pnpm codegen
pnpm envio dev
```
