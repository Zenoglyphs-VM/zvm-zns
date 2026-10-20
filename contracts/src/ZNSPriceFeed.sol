// SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorInterface} from "@ensdomains/ens-contracts/contracts/ethregistrar/StablePriceOracle.sol";

/// @title ZNSPriceFeed
/// @notice The rate ENS's StablePriceOracle converts rent with, set by an
/// owner instead of read from Chainlink.
///
/// StablePriceOracle prices a name in "attoUSD" and converts to the chain's
/// coin with `amount * 1e8 / latestAnswer()`, the shape of Chainlink's
/// 8-decimal ETH/USD feed. The ZVM has no such feed, so this answers in its
/// place. At the deployed answer of 1e8 the oracle's unit *is* the ZNN wei:
/// the rent table reads directly in ZNN. Moving the answer rescales every
/// tier and the premium together; halving it doubles every price. Changing
/// the ratio between tiers needs a new oracle and a new controller, because
/// both hold their oracle as an immutable.
///
/// ENS ships a DummyOracle of this shape for tests, whose `set` anyone may
/// call. This one answers to an owner, and says so in an event, so a price
/// change is on the record.
contract ZNSPriceFeed is Ownable, AggregatorInterface {
    int256 public override latestAnswer;

    /// Chainlink's event for a new answer, so tooling that watches feeds reads
    /// this one too.
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error AnswerNotPositive();

    constructor(int256 answer) {
        set(answer);
    }

    function set(int256 answer) public onlyOwner {
        // Zero would divide by zero inside the oracle, and a negative answer
        // would cast to an enormous uint: either one makes every name
        // unregistrable.
        if (answer <= 0) revert AnswerNotPositive();
        latestAnswer = answer;
        emit AnswerUpdated(answer, 0, block.timestamp);
    }
}
