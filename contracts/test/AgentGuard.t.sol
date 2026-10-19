// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentGuard} from "../src/AgentGuard.sol";
import {IAgentGuard} from "../src/interfaces/IAgentGuard.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockDEX} from "./mocks/MockDEX.sol";
import {MockAgentRegistry} from "./mocks/MockAgentRegistry.sol";
import {OverpullDEX, ReentrancyDEX, ShortDeliveryDEX, RevertingDEX} from "./mocks/EvilDEX.sol";
import {MockP256Precompile} from "./mocks/MockP256Precompile.sol";
import {WebAuthnHelper} from "./helpers/WebAuthnHelper.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract AgentGuardTest is Test, WebAuthnHelper {
    AgentGuard public guard;
    MockAgentRegistry public registry;
    MockERC20 public tokenA; // e.g. WMON
    MockERC20 public tokenB; // e.g. USDT
    MockERC20 public feeToken; // Fee-on-transfer token
    MockDEX public dex;

    OverpullDEX public overpullDEX;
    ReentrancyDEX public reentrancyDEX;
    ShortDeliveryDEX public shortDeliveryDEX;
    RevertingDEX public revertingDEX;

    address public owner = address(0x10);
    address public alice = address(0x20);
    address public bob = address(0x30);
    address public agent = address(0x40);
    address public relayer = address(0x50);

    address public passkeyUser;
    uint256 public constant AGENT_ID = 1;

    bytes4 public constant SWAP_SELECTOR = bytes4(keccak256("swap(address,uint256,address,uint256)"));

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, address indexed to);
    event PolicyCreated(
        address indexed user, address indexed agent, uint256 agentId, uint64 expiresAt, bytes32 policyHash
    );
    event SessionRevoked(address indexed user, address indexed agent);
    event ActionExecuted(
        address indexed user,
        address indexed agent,
        address indexed target,
        address tokenIn,
        address tokenOut,
        uint256 spent,
        uint256 received,
        bytes32 decisionHash
    );
    event PolicyViolation(
        address indexed user, address indexed agent, IAgentGuard.ReasonCode indexed reasonCode, bytes32 decisionHash
    );
    event PasskeyRegistered(address indexed userId, uint256 qx, uint256 qy);
    event TargetApprovalUpdated(address indexed target, bool approved);
    event RegistryUpdated(address indexed registry);

    function setUp() public virtual {
        // Warp to realistic timestamp
        vm.warp(1_700_000_000);

        // 1. Etch MockP256Precompile at 0x0100 and CANARY for Solady P256 verification
        MockP256Precompile mockPrecompile = new MockP256Precompile();
        vm.etch(address(0x0100), address(mockPrecompile).code);
        vm.etch(0x0000000000001Ab2e8006Fd8B71907bf06a5BDEE, hex"00");

        // 2. Deploy core dependencies
        registry = new MockAgentRegistry();
        guard = new AgentGuard(owner, address(registry));

        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);
        feeToken = new MockERC20("Fee Token", "FEET", 18);

        dex = new MockDEX();
        overpullDEX = new OverpullDEX();
        reentrancyDEX = new ReentrancyDEX(address(guard));
        shortDeliveryDEX = new ShortDeliveryDEX();
        revertingDEX = new RevertingDEX();

        // 3. Setup owner vetting
        vm.startPrank(owner);
        guard.setApprovedTarget(address(dex), true);
        guard.setApprovedTarget(address(overpullDEX), true);
        guard.setApprovedTarget(address(reentrancyDEX), true);
        guard.setApprovedTarget(address(shortDeliveryDEX), true);
        guard.setApprovedTarget(address(revertingDEX), true);
        vm.stopPrank();

        // 4. Register agent in ERC-8004 registry
        registry.setAgentOwner(AGENT_ID, agent);

        // 5. Register passkey user
        passkeyUser = guard.registerPasskey(TEST_QX, TEST_QY);

        // 6. Fund participants & DEX
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);
        tokenA.mint(passkeyUser, 1_000_000 ether);
        feeToken.mint(alice, 1_000_000 ether);

        // Fund DEXes with output tokens
        tokenB.mint(address(dex), 10_000_000 ether);
        tokenA.mint(address(dex), 10_000_000 ether);
        tokenB.mint(address(overpullDEX), 10_000_000 ether);
        tokenB.mint(address(reentrancyDEX), 10_000_000 ether);
        tokenB.mint(address(shortDeliveryDEX), 10_000_000 ether);

        // Alice and Bob approve guard for deposits
        vm.prank(alice);
        tokenA.approve(address(guard), type(uint256).max);
        vm.prank(alice);
        feeToken.approve(address(guard), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(guard), type(uint256).max);
    }

    // Helper to generate a standard policy for tokenA -> tokenB trading on dex
    function _defaultPolicy(uint128 dailyLimit, uint128 perTradeLimit)
        internal
        view
        returns (IAgentGuard.Policy memory policy)
    {
        policy.tokens = new IAgentGuard.TokenConfig[](1);
        policy.tokens[0] =
            IAgentGuard.TokenConfig({token: address(tokenA), dailyLimit: dailyLimit, perTradeLimit: perTradeLimit});

        policy.targets = new address[](1);
        policy.targets[0] = address(dex);

        policy.selectors = new IAgentGuard.TargetSelector[](1);
        policy.selectors[0] = IAgentGuard.TargetSelector({target: address(dex), selector: SWAP_SELECTOR, allowed: true});

        policy.rates = new IAgentGuard.PairRate[](1);
        policy.rates[0] = IAgentGuard.PairRate({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            minRate: 1e18 // 1:1 floor
        });
    }

    // =========================================================================
    // CONSTRUCTOR & INITIALIZATION TESTS
    // =========================================================================

    function test_Constructor_ZeroRegistryReverts() public {
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        new AgentGuard(owner, address(0));
    }

    function test_Constructor_InitialState() public {
        assertEq(guard.owner(), owner);
        assertEq(address(guard.registry()), address(registry));
        assertEq(guard.SECP256R1_N_DIV_2(), guard.SECP256R1_N() >> 1);
    }

    // =========================================================================
    // VAULT DEPOSIT & WITHDRAWAL TESTS
    // =========================================================================

    function test_Deposit_HappyPath() public {
        uint256 amount = 100 ether;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Deposited(alice, address(tokenA), amount);
        uint256 received = guard.deposit(address(tokenA), amount);

        assertEq(received, amount);
        assertEq(guard.balances(alice, address(tokenA)), amount);
        assertEq(tokenA.balanceOf(address(guard)), amount);
    }

    function test_Deposit_ZeroTokenReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.deposit(address(0), 100 ether);
    }

    function test_Deposit_ZeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAmount.selector);
        guard.deposit(address(tokenA), 0);
    }

    function test_DepositFor_HappyPath() public {
        uint256 amount = 50 ether;
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Deposited(bob, address(tokenA), amount);
        uint256 received = guard.depositFor(bob, address(tokenA), amount);

        assertEq(received, amount);
        assertEq(guard.balances(bob, address(tokenA)), amount);
        assertEq(guard.balances(alice, address(tokenA)), 0);
    }

    function test_DepositFor_ZeroUserReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.depositFor(address(0), address(tokenA), 10 ether);
    }

    function test_Deposit_FeeOnTransferSafety() public {
        // Set 5% fee on transfer
        feeToken.setFeeBasisPoints(500);

        uint256 depositAmount = 100 ether;
        vm.prank(alice);
        uint256 received = guard.deposit(address(feeToken), depositAmount);

        // Expected received is 95% = 95 ether
        assertEq(received, 95 ether);
        assertEq(guard.balances(alice, address(feeToken)), 95 ether);
        assertEq(feeToken.balanceOf(address(guard)), 95 ether);
        assertEq(feeToken.balanceOf(address(0xdead)), 5 ether);
    }

    function test_Deposit_100PercentFeeRevertsZeroAmount() public {
        // 100% fee = 10000 bps
        feeToken.setFeeBasisPoints(10000);
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAmount.selector);
        guard.deposit(address(feeToken), 100 ether);
    }

    function test_Withdraw_HappyPath() public {
        uint256 depositAmount = 100 ether;
        vm.prank(alice);
        guard.deposit(address(tokenA), depositAmount);

        address recipient = address(0x999);
        uint256 withdrawAmount = 40 ether;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Withdrawn(alice, address(tokenA), withdrawAmount, recipient);
        guard.withdraw(address(tokenA), withdrawAmount, recipient);

        assertEq(guard.balances(alice, address(tokenA)), 60 ether);
        assertEq(tokenA.balanceOf(recipient), withdrawAmount);
    }

    function test_Withdraw_ZeroTokenReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.withdraw(address(0), 10 ether, alice);
    }

    function test_Withdraw_ZeroRecipientReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.withdraw(address(tokenA), 10 ether, address(0));
    }

    function test_Withdraw_ZeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAmount.selector);
        guard.withdraw(address(tokenA), 0, alice);
    }

    function test_Withdraw_InsufficientBalanceReverts() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 50 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.InsufficientBalance.selector, 50 ether, 100 ether));
        guard.withdraw(address(tokenA), 100 ether, alice);
    }

    function test_Withdraw_AlwaysAvailableWhenPaused() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        vm.prank(owner);
        guard.pause();

        // Withdraw must still succeed when paused
        vm.prank(alice);
        guard.withdraw(address(tokenA), 100 ether, alice);
        assertEq(guard.balances(alice, address(tokenA)), 0);
    }

    function test_Withdraw_AvailableAfterSessionRevoked() public {
        vm.startPrank(alice);
        guard.deposit(address(tokenA), 100 ether);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 50 ether));
        guard.revokeSession(agent);
        guard.withdraw(address(tokenA), 100 ether, alice);
        vm.stopPrank();

        assertEq(guard.balances(alice, address(tokenA)), 0);
    }

    // =========================================================================
    // WEBAUTHN PASSKEY WITHDRAWAL TESTS
    // =========================================================================

    function test_WithdrawWithPasskey_HappyPath() public {
        // Fund passkeyUser via depositFor
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 withdrawAmount = 30 ether;
        address recipient = address(0x888);

        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), withdrawAmount, recipient));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );

        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        // Relayer submits on behalf of passkey user
        vm.prank(relayer);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), withdrawAmount, recipient, nonce, deadline, auth);

        assertEq(guard.balances(passkeyUser, address(tokenA)), 70 ether);
        assertEq(tokenA.balanceOf(recipient), withdrawAmount);
        assertEq(guard.nextNonce(passkeyUser), nonce + 1);
    }

    function test_WithdrawWithPasskey_DeadlineExpiredReverts() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp - 1; // Expired
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.DeadlineExpired.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_InvalidNonceReverts() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 wrongNonce = 999;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, wrongNonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.InvalidNonce.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, wrongNonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_UnregisteredPasskeyReverts() public {
        address unregUser = address(0xdeadbeef);
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(bytes32(0), true);

        vm.expectRevert(IAgentGuard.PasskeyNotRegistered.selector);
        guard.withdrawWithPasskey(unregUser, address(tokenA), 10 ether, alice, 0, block.timestamp + 1 hours, auth);
    }

    function test_WithdrawWithPasskey_MalleableSignatureRejected() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        // Set s > N/2 (malleable)
        auth.s = bytes32(guard.SECP256R1_N_DIV_2() + 1);

        vm.expectRevert(IAgentGuard.InvalidSignatureS.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_ZeroRRejected() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);
        auth.r = bytes32(0); // Invalid r

        vm.expectRevert(IAgentGuard.InvalidSignatureR.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_ZeroSRejected() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);
        auth.s = bytes32(0); // Invalid s

        vm.expectRevert(IAgentGuard.InvalidSignatureS.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_TamperedChallengeReverts() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 fakeChallenge = keccak256("fake");
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(fakeChallenge, true);

        vm.expectRevert(IAgentGuard.WebAuthnVerificationFailed.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_WithdrawWithPasskey_WorksWhenPaused() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        vm.prank(owner);
        guard.pause();

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 50 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 50 ether, alice, nonce, deadline, auth);
        assertEq(guard.balances(passkeyUser, address(tokenA)), 50 ether);
    }

    // =========================================================================
    // PASSKEY REGISTRATION TESTS
    // =========================================================================

    function test_RegisterPasskey_HappyPath() public {
        uint256 qx = 0x1234;
        uint256 qy = 0x5678;
        address expectedUserId = address(uint160(uint256(keccak256(abi.encode(qx, qy)))));

        vm.expectEmit(true, false, false, true);
        emit PasskeyRegistered(expectedUserId, qx, qy);
        address id = guard.registerPasskey(qx, qy);

        assertEq(id, expectedUserId);
        IAgentGuard.Passkey memory pk = guard.passkeyOf(id);
        assertEq(pk.qx, qx);
        assertEq(pk.qy, qy);
    }

    function test_RegisterPasskey_ZeroQxReverts() public {
        vm.expectRevert(IAgentGuard.InvalidPublicKey.selector);
        guard.registerPasskey(0, 0x1234);
    }

    function test_RegisterPasskey_ZeroQyReverts() public {
        vm.expectRevert(IAgentGuard.InvalidPublicKey.selector);
        guard.registerPasskey(0x1234, 0);
    }

    // =========================================================================
    // SESSION & POLICY REGISTRATION TESTS
    // =========================================================================

    function test_RegisterSession_HappyPath() public {
        uint64 expiry = uint64(block.timestamp + 7 days);
        IAgentGuard.Policy memory policy = _defaultPolicy(100 ether, 20 ether);

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, expiry, policy);

        IAgentGuard.Session memory sess = guard.getSession(alice, agent);
        assertTrue(sess.active);
        assertEq(sess.expiresAt, expiry);
        assertEq(sess.agentId, AGENT_ID);

        IAgentGuard.TokenLimit memory lim = guard.getLimit(alice, agent, address(tokenA));
        assertEq(lim.dailyLimit, 100 ether);
        assertEq(lim.perTradeLimit, 20 ether);
        assertEq(lim.spentInWindow, 0);
        assertEq(lim.windowStart, uint64(block.timestamp));

        assertTrue(guard.allowedTargets(alice, agent, address(dex)));
        assertTrue(guard.allowedSelectors(alice, agent, address(dex), SWAP_SELECTOR));
        assertEq(guard.minRate(alice, agent, address(tokenA), address(tokenB)), 1e18);
    }

    function test_RegisterSession_ZeroAgentReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.ZeroAgentAddress.selector);
        guard.registerSession(
            address(0), AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether)
        );
    }

    function test_RegisterSession_ExpiredOrCurrentExpiryReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.InvalidExpiry.selector);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp), _defaultPolicy(100 ether, 10 ether));

        vm.prank(alice);
        vm.expectRevert(IAgentGuard.InvalidExpiry.selector);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp - 1), _defaultPolicy(100 ether, 10 ether));
    }

    function test_RegisterSession_ExpiryBeyond30DaysReverts() public {
        vm.prank(alice);
        vm.expectRevert(IAgentGuard.InvalidExpiry.selector);
        guard.registerSession(
            agent, AGENT_ID, uint64(block.timestamp + 30 days + 1), _defaultPolicy(100 ether, 10 ether)
        );
    }

    function test_RegisterSession_UnregisteredAgentIdReverts() public {
        uint256 unregId = 999;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.AgentNotRegistered.selector, unregId));
        guard.registerSession(agent, unregId, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether));
    }

    function test_RegisterSession_AgentOwnerMismatchReverts() public {
        uint256 otherId = 2;
        registry.setAgentOwner(otherId, bob); // Owner is bob, not agent

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.AgentOwnerMismatch.selector, otherId, agent, bob));
        guard.registerSession(agent, otherId, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether));
    }

    function test_RegisterSession_UnapprovedTargetReverts() public {
        IAgentGuard.Policy memory policy = _defaultPolicy(100 ether, 10 ether);
        address unapprovedTarget = address(0x777);
        policy.targets[0] = unapprovedTarget;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.TargetNotGloballyApproved.selector, unapprovedTarget));
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);
    }

    function test_RegisterSession_PerTradeExceedsDailyReverts() public {
        IAgentGuard.Policy memory policy = _defaultPolicy(100 ether, 101 ether); // perTrade > daily

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.InvalidTokenLimit.selector, address(tokenA)));
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);
    }

    function test_RegisterSession_ZeroDailyLimitReverts() public {
        IAgentGuard.Policy memory policy = _defaultPolicy(0, 0); // daily == 0

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAgentGuard.InvalidTokenLimit.selector, address(tokenA)));
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);
    }

    function test_RegisterSession_PausedReverts() public {
        vm.prank(owner);
        guard.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether));
    }

    // =========================================================================
    // WEBAUTHN PASSKEY SESSION REGISTRATION TESTS
    // =========================================================================

    function test_RegisterSessionWithPasskey_HappyPath() public {
        uint64 expiry = uint64(block.timestamp + 5 days);
        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 10 ether);
        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 tokensHash = keccak256(abi.encode(policy.tokens));
        bytes32 targetsHash = keccak256(abi.encode(policy.targets));
        bytes32 selectorsHash = keccak256(abi.encode(policy.selectors));
        bytes32 ratesHash = keccak256(abi.encode(policy.rates));
        bytes32 policyHash = keccak256(abi.encode(tokensHash, targetsHash, selectorsHash, ratesHash));

        bytes32 payloadHash = keccak256(abi.encode(agent, AGENT_ID, expiry, policyHash));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.REGISTER_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                payloadHash,
                nonce,
                deadline
            )
        );

        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.prank(relayer);
        guard.registerSessionWithPasskey(passkeyUser, agent, AGENT_ID, expiry, policy, nonce, deadline, auth);

        IAgentGuard.Session memory sess = guard.getSession(passkeyUser, agent);
        assertTrue(sess.active);
        assertEq(sess.expiresAt, expiry);
        assertEq(guard.nextNonce(passkeyUser), nonce + 1);
    }

    function test_RevokeSession_HappyPath() public {
        vm.startPrank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether));

        vm.expectEmit(true, true, false, true);
        emit SessionRevoked(alice, agent);
        guard.revokeSession(agent);
        vm.stopPrank();

        assertFalse(guard.getSession(alice, agent).active);
    }

    function test_RevokeSession_WorksWhenPaused() public {
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 10 ether));

        vm.prank(owner);
        guard.pause();

        vm.prank(alice);
        guard.revokeSession(agent);
        assertFalse(guard.getSession(alice, agent).active);
    }

    function test_RevokeSessionWithPasskey_HappyPath() public {
        // Register session for passkey user first
        uint64 expiry = uint64(block.timestamp + 5 days);
        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 10 ether);
        bytes32 policyHash = keccak256(
            abi.encode(
                keccak256(abi.encode(policy.tokens)),
                keccak256(abi.encode(policy.targets)),
                keccak256(abi.encode(policy.selectors)),
                keccak256(abi.encode(policy.rates))
            )
        );
        bytes32 regPayload = keccak256(abi.encode(agent, AGENT_ID, expiry, policyHash));
        bytes32 regChal = keccak256(
            abi.encode(
                guard.REGISTER_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                regPayload,
                0,
                block.timestamp + 1 hours
            )
        );
        guard.registerSessionWithPasskey(
            passkeyUser, agent, AGENT_ID, expiry, policy, 0, block.timestamp + 1 hours, buildWebAuthnAuth(regChal, true)
        );

        // Now revoke session via passkey
        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 revokePayload = keccak256(abi.encode(agent));
        bytes32 revokeChal = keccak256(
            abi.encode(
                guard.REVOKE_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                revokePayload,
                nonce,
                deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(revokeChal, true);

        vm.prank(relayer);
        vm.expectEmit(true, true, false, true);
        emit SessionRevoked(passkeyUser, agent);
        guard.revokeSessionWithPasskey(passkeyUser, agent, nonce, deadline, auth);

        assertFalse(guard.getSession(passkeyUser, agent).active);
    }

    // =========================================================================
    // EXECUTION ENGINE TESTS
    // =========================================================================

    function test_Execute_HappyPath() public {
        // Alice deposits 100 ether tokenA
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        // Alice registers policy: 50 ether daily, 20 ether perTrade
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        bytes32 decisionHash = keccak256("decision-1");

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: swapData,
            decisionHash: decisionHash
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit ActionExecuted(
            alice, agent, address(dex), address(tokenA), address(tokenB), 10 ether, 10 ether, decisionHash
        );
        bool success = guard.execute(params);

        assertTrue(success);
        assertEq(guard.balances(alice, address(tokenA)), 90 ether);
        assertEq(guard.balances(alice, address(tokenB)), 10 ether);
        assertEq(guard.getLimit(alice, agent, address(tokenA)).spentInWindow, 10 ether);

        // Verify tokenIn allowance to DEX was reset to 0
        assertEq(tokenA.allowance(address(guard), address(dex)), 0);
    }

    function test_Execute_PreCall_BadPair_SameTokenReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenA), // Same token
            minAmountOut: 10 ether,
            target: address(dex),
            data: hex"12345678",
            decisionHash: keccak256("bad-pair-1")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.BAD_PAIR, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_BadPair_TargetIsGuardReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(guard), // Target cannot be guard
            data: hex"12345678",
            decisionHash: keccak256("bad-pair-2")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.BAD_PAIR, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_BadPair_TargetIsTokenReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(tokenA), // Target is token
            data: hex"12345678",
            decisionHash: keccak256("bad-pair-3")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.BAD_PAIR, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_NoSessionReturnsFalse() public {
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: hex"12345678",
            decisionHash: keccak256("no-session")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.NO_SESSION, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_ExpiredSessionReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 hours), _defaultPolicy(50 ether, 20 ether));

        // Warp past expiration
        vm.warp(block.timestamp + 2 hours);

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether),
            decisionHash: keccak256("expired")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.EXPIRED, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_TargetNotAllowedReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        // Use a target that wasn't in Alice's policy
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(revertingDEX), // Vetted globally, but not allowed by Alice
            data: hex"12345678",
            decisionHash: keccak256("target-not-allowed")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.TARGET_NOT_ALLOWED, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_GloballyRevokedTargetReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        // Owner revokes dex globally
        vm.prank(owner);
        guard.setApprovedTarget(address(dex), false);

        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: hex"12345678",
            decisionHash: keccak256("globally-revoked")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.TARGET_NOT_ALLOWED, params.decisionHash);
        bool success = guard.execute(params);
        assertFalse(success);
    }

    function test_Execute_PreCall_ShortDataOrSelectorNotAllowedReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        // Short data < 4 bytes
        IAgentGuard.ExecuteParams memory paramsShort = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: hex"1234",
            decisionHash: keccak256("short-data")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.SELECTOR_NOT_ALLOWED, paramsShort.decisionHash);
        assertFalse(guard.execute(paramsShort));

        // Disallowed selector
        IAgentGuard.ExecuteParams memory paramsDisallowed = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: hex"9999999900000000",
            decisionHash: keccak256("disallowed-sel")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.SELECTOR_NOT_ALLOWED, paramsDisallowed.decisionHash);
        assertFalse(guard.execute(paramsDisallowed));
    }

    function test_Execute_PreCall_TokenNotAllowedReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        // tokenB has dailyLimit == 0 in Alice's policy
        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenB), 10 ether, address(tokenA), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenB), // Not configured in policy
            amountIn: 10 ether,
            tokenOut: address(tokenA),
            minAmountOut: 10 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("token-not-allowed")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.TOKEN_NOT_ALLOWED, params.decisionHash);
        assertFalse(guard.execute(params));
    }

    function test_Execute_PreCall_ExceedsPerTradeReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 10 ether));

        // Trade 11 ether when perTradeLimit is 10 ether
        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 11 ether, address(tokenB), 11 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 11 ether,
            tokenOut: address(tokenB),
            minAmountOut: 11 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("exceeds-per-trade")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.EXCEEDS_PER_TRADE, params.decisionHash);
        assertFalse(guard.execute(params));
    }

    function test_Execute_PreCall_DailyBudgetAndRollingWindowReset() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);
        // Daily: 30 ether, perTrade: 15 ether
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 5 days), _defaultPolicy(30 ether, 15 ether));

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 15 ether, address(tokenB), 15 ether);

        IAgentGuard.ExecuteParams memory p1 = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 15 ether,
            tokenOut: address(tokenB),
            minAmountOut: 15 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("trade-1")
        });

        // Trade 1: 15 ether -> spent = 15 ether
        vm.prank(agent);
        assertTrue(guard.execute(p1));
        assertEq(guard.getLimit(alice, agent, address(tokenA)).spentInWindow, 15 ether);

        // Trade 2: 15 ether -> spent = 30 ether
        p1.decisionHash = keccak256("trade-2");
        vm.prank(agent);
        assertTrue(guard.execute(p1));
        assertEq(guard.getLimit(alice, agent, address(tokenA)).spentInWindow, 30 ether);

        // Trade 3: 15 ether -> Exceeds daily (30 + 15 > 30) -> returns false
        p1.decisionHash = keccak256("trade-3");
        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.EXCEEDS_DAILY, p1.decisionHash);
        assertFalse(guard.execute(p1));

        // Warp 24 hours: window resets
        vm.warp(block.timestamp + 1 days);

        // Trade 4 after 24h: succeeds and resets spentInWindow to 15 ether
        p1.decisionHash = keccak256("trade-4");
        vm.prank(agent);
        assertTrue(guard.execute(p1));
        assertEq(guard.getLimit(alice, agent, address(tokenA)).spentInWindow, 15 ether);
    }

    function test_Execute_PreCall_InsufficientBalanceReturnsFalse() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 5 ether); // Only 5 ether deposited
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 20 ether));

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether, // Requests 10 ether > 5 ether balance
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("insufficient-balance")
        });

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit PolicyViolation(alice, agent, IAgentGuard.ReasonCode.INSUFFICIENT_BALANCE, params.decisionHash);
        assertFalse(guard.execute(params));
    }

    function test_Execute_PausedReverts() public {
        vm.prank(owner);
        guard.pause();

        IAgentGuard.ExecuteParams memory params;
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        guard.execute(params);
    }

    // =========================================================================
    // POST-CALL INVARIANTS & MALICIOUS VENUE TESTS
    // =========================================================================

    function test_Execute_EvilDEX_OverpullReverts() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 20 ether);
        policy.targets[0] = address(overpullDEX);
        policy.selectors[0].target = address(overpullDEX);

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(overpullDEX),
            data: swapData,
            decisionHash: keccak256("overpull")
        });

        // Overpull attempts to pull 11 ether when only 10 was authorized; call reverts inside transferFrom
        vm.prank(agent);
        vm.expectRevert(IAgentGuard.CallFailed.selector);
        guard.execute(params);
    }

    function test_Execute_EvilDEX_RevertingVenueRevertsCallFailed() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 20 ether);
        policy.targets[0] = address(revertingDEX);
        policy.selectors[0].target = address(revertingDEX);

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(revertingDEX),
            data: swapData,
            decisionHash: keccak256("reverting")
        });

        vm.prank(agent);
        vm.expectRevert(IAgentGuard.CallFailed.selector);
        guard.execute(params);
    }

    function test_Execute_EvilDEX_ShortDeliveryRevertsSlippageExceeded() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 20 ether);
        policy.targets[0] = address(shortDeliveryDEX);
        policy.selectors[0].target = address(shortDeliveryDEX);

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether, // Expects 10 ether, but shortDelivery delivers only 1 wei
            target: address(shortDeliveryDEX),
            data: swapData,
            decisionHash: keccak256("short-delivery")
        });

        vm.prank(agent);
        vm.expectRevert(IAgentGuard.SlippageExceeded.selector);
        guard.execute(params);
    }

    function test_Execute_EvilDEX_ReentrancyBlocked() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 20 ether);
        policy.targets[0] = address(reentrancyDEX);
        policy.selectors[0].target = address(reentrancyDEX);

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(reentrancyDEX),
            data: swapData,
            decisionHash: keccak256("reentrancy")
        });

        // reentrancyDEX calls back into guard.execute, which fails due to nonReentrant modifier
        vm.prank(agent);
        vm.expectRevert(IAgentGuard.CallFailed.selector);
        guard.execute(params);
    }

    function test_Execute_BelowUserRateFloorReverts() public {
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 20 ether);
        // Set minimum exchange rate to 2:1 (2e18: 2 units of B for 1 unit of A)
        policy.rates[0].minRate = 2e18;

        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), policy);

        // DEX only gives 1:1 (10 ether tokenB for 10 ether tokenA), which is below 2:1 floor
        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 10 ether, address(tokenB), 10 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 10 ether,
            tokenOut: address(tokenB),
            minAmountOut: 10 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("below-rate-floor")
        });

        vm.prank(agent);
        vm.expectRevert(IAgentGuard.BelowUserRateFloor.selector);
        guard.execute(params);
    }

    function test_Execute_CrossUserVaultIsolation() public {
        // Alice deposits 10 ether, Bob deposits 100 ether
        vm.prank(alice);
        guard.deposit(address(tokenA), 10 ether);
        vm.prank(bob);
        guard.deposit(address(tokenA), 100 ether);

        // Bob authorizes agent with 100 ether limit
        vm.prank(bob);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(100 ether, 50 ether));

        // Alice authorizes agent with only 10 ether limit
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(10 ether, 10 ether));

        // Agent attempts to trade 20 ether on Alice's account using Bob's funds
        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 20 ether, address(tokenB), 20 ether);
        IAgentGuard.ExecuteParams memory paramsAlice = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 20 ether,
            tokenOut: address(tokenB),
            minAmountOut: 20 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("alice-trade")
        });

        vm.prank(agent);
        // Blocked because Alice's per-trade limit is 10 and her balance is 10
        assertFalse(guard.execute(paramsAlice));

        // Bob's tokens remain untouched
        assertEq(guard.balances(bob, address(tokenA)), 100 ether);
        assertEq(guard.balances(alice, address(tokenA)), 10 ether);
    }

    // =========================================================================
    // ADMIN FUNCTIONS TESTS
    // =========================================================================

    function test_SetApprovedTarget_HappyPath() public {
        address newTarget = address(0x555);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit TargetApprovalUpdated(newTarget, true);
        guard.setApprovedTarget(newTarget, true);

        assertTrue(guard.approvedTargets(newTarget));
    }

    function test_SetApprovedTarget_ZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.setApprovedTarget(address(0), true);
    }

    function test_SetApprovedTarget_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        guard.setApprovedTarget(address(0x123), true);
    }

    function test_SetRegistry_HappyPath() public {
        address newReg = address(0x666);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit RegistryUpdated(newReg);
        guard.setRegistry(newReg);

        assertEq(address(guard.registry()), newReg);
    }

    function test_SetRegistry_ZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(IAgentGuard.ZeroAddress.selector);
        guard.setRegistry(address(0));
    }

    function test_SetRegistry_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        guard.setRegistry(address(0x123));
    }

    function test_PauseAndUnpause_HappyPath() public {
        vm.prank(owner);
        guard.pause();
        assertTrue(guard.paused());

        vm.prank(owner);
        guard.unpause();
        assertFalse(guard.paused());
    }

    function test_Pause_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        guard.pause();
    }

    // =========================================================================
    // VIEW FUNCTIONS TESTS
    // =========================================================================

    function test_WindowRemaining_Logic() public {
        // Token not configured
        (uint128 remaining, uint64 secondsUntil) = guard.windowRemaining(alice, agent, address(tokenA));
        assertEq(remaining, 0);
        assertEq(secondsUntil, 0);

        // Configure session: daily 50 ether
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 2 days), _defaultPolicy(50 ether, 20 ether));

        (remaining, secondsUntil) = guard.windowRemaining(alice, agent, address(tokenA));
        assertEq(remaining, 50 ether);
        assertEq(secondsUntil, 1 days);

        // Deposit & spend 20 ether
        vm.prank(alice);
        guard.deposit(address(tokenA), 100 ether);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 20 ether, address(tokenB), 20 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 20 ether,
            tokenOut: address(tokenB),
            minAmountOut: 20 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("trade-rem")
        });
        vm.prank(agent);
        guard.execute(params);

        (remaining, secondsUntil) = guard.windowRemaining(alice, agent, address(tokenA));
        assertEq(remaining, 30 ether);
        assertEq(secondsUntil, 1 days);

        // Warp past 24h
        vm.warp(block.timestamp + 1 days + 1);
        (remaining, secondsUntil) = guard.windowRemaining(alice, agent, address(tokenA));
        assertEq(remaining, 50 ether);
        assertEq(secondsUntil, 0);
    }

    // =========================================================================
    // FUZZ & INVARIANT TESTS
    // =========================================================================

    function testFuzz_DepositAndWithdraw(uint96 amount) public {
        vm.assume(amount > 0 && amount < 500_000 ether);
        tokenA.mint(alice, amount);

        vm.startPrank(alice);
        tokenA.approve(address(guard), amount);
        uint256 received = guard.deposit(address(tokenA), amount);
        assertEq(received, amount);
        assertEq(guard.balances(alice, address(tokenA)), amount);

        guard.withdraw(address(tokenA), amount, alice);
        assertEq(guard.balances(alice, address(tokenA)), 0);
        vm.stopPrank();
    }

    function testFuzz_TradeAmountsInsideLimits(uint64 amountIn) public {
        vm.assume(amountIn > 1_000 && amountIn <= 10 ether);

        vm.startPrank(alice);
        guard.deposit(address(tokenA), 100 ether);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 1 days), _defaultPolicy(50 ether, 10 ether));
        vm.stopPrank();

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), amountIn, address(tokenB), amountIn);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: amountIn,
            tokenOut: address(tokenB),
            minAmountOut: amountIn,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("fuzz-trade")
        });

        vm.prank(agent);
        assertTrue(guard.execute(params));
        assertEq(guard.balances(alice, address(tokenA)), 100 ether - amountIn);
        assertEq(guard.balances(alice, address(tokenB)), amountIn);
    }

    function testFuzz_RollingWindowBudgetNeverExceeded(uint32 warpStep, uint64 tradeAmount) public {
        vm.assume(tradeAmount > 0 && tradeAmount <= 5 ether);

        vm.startPrank(alice);
        guard.deposit(address(tokenA), 100 ether);
        // daily: 10 ether, perTrade: 5 ether
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 20 days), _defaultPolicy(10 ether, 5 ether));
        vm.stopPrank();

        vm.warp(block.timestamp + warpStep);

        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), tradeAmount, address(tokenB), tradeAmount);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: tradeAmount,
            tokenOut: address(tokenB),
            minAmountOut: tradeAmount,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("fuzz-budget")
        });

        vm.prank(agent);
        bool success = guard.execute(params);
        if (success) {
            IAgentGuard.TokenLimit memory lim = guard.getLimit(alice, agent, address(tokenA));
            assertTrue(lim.spentInWindow <= lim.dailyLimit);
        }
    }

    // =========================================================================
    // ADDITIONAL BRANCH & EDGE CASE TESTS
    // =========================================================================

    function test_CurveConstantsSanity() public {
        assertEq(guard.SECP256R1_N(), 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551);
        assertEq(guard.SECP256R1_N_DIV_2(), guard.SECP256R1_N() >> 1);
    }

    function test_WithdrawWithPasskey_RExceedsCurveOrderReverts() public {
        vm.prank(alice);
        guard.depositFor(passkeyUser, address(tokenA), 100 ether);

        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(address(tokenA), 10 ether, alice));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.WITHDRAW_TYPEHASH(), block.chainid, address(guard), passkeyUser, payloadHash, nonce, deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);
        auth.r = bytes32(guard.SECP256R1_N()); // r >= N

        vm.expectRevert(IAgentGuard.InvalidSignatureR.selector);
        guard.withdrawWithPasskey(passkeyUser, address(tokenA), 10 ether, alice, nonce, deadline, auth);
    }

    function test_RegisterSessionWithPasskey_DeadlineExpiredReverts() public {
        uint64 expiry = uint64(block.timestamp + 5 days);
        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 10 ether);
        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 expiredDeadline = block.timestamp - 1;

        bytes32 policyHash = keccak256(
            abi.encode(
                keccak256(abi.encode(policy.tokens)),
                keccak256(abi.encode(policy.targets)),
                keccak256(abi.encode(policy.selectors)),
                keccak256(abi.encode(policy.rates))
            )
        );
        bytes32 payloadHash = keccak256(abi.encode(agent, AGENT_ID, expiry, policyHash));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.REGISTER_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                payloadHash,
                nonce,
                expiredDeadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.DeadlineExpired.selector);
        guard.registerSessionWithPasskey(passkeyUser, agent, AGENT_ID, expiry, policy, nonce, expiredDeadline, auth);
    }

    function test_RegisterSessionWithPasskey_InvalidNonceReverts() public {
        uint64 expiry = uint64(block.timestamp + 5 days);
        IAgentGuard.Policy memory policy = _defaultPolicy(50 ether, 10 ether);
        uint256 wrongNonce = 777;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 policyHash = keccak256(
            abi.encode(
                keccak256(abi.encode(policy.tokens)),
                keccak256(abi.encode(policy.targets)),
                keccak256(abi.encode(policy.selectors)),
                keccak256(abi.encode(policy.rates))
            )
        );
        bytes32 payloadHash = keccak256(abi.encode(agent, AGENT_ID, expiry, policyHash));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.REGISTER_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                payloadHash,
                wrongNonce,
                deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.InvalidNonce.selector);
        guard.registerSessionWithPasskey(passkeyUser, agent, AGENT_ID, expiry, policy, wrongNonce, deadline, auth);
    }

    function test_RevokeSessionWithPasskey_DeadlineExpiredReverts() public {
        uint256 nonce = guard.nextNonce(passkeyUser);
        uint256 expiredDeadline = block.timestamp - 1;
        bytes32 payloadHash = keccak256(abi.encode(agent));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.REVOKE_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                payloadHash,
                nonce,
                expiredDeadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.DeadlineExpired.selector);
        guard.revokeSessionWithPasskey(passkeyUser, agent, nonce, expiredDeadline, auth);
    }

    function test_RevokeSessionWithPasskey_InvalidNonceReverts() public {
        uint256 wrongNonce = 888;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 payloadHash = keccak256(abi.encode(agent));
        bytes32 challenge = keccak256(
            abi.encode(
                guard.REVOKE_SESSION_TYPEHASH(),
                block.chainid,
                address(guard),
                passkeyUser,
                payloadHash,
                wrongNonce,
                deadline
            )
        );
        WebAuthn.WebAuthnAuth memory auth = buildWebAuthnAuth(challenge, true);

        vm.expectRevert(IAgentGuard.InvalidNonce.selector);
        guard.revokeSessionWithPasskey(passkeyUser, agent, wrongNonce, deadline, auth);
    }

    function test_WindowRemaining_ExhaustedBudgetZero() public {
        // Daily: 20 ether, perTrade: 20 ether
        vm.prank(alice);
        guard.registerSession(agent, AGENT_ID, uint64(block.timestamp + 2 days), _defaultPolicy(20 ether, 20 ether));
        vm.prank(alice);
        guard.deposit(address(tokenA), 50 ether);

        // Execute trade for full 20 ether
        bytes memory swapData =
            abi.encodeWithSelector(SWAP_SELECTOR, address(tokenA), 20 ether, address(tokenB), 20 ether);
        IAgentGuard.ExecuteParams memory params = IAgentGuard.ExecuteParams({
            user: alice,
            tokenIn: address(tokenA),
            amountIn: 20 ether,
            tokenOut: address(tokenB),
            minAmountOut: 20 ether,
            target: address(dex),
            data: swapData,
            decisionHash: keccak256("exhaust-budget")
        });
        vm.prank(agent);
        guard.execute(params);

        // Window remaining budget should now be exactly 0
        (uint128 remaining, uint64 secondsUntil) = guard.windowRemaining(alice, agent, address(tokenA));
        assertEq(remaining, 0);
        assertEq(secondsUntil, 1 days);
    }
}
