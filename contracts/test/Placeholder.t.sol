// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Placeholder} from "../src/Placeholder.sol";

contract PlaceholderTest is Test {
    Placeholder public placeholder;

    function setUp() public {
        placeholder = new Placeholder();
    }

    function test_ChainId() public {
        assertEq(placeholder.getChainId(), 10143);
    }

    function test_Name() public {
        assertEq(placeholder.NAME(), "Aegis-Monad");
    }
}
