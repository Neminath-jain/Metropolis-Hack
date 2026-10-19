// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Base64} from "solady/utils/Base64.sol";
import {WebAuthn} from "solady/utils/WebAuthn.sol";

contract WebAuthnHelper {
    uint256 internal constant TEST_PRIV_KEY = 1;
    uint256 internal constant TEST_QX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296;
    uint256 internal constant TEST_QY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5;

    function buildWebAuthnAuth(bytes32 challenge, bool userVerification)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        // Encode challenge as Base64URL without padding
        string memory encodedChallenge = Base64.encode(abi.encodePacked(challenge), true, true);

        // Construct clientDataJSON
        // Index 0: '{'
        // Index 1: '"type":"webauthn.get"' (length 21)
        // Index 22: ','
        // Index 23: '"challenge":"' (length 13)
        // Index 36..78: encodedChallenge (length 43)
        // Index 79: '"'
        // Index 80: ',"origin":"http://localhost:3000"}'
        string memory clientDataJSON = string(
            abi.encodePacked(
                '{"type":"webauthn.get","challenge":"', encodedChallenge, '","origin":"http://localhost:3000"}'
            )
        );

        // Authenticator Data: 37 bytes
        // 32 bytes rpIdHash + 1 byte flags + 4 bytes counter
        bytes32 rpIdHash = keccak256("localhost");
        bytes1 flags = userVerification ? bytes1(0x05) : bytes1(0x01); // 0x05 = UP (bit 0) | UV (bit 2)
        bytes4 signCount = bytes4(0x00000001);
        bytes memory authenticatorData = abi.encodePacked(rpIdHash, flags, signCount);

        // Low-s valid coordinates accepted by MockP256Precompile for TEST_QX, TEST_QY
        bytes32 r = bytes32(uint256(1));
        bytes32 s = bytes32(uint256(1));

        auth = WebAuthn.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: 23,
            typeIndex: 1,
            r: r,
            s: s
        });
    }
}
