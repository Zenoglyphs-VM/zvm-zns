// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract NativeReceiver {
    bool public reject = true;

    function setReject(bool value) external { reject = value; }

    function forward(address to, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = to.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }

    receive() external payable { require(!reject, "Fixture: rejected"); }
}

// Paris-only fixture for native value which bypasses the controller's fallback.
contract ForceNative {
    constructor() payable {}
    function force(address payable to) external { selfdestruct(to); }
}
