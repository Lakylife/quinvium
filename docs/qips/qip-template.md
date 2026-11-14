---
qip: <number>
title: <short title>
author: <name or GitHub handle>
status: Draft            # Draft | Review | Last Call | Accepted | Testnet | Scheduled | Final | Withdrawn
created: <YYYY-MM-DD>
review-ends: <YYYY-MM-DD, at least 30 days after Review starts>
testnet-fork: <block height on testnet, once Accepted>
mainnet-fork: <block height on mainnet, at least 90 days after the release>
---

## Summary

One paragraph: what changes.

## Motivation

Why the network needs it, and what happens if nothing is done.

## Specification

The exact new rules, precise enough that an independent implementation gives the same result.

## Security considerations

Attacks, edge cases, effect on miners, wallets, contracts and the bridge. Does it add any new trust? (It must not.)

## Backwards compatibility

What older nodes and wallets do at the fork height.

## Test vectors

Inputs and expected outputs, including the new golden hashes.

## Reference implementation

Link to the pull request.
