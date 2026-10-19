// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentGuard} from "../src/AgentGuard.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockDEX} from "../test/mocks/MockDEX.sol";

contract DeployScript is Script {
    address public constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        vm.startBroadcast();

        address deployer = msg.sender;
        console2.log("Deploying Aegis-Monad on chain ID:", block.chainid);
        console2.log("Deployer address:", deployer);

        // 1. Deploy AgentGuard with ERC-8004 registry
        AgentGuard guard = new AgentGuard(deployer, ERC8004_REGISTRY);
        console2.log("AgentGuard deployed at:", address(guard));

        // 2. Deploy test tokens (Token A: Mock WMON, Token B: Mock USDT)
        MockERC20 tokenA = new MockERC20("Mock Wrapped Monad", "mWMON", 18);
        MockERC20 tokenB = new MockERC20("Mock Tether USD", "mUSDT", 18);
        console2.log("Token A (Mock WMON) deployed at:", address(tokenA));
        console2.log("Token B (Mock USDT) deployed at:", address(tokenB));

        // 3. Deploy MockDEX
        MockDEX dex = new MockDEX();
        console2.log("MockDEX deployed at:", address(dex));

        // 4. Fund MockDEX with initial liquidity (1,000,000 each)
        tokenA.mint(address(dex), 1_000_000 ether);
        tokenB.mint(address(dex), 1_000_000 ether);

        // Also mint some tokens to deployer for testing
        tokenA.mint(deployer, 100_000 ether);
        tokenB.mint(deployer, 100_000 ether);

        // 5. Approve MockDEX as a vetted target on AgentGuard
        guard.setApprovedTarget(address(dex), true);
        console2.log("MockDEX approved on AgentGuard");

        vm.stopBroadcast();
    }
}
