// SPDX-License-Identifier: MIT
pragma solidity ~0.8.17;

import {BaseRegistrarImplementation} from "@ensdomains/ens-contracts/contracts/ethregistrar/BaseRegistrarImplementation.sol";
import {ENS} from "@ensdomains/ens-contracts/contracts/registry/ENS.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title ZNSRegistrar
/// @notice The .znn registrar: ENS's BaseRegistrarImplementation, unchanged
/// underneath, with three things added that a name needs on a chain with no
/// ENS subgraph and no ENS metadata service.
///
/// 1. **The label, in plain text.** ENS keeps only `keccak256(label)`, and
///    reads names back from a subgraph that indexes the controller's events.
///    Here the label is stored beside the token, so `tokenURI` can say
///    "alice.znn" and a marketplace that indexes nothing but ERC-721 events
///    (Karum, through the node's index) shows a name rather than a hash.
///    Recording is permissionless and proves itself: the label must hash to
///    a token that exists, so nobody can record a wrong one.
///
/// 2. **The art and metadata, on chain.** `tokenURI` is a data: URI, built
///    here, so a name looks the same in every wallet and market and nothing
///    has to be hosted for it. ERC-4906's MetadataUpdate is emitted whenever a
///    name's expiry moves, which is the one thing on its card that changes.
///
/// 3. **Selling a name hands over control of it.** In ENS the NFT (the
///    registrant) and the registry node (the controller) are separate: a buyer
///    who receives the token still has to call `reclaim` before they can set a
///    single record, and until then the seller can. Every transfer here also
///    moves the registry node to the new holder, which is what the NameWrapper
///    does for wrapped names. The records themselves (where the name points)
///    are not touched: the buyer's first job is to point it at themselves.
contract ZNSRegistrar is BaseRegistrarImplementation {
    using Strings for uint256;

    /// keccak256(label) => label, for every name registered through a
    /// controller that records it.
    mapping(uint256 => string) public labelOf;

    /// Where a name's page lives, for `external_url`; the label and ".znn"
    /// are appended after "#/name/".
    string public siteURL;

    event LabelRecorded(uint256 indexed id, string label);
    /// ERC-4906.
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    /// ERC-7572, which the node's NFT index listens for.
    event ContractURIUpdated();

    error UnknownName(string label);

    constructor(ENS _ens, bytes32 _baseNode, string memory _siteURL) BaseRegistrarImplementation(_ens, _baseNode) {
        siteURL = _siteURL;
    }

    function name() public pure override returns (string memory) {
        return "ZNS";
    }

    function symbol() public pure override returns (string memory) {
        return "ZNS";
    }

    /// @notice Records a name's label, and tells indexers its metadata may have
    /// changed. The controller calls this on every registration and renewal;
    /// anyone else may, for a name registered some other way.
    function recordLabel(string calldata label) external {
        uint256 id = uint256(keccak256(bytes(label)));
        if (!_exists(id)) revert UnknownName(label);
        if (bytes(labelOf[id]).length == 0) {
            labelOf[id] = label;
            emit LabelRecorded(id, label);
        }
        emit MetadataUpdate(id);
    }

    function setSiteURL(string calldata url) external onlyOwner {
        siteURL = url;
        emit ContractURIUpdated();
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    /// Keeps the registry node with the token: see the contract's note (3).
    /// Mints and burns are left alone, because `_register` sets the node
    /// itself, and a node the registrar no longer controls (the registrar was
    /// retired) is left alone rather than blocking the transfer.
    function _afterTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize)
        internal
        override
    {
        super._afterTokenTransfer(from, to, firstTokenId, batchSize);
        if (from != address(0) && to != address(0) && ens.owner(baseNode) == address(this)) {
            ens.setSubnodeOwner(baseNode, bytes32(firstTokenId), to);
        }
    }

    // --- metadata -----------------------------------------------------------

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireMinted(id);
        string memory label = labelOf[id];
        // ENS's own spelling for a label nobody has recorded: its hash in
        // brackets.
        bool known = bytes(label).length != 0;
        string memory full = known
            ? string.concat(label, ".znn")
            : string.concat("[", uint256(id).toHexString(32), "].znn");
        uint256 len = known ? bytes(label).length : 0;
        uint256 expires = expiries[id];

        // In pieces: one string.concat of all of it is too many stack slots
        // for the legacy code generator.
        string memory head = string.concat(
            '{"name":"',
            full,
            '","description":"',
            full,
            ', a name on the ZVM. Whoever holds this token controls where the name points. It must be renewed before it expires, or it returns to the pool after a 90-day grace period.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_art(known ? label : "?", len, expires)))
        );
        string memory tail = string.concat(
            '","external_url":"', siteURL, "#/name/", full, '","attributes":[', _attributes(label, len, expires), "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(head, tail))));
    }

    /// The collection's own card, which the node's index reads for Karum.
    function contractURI() external view returns (string memory) {
        string memory json = string.concat(
            '{"name":"ZNS","description":"Names on the ZVM. A .znn name points at an address, and an address can name itself back. Names are rented by the year: short ones cost more, and an expired name returns to the pool through a falling-price auction.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_logo())),
            '","external_link":"',
            siteURL,
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    // supportsInterface stays ENS's, which does not claim ERC-721 metadata
    // (0x5b5e139f): the base contract's is not virtual, so it cannot be
    // extended here. The node's index calls tokenURI without asking first.

    function _attributes(string memory label, uint256 len, uint256 expires) internal pure returns (string memory) {
        return string.concat(
            '{"trait_type":"Length","display_type":"number","value":',
            len.toString(),
            '},{"trait_type":"Characters","value":"',
            _charset(label),
            '"},{"trait_type":"Expires","display_type":"date","value":',
            expires.toString(),
            "}"
        );
    }

    function _charset(string memory label) internal pure returns (string memory) {
        bytes memory b = bytes(label);
        bool letters;
        bool digits;
        bool other;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= "a" && c <= "z") letters = true;
            else if (c >= "0" && c <= "9") digits = true;
            else other = true;
        }
        if (b.length == 0) return "Unknown";
        if (other || (letters && digits)) return "Mixed";
        return letters ? "Letters" : "Digits";
    }

    /// The tier colour: Zenon's pink for three characters, NoM blue for four,
    /// ZVM green for five and up, so a short name reads as one across a grid.
    function _tint(uint256 len) internal pure returns (string memory) {
        if (len == 0) return "#7b9094";
        if (len <= 3) return "#f91690";
        if (len == 4) return "#5da4ff";
        return "#00d557";
    }

    // The label is only ever [a-z0-9-] (the controller refuses anything else),
    // or "?", so it is written into the SVG without escaping.
    function _art(string memory label, uint256 len, uint256 expires) internal pure returns (string memory) {
        string memory tint = _tint(len);
        // Sized so the whole name fits the card's 432 units at about 0.6em a
        // character, between 14 and 92.
        uint256 size = 720 / ((len == 0 ? 64 : len) + 4);
        if (size > 92) size = 92;
        if (size < 14) size = 14;
        string memory backdrop = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g" cx=".15" cy=".1" r="1.15"><stop offset="0" stop-color="',
            tint,
            '" stop-opacity=".5"/><stop offset=".5" stop-color="',
            tint,
            '" stop-opacity=".07"/><stop offset="1" stop-color="#06090a" stop-opacity="0"/></radialGradient><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".05"/></pattern></defs><rect width="512" height="512" fill="#06090a"/><rect width="512" height="512" fill="url(#p)"/><rect width="512" height="512" fill="url(#g)"/>',
            _mark(tint)
        );
        string memory title = string.concat(
            '<g font-family="Space Grotesk,ui-sans-serif,system-ui,Segoe UI,sans-serif"><text x="78" y="66" font-size="20" font-weight="600" letter-spacing="2" fill="#e6efec">ZNS</text><text x="40" y="292" font-size="',
            size.toString(),
            '" font-weight="700" letter-spacing="-1" fill="#e6efec">',
            label,
            '<tspan fill="',
            tint,
            '">.znn</tspan></text></g>'
        );
        return string.concat(
            backdrop,
            title,
            '<text x="40" y="470" font-family="ui-monospace,Consolas,monospace" font-size="15" letter-spacing="1.5" fill="#7b9094">EXPIRES ',
            _date(expires),
            "</text></svg>"
        );
    }

    function _mark(string memory tint) internal pure returns (string memory) {
        return string.concat(
            '<path d="M40 44h26L40 72h26" fill="none" stroke="',
            tint,
            '" stroke-width="5" stroke-linecap="square" stroke-linejoin="miter"/>'
        );
    }

    function _logo() internal pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#06090a"/><circle cx="256" cy="256" r="200" fill="#00d557" fill-opacity=".08"/><path d="M156 150h200L156 362h200" fill="none" stroke="#00d557" stroke-width="40" stroke-linecap="square" stroke-linejoin="miter"/><path d="M228 256h56" stroke="#f91690" stroke-width="40"/></svg>'
        );
    }

    /// A Unix time as YYYY-MM-DD in UTC (Howard Hinnant's civil_from_days).
    function _date(uint256 t) internal pure returns (string memory) {
        int256 z = int256(t / 1 days) + 719468;
        int256 era = z / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        int256 d = doy - (153 * mp + 2) / 5 + 1;
        int256 m = mp < 10 ? mp + 3 : mp - 9;
        int256 y = yoe + era * 400 + (m <= 2 ? int256(1) : int256(0));
        return string.concat(uint256(y).toString(), "-", _two(uint256(m)), "-", _two(uint256(d)));
    }

    function _two(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }
}
