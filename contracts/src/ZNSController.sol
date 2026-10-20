//SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

// A fork of ENS's ETHRegistrarController (ens-contracts 1.7.0,
// vendor/ens-contracts/contracts/ethregistrar/ETHRegistrarController.sol).
// Commit-reveal, pricing through the oracle, resolver setup and reverse
// records are ENS's code as it was. Every change is marked `ZNS:` and is one
// of these:
//
// - the TLD is .znn, not .eth;
// - a label is 3 to 63 characters of a-z, 0-9 and "-", checked here rather
//   than left to clients (see `valid`);
// - short names carry a launch premium: ENS's decaying premium, started at
//   launch instead of at an expiry (see `_rentPrice`);
// - the label is recorded in the registrar on every registration and
//   renewal, so the token can name itself (see ZNSRegistrar);
// - ENS's second reverse record, default.reverse, is left out: it is for a
//   name shared across many chains, and a .znn name lives on one;
// - rent is burned as it is paid, to the ZVM's burn address, instead of
//   collecting for the owner to withdraw (see `BURN`).

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {StringUtils} from "@ensdomains/ens-contracts/contracts/utils/StringUtils.sol";
import {Resolver} from "@ensdomains/ens-contracts/contracts/resolvers/Resolver.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {IReverseRegistrar} from "@ensdomains/ens-contracts/contracts/reverseRegistrar/IReverseRegistrar.sol";
import {IETHRegistrarController, IPriceOracle} from "@ensdomains/ens-contracts/contracts/ethregistrar/IETHRegistrarController.sol";
import {ERC20Recoverable} from "@ensdomains/ens-contracts/contracts/utils/ERC20Recoverable.sol";

import {ZNSRegistrar} from "./ZNSRegistrar.sol";

/// @dev A registrar controller for registering and renewing .znn names at
/// the oracle's price.
contract ZNSController is Ownable, IETHRegistrarController, ERC165, ERC20Recoverable {
    using StringUtils for *;

    /// @notice The bitmask for the reverse record (addr.reverse).
    uint8 constant REVERSE_RECORD_ETHEREUM_BIT = 1;

    /// @notice The minimum duration for a registration.
    uint256 public constant MIN_REGISTRATION_DURATION = 28 days;

    // ZNS: namehash("znn").
    bytes32 public constant ZNN_NODE = 0x6be5efe3a46d2356cb7ec1033d96cb4f426a49b9805d060359fade58800cf633;

    // ZNS: where rent goes. The ZVM's burn address, the one its fee split
    // already burns relayed tips to (zvm-docs spec/SPEC.md, "The relayed fee
    // split"), so the chain's own burn accounting counts ZNS's too. Rent is
    // sent there in the same transaction that pays it: the controller never
    // holds a balance, and there is nothing for an owner to withdraw.
    address payable public constant BURN = payable(0x000000000000000000000000000000000000dEaD);

    // ZNS: the registrar's grace period, repeated because ENS's oracle and
    // registrar each hard-code it too.
    uint256 constant GRACE_PERIOD = 90 days;

    /// @notice The ENS registry.
    ENS public immutable ens;

    // ZNS: typed as the .znn registrar, which records labels.
    ZNSRegistrar immutable base;

    /// @notice The minimum time a commitment must exist to be valid.
    uint256 public immutable minCommitmentAge;

    /// @notice The maximum time a commitment can exist to be valid.
    uint256 public immutable maxCommitmentAge;

    /// @notice The registrar for addr.reverse.
    IReverseRegistrar public immutable reverseRegistrar;

    /// @notice The price oracle for the znn TLD.
    IPriceOracle public immutable prices;

    // ZNS: when names first opened. A name that has never been registered and
    // is at most `launchMaxLength` characters is priced as if it had expired
    // out of its grace period at this moment, so it goes through the same
    // falling-price auction an expired name does.
    uint256 public immutable launchTime;
    uint256 public immutable launchMaxLength;

    /// @notice A mapping of commitments to their timestamp.
    mapping(bytes32 => uint256) public commitments;

    error CommitmentNotFound(bytes32 commitment);
    error CommitmentTooNew(bytes32 commitment, uint256 minimumCommitmentTimestamp, uint256 currentTimestamp);
    error CommitmentTooOld(bytes32 commitment, uint256 maximumCommitmentTimestamp, uint256 currentTimestamp);
    error NameNotAvailable(string name);
    error DurationTooShort(uint256 duration);
    error ResolverRequiredWhenDataSupplied();
    error ResolverRequiredForReverseRecord();
    error UnexpiredCommitmentExists(bytes32 commitment);
    error InsufficientValue();
    error MaxCommitmentAgeTooLow();
    error MaxCommitmentAgeTooHigh();
    // ZNS: a reverse-record bit this controller does not set.
    error UnsupportedReverseRecord(uint8 reverseRecord);

    event NameRegistered(
        string label,
        bytes32 indexed labelhash,
        address indexed owner,
        uint256 baseCost,
        uint256 premium,
        uint256 expires,
        bytes32 referrer
    );

    event NameRenewed(string label, bytes32 indexed labelhash, uint256 cost, uint256 expires, bytes32 referrer);

    constructor(
        ZNSRegistrar _base,
        IPriceOracle _prices,
        uint256 _minCommitmentAge,
        uint256 _maxCommitmentAge,
        IReverseRegistrar _reverseRegistrar,
        ENS _ens,
        uint256 _launchMaxLength
    ) {
        if (_maxCommitmentAge <= _minCommitmentAge) revert MaxCommitmentAgeTooLow();

        if (_maxCommitmentAge > block.timestamp) revert MaxCommitmentAgeTooHigh();

        ens = _ens;
        base = _base;
        prices = _prices;
        minCommitmentAge = _minCommitmentAge;
        maxCommitmentAge = _maxCommitmentAge;
        reverseRegistrar = _reverseRegistrar;
        launchTime = block.timestamp;
        launchMaxLength = _launchMaxLength;
    }

    function rentPrice(string calldata label, uint256 duration)
        public
        view
        override
        returns (IPriceOracle.Price memory price)
    {
        bytes32 labelhash = keccak256(bytes(label));
        price = _rentPrice(label, labelhash, duration);
    }

    /// @notice Returns true if the label may be registered.
    ///
    /// ZNS: ENS accepts any string of three or more characters and leaves
    /// normalisation (ENSIP-15) to clients. A name no client normalises to
    /// itself can be registered and never resolved, and a look-alike
    /// ("аlice" with a Cyrillic а) can be registered beside the real one.
    /// Checking here closes both: every name this accepts is already in
    /// normal form, so it resolves in viem, in the ZNS page and in any
    /// ENS-aware tool unchanged. The price is that there are no emoji or
    /// non-Latin names.
    ///
    /// The rule: 3 to 63 characters (DNS's label limit) of a-z, 0-9 and "-",
    /// not starting or ending with "-", and no "--" in the third and fourth
    /// places, which ENSIP-15 reserves.
    function valid(string calldata label) public pure returns (bool) {
        bytes memory b = bytes(label);
        if (b.length < 3 || b.length > 63) return false;
        if (b[0] == "-" || b[b.length - 1] == "-") return false;
        if (b.length >= 4 && b[2] == "-" && b[3] == "-") return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) return false;
        }
        return true;
    }

    function available(string calldata label) public view override returns (bool) {
        bytes32 labelhash = keccak256(bytes(label));
        return _available(label, labelhash);
    }

    function makeCommitment(Registration calldata registration) public pure override returns (bytes32 commitment) {
        if (registration.data.length > 0 && registration.resolver == address(0)) {
            revert ResolverRequiredWhenDataSupplied();
        }

        if (registration.reverseRecord != 0 && registration.resolver == address(0)) {
            revert ResolverRequiredForReverseRecord();
        }

        // ZNS: only the addr.reverse bit exists here.
        if (registration.reverseRecord & ~REVERSE_RECORD_ETHEREUM_BIT != 0) {
            revert UnsupportedReverseRecord(registration.reverseRecord);
        }

        if (registration.duration < MIN_REGISTRATION_DURATION) revert DurationTooShort(registration.duration);

        return keccak256(abi.encode(registration));
    }

    function commit(bytes32 commitment) public override {
        if (commitments[commitment] + maxCommitmentAge >= block.timestamp) {
            revert UnexpiredCommitmentExists(commitment);
        }
        commitments[commitment] = block.timestamp;
    }

    function register(Registration calldata registration) public payable override {
        bytes32 labelhash = keccak256(bytes(registration.label));
        IPriceOracle.Price memory price = _rentPrice(registration.label, labelhash, registration.duration);
        uint256 totalPrice = price.base + price.premium;
        if (msg.value < totalPrice) revert InsufficientValue();

        if (!_available(registration.label, labelhash)) revert NameNotAvailable(registration.label);

        bytes32 commitment = makeCommitment(registration);
        uint256 commitmentTimestamp = commitments[commitment];

        // Require an old enough commitment.
        if (commitmentTimestamp + minCommitmentAge > block.timestamp) {
            revert CommitmentTooNew(commitment, commitmentTimestamp + minCommitmentAge, block.timestamp);
        }

        // If the commitment is too old, or the name is registered, stop
        if (commitmentTimestamp + maxCommitmentAge <= block.timestamp) {
            if (commitmentTimestamp == 0) revert CommitmentNotFound(commitment);
            revert CommitmentTooOld(commitment, commitmentTimestamp + maxCommitmentAge, block.timestamp);
        }

        delete (commitments[commitment]);

        uint256 expires;

        if (registration.resolver == address(0)) {
            expires = base.register(uint256(labelhash), registration.owner, registration.duration);
            // ZNS: the token names itself from here on.
            base.recordLabel(registration.label);
        } else {
            expires = base.register(uint256(labelhash), address(this), registration.duration);
            // ZNS: as above; before the transfer, so the token already has
            // its name when it reaches its owner.
            base.recordLabel(registration.label);

            bytes32 namehash = keccak256(abi.encodePacked(ZNN_NODE, labelhash));
            ens.setRecord(namehash, registration.owner, registration.resolver, 0);
            if (registration.data.length > 0) {
                Resolver(registration.resolver).multicallWithNodeCheck(namehash, registration.data);
            }

            base.transferFrom(address(this), registration.owner, uint256(labelhash));

            if (registration.reverseRecord & REVERSE_RECORD_ETHEREUM_BIT != 0) {
                reverseRegistrar.setNameForAddr(
                    msg.sender, msg.sender, registration.resolver, string.concat(registration.label, ".znn")
                );
            }
        }

        emit NameRegistered(
            registration.label, labelhash, registration.owner, price.base, price.premium, expires, registration.referrer
        );

        // ZNS: burned, not held.
        BURN.transfer(totalPrice);
        if (msg.value > totalPrice) payable(msg.sender).transfer(msg.value - totalPrice);
    }

    function renew(string calldata label, uint256 duration, bytes32 referrer) external payable override {
        bytes32 labelhash = keccak256(bytes(label));

        IPriceOracle.Price memory price = _rentPrice(label, labelhash, duration);
        if (msg.value < price.base) revert InsufficientValue();

        uint256 expires = base.renew(uint256(labelhash), duration);
        // ZNS: the card shows the expiry, so its metadata changed.
        base.recordLabel(label);

        emit NameRenewed(label, labelhash, price.base, expires, referrer);

        // ZNS: burned, not held.
        BURN.transfer(price.base);
        if (msg.value > price.base) payable(msg.sender).transfer(msg.value - price.base);
    }

    /// @notice Burns anything the contract holds. ZNS: ENS's `withdraw` sent
    /// the balance to the owner; rent is burned as it is paid here, so the
    /// only balance there can be is ZNN forced in some other way, and it goes
    /// the same way.
    function withdraw() public {
        BURN.transfer(address(this).balance);
    }

    function supportsInterface(bytes4 interfaceID) public view override returns (bool) {
        return interfaceID == type(IETHRegistrarController).interfaceId || super.supportsInterface(interfaceID);
    }

    /* Internal functions */

    function _rentPrice(string calldata label, bytes32 labelhash, uint256 duration)
        internal
        view
        returns (IPriceOracle.Price memory price)
    {
        uint256 expires = base.nameExpires(uint256(labelhash));
        // ZNS: the launch premium. ENS's oracle starts its premium when a
        // name leaves its grace period, `expires + 90 days`; a name that was
        // never registered has expires 0 and so no premium at all. Pricing a
        // never-registered short name as if it had expired at launch starts
        // the same auction for it on launch day, and lets it fall to the base
        // rent over the oracle's schedule.
        if (expires == 0 && label.strlen() <= launchMaxLength) {
            expires = launchTime - GRACE_PERIOD;
        }
        price = prices.price(label, expires, duration);
    }

    function _available(string calldata label, bytes32 labelhash) internal view returns (bool) {
        return valid(label) && base.available(uint256(labelhash));
    }
}
