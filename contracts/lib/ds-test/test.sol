// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

contract DSTest {
    event log(string);
    event logs(bytes);
    event log_address(address);
    event log_bytes32(bytes32);
    event log_int(int);
    event log_uint(uint);
    event log_bytes(bytes);
    event log_string(string);

    event log_named_address(string key, address val);
    event log_named_bytes32(string key, bytes32 val);
    event log_named_decimal_int(string key, int val, uint decimals);
    event log_named_decimal_uint(string key, uint val, uint decimals);
    event log_named_int(string key, int val);
    event log_named_uint(string key, uint val);
    event log_named_bytes(string key, bytes val);
    event log_named_string(string key, string val);

    bool public IS_TEST = true;

    function failed() public view virtual returns (bool) {
        return false;
    }

    function fail() internal virtual {
        revert("ds-test-failed");
    }

    function assertTrue(bool data) internal virtual {
        if (!data) {
            fail();
        }
    }

    function assertTrue(bool data, string memory err) internal virtual {
        if (!data) {
            revert(err);
        }
    }

    function assertEq0(bytes memory a, bytes memory b) internal virtual {
        if (keccak256(a) != keccak256(b)) {
            fail();
        }
    }

    function assertEq0(bytes memory a, bytes memory b, string memory err) internal virtual {
        if (keccak256(a) != keccak256(b)) {
            revert(err);
        }
    }

    function assertEq(string memory a, string memory b) internal virtual {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            fail();
        }
    }

    function assertEq(string memory a, string memory b, string memory err) internal virtual {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            revert(err);
        }
    }

    function assertEq(address a, address b) internal virtual {
        if (a != b) {
            fail();
        }
    }

    function assertEq(address a, address b, string memory err) internal virtual {
        if (a != b) {
            revert(err);
        }
    }

    function assertEq(bytes32 a, bytes32 b) internal virtual {
        if (a != b) {
            fail();
        }
    }

    function assertEq(bytes32 a, bytes32 b, string memory err) internal virtual {
        if (a != b) {
            revert(err);
        }
    }

    function assertEq(int a, int b) internal virtual {
        if (a != b) {
            fail();
        }
    }

    function assertEq(int a, int b, string memory err) internal virtual {
        if (a != b) {
            revert(err);
        }
    }

    function assertEq(uint a, uint b) internal virtual {
        if (a != b) {
            fail();
        }
    }

    function assertEq(uint a, uint b, string memory err) internal virtual {
        if (a != b) {
            revert(err);
        }
    }
}
