// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Notář: důkaz existence dokumentu (právo, zdravotnictví, archivace, autorská práva)
/// @notice Ukládá jen otisk dokumentu. Samotný dokument nikdy neopouští počítač uživatele.
///         Záznam dokazuje, že dokument v daném čase existoval a kdo ho zapsal, ne kdo je jeho autorem.
///         Každá adresa má vlastní záznam: kdo otisk opíše z čekajících transakcí, cizí zápis
///         nezablokuje ani neodvolá.
contract Notary {
    struct Record {
        uint64 timestamp;
        uint64 revokedAt;
        string note;
    }

    mapping(bytes32 => mapping(address => Record)) private records;
    mapping(bytes32 => address) public firstAuthor;

    event Notarized(bytes32 indexed hash, address indexed author, string note);
    event Revoked(bytes32 indexed hash, address indexed author, string reason);

    error AlreadyNotarized();
    error NotFound();
    error AlreadyRevoked();

    function notarize(bytes32 hash, string calldata note) external {
        Record storage r = records[hash][msg.sender];
        if (r.timestamp != 0) revert AlreadyNotarized();
        r.timestamp = uint64(block.timestamp);
        r.note = note;
        if (firstAuthor[hash] == address(0)) firstAuthor[hash] = msg.sender;
        emit Notarized(hash, msg.sender, note);
    }

    function revoke(bytes32 hash, string calldata reason) external {
        Record storage r = records[hash][msg.sender];
        if (r.timestamp == 0) revert NotFound();
        if (r.revokedAt != 0) revert AlreadyRevoked();
        r.revokedAt = uint64(block.timestamp);
        emit Revoked(hash, msg.sender, reason);
    }

    function verify(bytes32 hash, address author)
        external
        view
        returns (bool exists, uint64 timestamp, uint64 revokedAt, string memory note)
    {
        Record storage r = records[hash][author];
        return (r.timestamp != 0, r.timestamp, r.revokedAt, r.note);
    }
}
