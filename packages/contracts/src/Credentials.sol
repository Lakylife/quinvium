// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Ověřitelné certifikáty: diplomy, licence, odborné způsobilosti, zdravotní průkazy
/// @notice Ukládá jen otisk dokladu a kdo ho vydal. Osobní údaje zůstávají mimo řetězec.
///         Jméno vydavatele si každý uvádí sám, důvěra patří jen jeho adrese, kterou má ověřovatel
///         znát z oficiálního zdroje. Proto se doklad hledá vždy podle adresy vydavatele
///         a nikdo cizí nemůže číslo dokladu obsadit dřív než skutečný vydavatel.
contract Credentials {
    struct Issuer {
        string name;
        string website;
        uint64 registeredAt;
    }

    struct Credential {
        address subject;
        bytes32 schema;
        uint64 issuedAt;
        uint64 expiresAt;
        uint64 revokedAt;
    }

    mapping(address => Issuer) public issuers;
    mapping(address => mapping(bytes32 => Credential)) private credentials;

    event IssuerRegistered(address indexed issuer, string name, string website);
    event Issued(bytes32 indexed id, address indexed issuer, address indexed subject, bytes32 schema, uint64 expiresAt);
    event Revoked(bytes32 indexed id, address indexed issuer, string reason);

    error NotIssuer();
    error AlreadyIssued();
    error NotFound();
    error AlreadyRevoked();
    error InvalidExpiry();

    function registerIssuer(string calldata name, string calldata website) external {
        issuers[msg.sender] = Issuer(name, website, uint64(block.timestamp));
        emit IssuerRegistered(msg.sender, name, website);
    }

    /// @param id otisk dokladu, například keccak256 jeho obsahu se solí
    /// @param expiresAt čas vypršení, nula znamená bez vypršení
    function issue(bytes32 id, address subject, bytes32 schema, uint64 expiresAt) external {
        if (issuers[msg.sender].registeredAt == 0) revert NotIssuer();
        Credential storage c = credentials[msg.sender][id];
        if (c.issuedAt != 0) revert AlreadyIssued();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        c.subject = subject;
        c.schema = schema;
        c.issuedAt = uint64(block.timestamp);
        c.expiresAt = expiresAt;
        emit Issued(id, msg.sender, subject, schema, expiresAt);
    }

    function revoke(bytes32 id, string calldata reason) external {
        Credential storage c = credentials[msg.sender][id];
        if (c.issuedAt == 0) revert NotFound();
        if (c.revokedAt != 0) revert AlreadyRevoked();
        c.revokedAt = uint64(block.timestamp);
        emit Revoked(id, msg.sender, reason);
    }

    function get(address issuer, bytes32 id) external view returns (Credential memory) {
        return credentials[issuer][id];
    }

    function isValid(address issuer, bytes32 id) external view returns (bool) {
        Credential storage c = credentials[issuer][id];
        if (c.issuedAt == 0 || c.revokedAt != 0) return false;
        return c.expiresAt == 0 || block.timestamp < c.expiresAt;
    }
}
