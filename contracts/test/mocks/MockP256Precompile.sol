// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MockP256Precompile
/// @notice Mock for Monad's 0x0100 P256 (EIP-7951) precompile for local Foundry testing
contract MockP256Precompile {
    uint256 public constant SECP256R1_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 public constant SECP256R1_N_DIV_2 = SECP256R1_N >> 1;

    // Test public key coordinates for the primary test passkey (privKey = 1, generator G)
    uint256 public constant TEST_QX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 public constant TEST_QY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;

    // Known Wycheproof test vector
    bytes32 public constant WYCHEPROOF_HASH = 0x532eaabd9574880dbf76b9b8cc00832c20a6ec113d682299550d7a6e0f345e25;
    bytes32 public constant WYCHEPROOF_R = bytes32(uint256(5));
    bytes32 public constant WYCHEPROOF_S = bytes32(uint256(1));
    bytes32 public constant WYCHEPROOF_QX = 0x4a03ef9f92eb268cafa601072489a56380fa0dc43171d7712813b3a19a1eb5e5;
    bytes32 public constant WYCHEPROOF_QY = 0x3e213e28a608ce9a2f4a17fd830c6654018a79b3e0263d91a8ba90622df6f2f0;

    // Mapping of explicitly registered valid (hash, r, s, qx, qy) tuples
    mapping(bytes32 => bool) public validSignatures;

    // Blacklisted hashes to simulate tampered signatures
    mapping(bytes32 => bool) public blacklisted;

    function setValidSignature(bytes32 hash, bytes32 r, bytes32 s, bytes32 qx, bytes32 qy, bool valid) external {
        validSignatures[keccak256(abi.encode(hash, r, s, qx, qy))] = valid;
    }

    function setBlacklisted(bytes32 hash, bool isBlacklisted) external {
        blacklisted[hash] = isBlacklisted;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        if (data.length != 160) {
            return "";
        }

        bytes32 hash = bytes32(data[0:32]);
        bytes32 r = bytes32(data[32:64]);
        bytes32 s = bytes32(data[64:96]);
        bytes32 qx = bytes32(data[96:128]);
        bytes32 qy = bytes32(data[128:160]);

        // Reject zero or high-s (malleable) signatures
        if (uint256(s) == 0 || uint256(s) > SECP256R1_N_DIV_2) {
            return "";
        }
        if (uint256(r) == 0 || uint256(r) >= SECP256R1_N) {
            return "";
        }
        if (blacklisted[hash]) {
            return "";
        }

        // Check if explicitly registered as valid
        if (validSignatures[keccak256(abi.encode(hash, r, s, qx, qy))]) {
            return abi.encode(uint256(1));
        }

        // Check against Wycheproof test vector
        if (
            hash == WYCHEPROOF_HASH && r == WYCHEPROOF_R && s == WYCHEPROOF_S && qx == WYCHEPROOF_QX
                && qy == WYCHEPROOF_QY
        ) {
            return abi.encode(uint256(1));
        }

        // Default: If public key matches test key G and r, s are non-zero valid low-s, accept
        if (uint256(qx) == TEST_QX && uint256(qy) == TEST_QY && uint256(r) > 0) {
            return abi.encode(uint256(1));
        }

        return "";
    }
}
