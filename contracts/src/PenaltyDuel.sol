// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DuelCredit.sol";
import "./KickerNFT.sol";

contract PenaltyDuel {
    enum DuelStatus {
        Open,
        Committed,
        Settled,
        Cancelled,
        Forfeited
    }

    struct PlayerState {
        address player;
        uint256 kickerTokenId;
        bytes32 commitHash;
        bool revealed;
        uint8[5] shots;
        uint8[5] saves;
    }

    struct Duel {
        uint256 stake;
        uint256 createdAt;
        uint256 joinedAt;
        uint256 firstRevealAt;
        DuelStatus status;
        PlayerState p1;
        PlayerState p2;
    }

    uint256 public constant JOIN_TIMEOUT = 30 minutes;
    uint256 public constant REVEAL_TIMEOUT = 30 minutes;
    uint256 public nextDuelId = 1;

    DuelCredit public immutable credit;
    KickerNFT public immutable kicker;

    mapping(uint256 => Duel) public duels;

    event DuelCreated(
        uint256 indexed duelId,
        address indexed creator,
        uint256 stake,
        uint256 indexed kickerTokenId,
        bytes32 commitHash
    );
    event DuelJoined(uint256 indexed duelId, address indexed opponent, uint256 indexed kickerTokenId, bytes32 commitHash);
    event PlayerRevealed(uint256 indexed duelId, address indexed player);
    event RoundResolved(
        uint256 indexed duelId,
        uint8 round,
        bool p1Goal,
        bool p2Goal,
        uint8 p1Shot,
        uint8 p2Shot,
        uint8 p1Save,
        uint8 p2Save
    );
    event DuelSettled(uint256 indexed duelId, address indexed winner, uint8 p1Score, uint8 p2Score, uint256 payout, bool draw);
    event DuelForfeited(uint256 indexed duelId, address indexed winner, address indexed loser);
    event DuelCancelled(uint256 indexed duelId, address indexed creator);

    error InvalidStake();
    error InvalidStatus();
    error InvalidKickerOwner();
    error CannotJoinOwnDuel();
    error InvalidCommitment();
    error InvalidDirection();
    error NotPlayer();
    error AlreadyRevealed();
    error RevealMismatch();
    error TimeoutNotReached();
    error CreditTransferFailed();

    constructor(DuelCredit credit_, KickerNFT kicker_) {
        credit = credit_;
        kicker = kicker_;
    }

    function createDuel(uint256 stake, uint256 kickerTokenId, bytes32 commitHash) external returns (uint256 duelId) {
        if (stake == 0) revert InvalidStake();
        if (commitHash == bytes32(0)) revert InvalidCommitment();
        if (kicker.ownerOf(kickerTokenId) != msg.sender) revert InvalidKickerOwner();

        duelId = nextDuelId++;
        Duel storage duel = duels[duelId];
        duel.stake = stake;
        duel.createdAt = block.timestamp;
        duel.status = DuelStatus.Open;
        duel.p1.player = msg.sender;
        duel.p1.kickerTokenId = kickerTokenId;
        duel.p1.commitHash = commitHash;

        _safeTransferFrom(msg.sender, address(this), stake);
        emit DuelCreated(duelId, msg.sender, stake, kickerTokenId, commitHash);
    }

    function joinDuel(uint256 duelId, uint256 kickerTokenId, bytes32 commitHash) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Open) revert InvalidStatus();
        if (commitHash == bytes32(0)) revert InvalidCommitment();
        if (duel.p1.player == msg.sender) revert CannotJoinOwnDuel();
        if (kicker.ownerOf(kickerTokenId) != msg.sender) revert InvalidKickerOwner();

        duel.status = DuelStatus.Committed;
        duel.joinedAt = block.timestamp;
        duel.p2.player = msg.sender;
        duel.p2.kickerTokenId = kickerTokenId;
        duel.p2.commitHash = commitHash;

        _safeTransferFrom(msg.sender, address(this), duel.stake);
        emit DuelJoined(duelId, msg.sender, kickerTokenId, commitHash);
    }

    function reveal(uint256 duelId, uint8[5] calldata shots, uint8[5] calldata saves, bytes32 salt) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Committed) revert InvalidStatus();
        _validateDirections(shots);
        _validateDirections(saves);

        PlayerState storage player = _playerState(duel, msg.sender);
        if (player.revealed) revert AlreadyRevealed();
        if (_commitment(msg.sender, shots, saves, salt) != player.commitHash) revert RevealMismatch();

        player.revealed = true;
        player.shots = shots;
        player.saves = saves;
        if (duel.firstRevealAt == 0) duel.firstRevealAt = block.timestamp;

        emit PlayerRevealed(duelId, msg.sender);

        if (duel.p1.revealed && duel.p2.revealed) {
            _settle(duelId, duel);
        }
    }

    function cancelUnjoinedDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Open) revert InvalidStatus();
        if (duel.p1.player != msg.sender) revert NotPlayer();
        if (block.timestamp < duel.createdAt + JOIN_TIMEOUT) revert TimeoutNotReached();

        duel.status = DuelStatus.Cancelled;
        _safeTransfer(duel.p1.player, duel.stake);
        emit DuelCancelled(duelId, msg.sender);
    }

    function claimForfeit(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        if (duel.status != DuelStatus.Committed) revert InvalidStatus();
        if (duel.firstRevealAt == 0 || block.timestamp < duel.firstRevealAt + REVEAL_TIMEOUT) revert TimeoutNotReached();

        bool p1CanClaim = msg.sender == duel.p1.player && duel.p1.revealed && !duel.p2.revealed;
        bool p2CanClaim = msg.sender == duel.p2.player && duel.p2.revealed && !duel.p1.revealed;
        if (!p1CanClaim && !p2CanClaim) revert NotPlayer();

        address loser = p1CanClaim ? duel.p2.player : duel.p1.player;
        uint256 loserTokenId = p1CanClaim ? duel.p2.kickerTokenId : duel.p1.kickerTokenId;
        duel.status = DuelStatus.Forfeited;

        _safeTransfer(msg.sender, duel.stake * 2);
        kicker.recordWin(p1CanClaim ? duel.p1.kickerTokenId : duel.p2.kickerTokenId);
        kicker.recordLoss(loserTokenId);
        emit DuelForfeited(duelId, msg.sender, loser);
    }

    function commitment(address player, uint8[5] calldata shots, uint8[5] calldata saves, bytes32 salt)
        external
        pure
        returns (bytes32)
    {
        return _commitment(player, shots, saves, salt);
    }

    function getDuel(uint256 duelId) external view returns (Duel memory) {
        return duels[duelId];
    }

    function _settle(uint256 duelId, Duel storage duel) internal {
        uint8 p1Score;
        uint8 p2Score;

        for (uint8 i = 0; i < 5; i++) {
            bool p1Goal = duel.p1.shots[i] != duel.p2.saves[i];
            bool p2Goal = duel.p2.shots[i] != duel.p1.saves[i];
            if (p1Goal) p1Score += 1;
            if (p2Goal) p2Score += 1;
            emit RoundResolved(duelId, i + 1, p1Goal, p2Goal, duel.p1.shots[i], duel.p2.shots[i], duel.p1.saves[i], duel.p2.saves[i]);
        }

        duel.status = DuelStatus.Settled;
        uint256 pot = duel.stake * 2;
        if (p1Score == p2Score) {
            _safeTransfer(duel.p1.player, duel.stake);
            _safeTransfer(duel.p2.player, duel.stake);
            emit DuelSettled(duelId, address(0), p1Score, p2Score, 0, true);
            return;
        }

        bool p1Won = p1Score > p2Score;
        address winner = p1Won ? duel.p1.player : duel.p2.player;
        _safeTransfer(winner, pot);
        kicker.recordWin(p1Won ? duel.p1.kickerTokenId : duel.p2.kickerTokenId);
        kicker.recordLoss(p1Won ? duel.p2.kickerTokenId : duel.p1.kickerTokenId);
        emit DuelSettled(duelId, winner, p1Score, p2Score, pot, false);
    }

    function _playerState(Duel storage duel, address player) internal view returns (PlayerState storage state) {
        if (duel.p1.player == player) return duel.p1;
        if (duel.p2.player == player) return duel.p2;
        revert NotPlayer();
    }

    function _validateDirections(uint8[5] calldata directions) internal pure {
        for (uint256 i = 0; i < 5; i++) {
            if (directions[i] > 2) revert InvalidDirection();
        }
    }

    function _commitment(address player, uint8[5] calldata shots, uint8[5] calldata saves, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(player, shots, saves, salt));
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (!credit.transfer(to, amount)) revert CreditTransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        if (!credit.transferFrom(from, to, amount)) revert CreditTransferFailed();
    }
}
