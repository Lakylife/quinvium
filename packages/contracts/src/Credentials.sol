// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Verifiable credentials: diplomas, licences, qualifications, health certificates
/// @notice Stores only the fingerprint of a document and who issued it. Personal data stays off chain.
///         Everyone states the issuer name themselves; trust belongs only to their address, which the verifier has
///         know from an official source. That is why a credential is always looked up by the issuer's address
///         and no stranger can claim a document number before the real issuer.
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

    /// @param id fingerprint of the document, for example keccak256 of its content with a salt
    /// @param expiresAt expiry time, zero means no expiry
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
