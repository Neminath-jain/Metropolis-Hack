// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/AgentGuard.sol";
import "../src/interfaces/IAgentGuard.sol";

contract AgentGuardHarness is AgentGuard {
    constructor(address _agentRegistry, address _owner) AgentGuard(_agentRegistry, _owner) {}

    function exposeHashPolicy(Policy calldata policy) external pure returns (bytes32) {
        return _hashPolicy(policy);
    }

    function exposeBuildChallenge(
        bytes32 actionTypehash,
        uint256 chainId,
        address guard,
        address userId,
        bytes32 payloadHash,
        uint256 nonce,
        uint256 deadline
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(actionTypehash, chainId, guard, userId, payloadHash, nonce, deadline));
    }
}

contract GoldenVectorsTest is Test {
    AgentGuardHarness harness;

    function setUp() public {
        harness = new AgentGuardHarness(address(0x1), address(this));
    }

    function test_PrintGoldenVectors() public view {
        address tokenA = 0x5991A2dF15A8F6A256D3Ec51E99254Cd3fb576A9;
        address tokenB = 0xc7183455a4C133Ae270771860664b6B7ec320bB1;
        address venue = 0x1d1499e622D69689cdf9004d05Ec547d650Ff211;
        bytes4 selector = bytes4(keccak256("swap(address,uint256,address,uint256)"));

        IAgentGuard.TokenConfig[] memory tokens = new IAgentGuard.TokenConfig[](1);
        tokens[0] = IAgentGuard.TokenConfig({
            token: tokenA,
            dailyLimit: 100 ether,
            perTradeLimit: 20 ether
        });

        address[] memory targets = new address[](1);
        targets[0] = venue;

        IAgentGuard.TargetSelector[] memory selectors = new IAgentGuard.TargetSelector[](1);
        selectors[0] = IAgentGuard.TargetSelector({
            target: venue,
            selector: selector,
            allowed: true
        });

        IAgentGuard.PairRate[] memory rates = new IAgentGuard.PairRate[](1);
        rates[0] = IAgentGuard.PairRate({
            tokenIn: tokenA,
            tokenOut: tokenB,
            minRate: 1 ether
        });

        IAgentGuard.Policy memory policy = IAgentGuard.Policy({
            tokens: tokens,
            targets: targets,
            selectors: selectors,
            rates: rates
        });

        bytes32 policyHash = harness.exposeHashPolicy(policy);
        console.log("FOUNDRY_POLICY_HASH:");
        console.logBytes32(policyHash);

        uint256 chainId = 10143;
        address guard = 0x10a59fbc6ffEebc8Fe17764C3e94Ba8136098618;
        address user = 0x8ec3b943e88E33E31920E73F729d642b03A6A3f3;
        uint256 deadline = 1700000000;

        // 1. REGISTER SESSION CHALLENGE
        bytes32 registerPayloadHash = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
        bytes32 registerChallenge = harness.exposeBuildChallenge(
            harness.REGISTER_SESSION_TYPEHASH(),
            chainId,
            guard,
            user,
            registerPayloadHash,
            0,
            deadline
        );
        console.log("FOUNDRY_REGISTER_CHALLENGE:");
        console.logBytes32(registerChallenge);

        // 2. REVOKE SESSION CHALLENGE
        address agent = 0x19615D52EdfF1c18941FC5BcE83Fb5c4C5F28eFd;
        bytes32 revokePayloadHash = keccak256(abi.encode(agent));
        bytes32 revokeChallenge = harness.exposeBuildChallenge(
            harness.REVOKE_SESSION_TYPEHASH(),
            chainId,
            guard,
            user,
            revokePayloadHash,
            1,
            deadline
        );
        console.log("FOUNDRY_REVOKE_CHALLENGE:");
        console.logBytes32(revokeChallenge);

        // 3. WITHDRAW CHALLENGE
        address withdrawTo = 0x2222222222222222222222222222222222222222;
        uint256 withdrawAmount = 5 ether;
        bytes32 withdrawPayloadHash = keccak256(abi.encode(tokenA, withdrawAmount, withdrawTo));
        bytes32 withdrawChallenge = harness.exposeBuildChallenge(
            harness.WITHDRAW_TYPEHASH(),
            chainId,
            guard,
            user,
            withdrawPayloadHash,
            2,
            deadline
        );
        console.log("FOUNDRY_WITHDRAW_CHALLENGE:");
        console.logBytes32(withdrawChallenge);
    }
}
