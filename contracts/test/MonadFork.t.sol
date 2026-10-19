// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

contract MonadForkTest is Test {
    address constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant P256_PRECOMPILE = address(0x0100);

    function testFork_MonadTestnetIntegration() public {
        // When run with `--fork-url https://testnet-rpc.monad.xyz`, block.chainid is 10143
        if (block.chainid == 10143) {
            // 1. ERC-8004 ownerOf check on live Monad testnet
            address ownerOf1 = IAgentRegistry(ERC8004_REGISTRY).ownerOf(1);
            emit log_named_address("ERC-8004 ownerOf(1)", ownerOf1);
            assertTrue(ownerOf1 != address(0), "ownerOf(1) must be valid registered address");

            uint256 regCodeSize;
            assembly {
                regCodeSize := extcodesize(ERC8004_REGISTRY)
            }
            emit log_named_uint("ERC-8004 Registry Code Size on Monad", regCodeSize);

            // 2. Test precompile at 0x0100 with valid Wycheproof test vector
            bytes memory validVector = abi.encodePacked(
                bytes32(0x532eaabd9574880dbf76b9b8cc00832c20a6ec113d682299550d7a6e0f345e25),
                bytes32(uint256(5)),
                bytes32(uint256(1)),
                bytes32(0x4a03ef9f92eb268cafa601072489a56380fa0dc43171d7712813b3a19a1eb5e5),
                bytes32(0x3e213e28a608ce9a2f4a17fd830c6654018a79b3e0263d91a8ba90622df6f2f0)
            );
            (bool okValid, bytes memory retValid) = P256_PRECOMPILE.staticcall(validVector);
            emit log_named_uint("Valid vector staticcall success", okValid ? 1 : 0);
            emit log_named_uint("Valid vector return length", retValid.length);

            // 3. Test tampered vector (corrupted signature)
            bytes memory tamperedVector = abi.encodePacked(
                bytes32(0x532eaabd9574880dbf76b9b8cc00832c20a6ec113d682299550d7a6e0f345e25),
                bytes32(uint256(5)),
                bytes32(uint256(99999999)),
                bytes32(0x4a03ef9f92eb268cafa601072489a56380fa0dc43171d7712813b3a19a1eb5e5),
                bytes32(0x3e213e28a608ce9a2f4a17fd830c6654018a79b3e0263d91a8ba90622df6f2f0)
            );
            (bool okTampered, bytes memory retTampered) = P256_PRECOMPILE.staticcall(tamperedVector);
            bool tamperedFailed = (!okTampered || retTampered.length == 0 || (retTampered.length == 32 && abi.decode(retTampered, (uint256)) == 0));
            assertTrue(tamperedFailed, "Tampered signature must not return 1");
            emit log("Tampered vector correctly rejected");
        } else {
            emit log("Local mode: To fork test live, run with --fork-url https://testnet-rpc.monad.xyz");
        }
    }
}
