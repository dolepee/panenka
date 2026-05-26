// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../src/DuelCredit.sol";
import "../src/KickerNFT.sol";
import "../src/PenaltyDuel.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
}

contract PanenkaFlowTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    DuelCredit internal credit;
    KickerNFT internal kicker;
    PenaltyDuel internal duel;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    uint256 internal aliceKicker;
    uint256 internal bobKicker;

    function setUp() public {
        credit = new DuelCredit();
        kicker = new KickerNFT();
        duel = new PenaltyDuel(credit, kicker);
        credit.setDuelContract(address(duel));
        kicker.setDuelContract(address(duel));

        vm.prank(alice);
        credit.claimFaucet();
        vm.prank(bob);
        credit.claimFaucet();

        vm.prank(alice);
        kicker.mint(1);
        aliceKicker = 1;
        vm.prank(bob);
        kicker.mint(2);
        bobKicker = 2;
        assertEq(kicker.tokenOfOwner(alice), aliceKicker);
        assertEq(kicker.tokenOfOwner(bob), bobKicker);

        vm.prank(alice);
        credit.approve(address(duel), type(uint256).max);
        vm.prank(bob);
        credit.approve(address(duel), type(uint256).max);
    }

    function testFaucetCooldownBlocksRepeatClaim() public {
        vm.prank(alice);
        vm.expectRevert(DuelCredit.FaucetCooldown.selector);
        credit.claimFaucet();
    }

    function testCreditCannotTransferWalletToWallet() public {
        vm.prank(alice);
        vm.expectRevert(DuelCredit.TransfersOnlyThroughDuel.selector);
        credit.transfer(bob, 1 ether);
    }

    function testCreateJoinRevealAndSettle() public {
        (uint8[10] memory aliceShots, uint8[10] memory aliceSaves, uint8[10] memory bobShots, uint8[10] memory bobSaves) =
            _nonDrawPlans();
        bytes32 aliceSalt = keccak256("alice salt");
        bytes32 bobSalt = keccak256("bob salt");
        bytes32 aliceCommitment = _commitment(alice, aliceShots, aliceSaves, aliceSalt);
        bytes32 bobCommitment = _commitment(bob, bobShots, bobSaves, bobSalt);

        vm.prank(alice);
        uint256 duelId = duel.createDuel(5 ether, aliceKicker, aliceCommitment);

        vm.prank(bob);
        duel.joinDuel(duelId, bobKicker, bobCommitment);

        vm.prank(alice);
        duel.reveal(duelId, aliceShots, aliceSaves, aliceSalt);

        vm.prank(bob);
        duel.reveal(duelId, bobShots, bobSaves, bobSalt);

        assertEq(uint256(duel.getDuel(duelId).status), uint256(PenaltyDuel.DuelStatus.Settled));
        assertEq(credit.balanceOf(alice), 105 ether);
        assertEq(credit.balanceOf(bob), 95 ether);

        (, uint32 aliceWins,, uint32 aliceStreak,) = kicker.statsOf(aliceKicker);
        (,, uint32 bobLosses, uint32 bobStreak,) = kicker.statsOf(bobKicker);
        assertEq(uint256(aliceWins), 1);
        assertEq(uint256(aliceStreak), 1);
        assertEq(uint256(bobLosses), 1);
        assertEq(uint256(bobStreak), 0);
    }

    function testWrongRevealFails() public {
        uint8[10] memory shots = [uint8(0), 1, 2, 0, 1, 2, 0, 1, 2, 0];
        uint8[10] memory saves = [uint8(2), 2, 1, 1, 0, 0, 1, 2, 0, 1];
        bytes32 salt = keccak256("alice salt");
        bytes32 aliceCommitment = _commitment(alice, shots, saves, salt);

        vm.prank(alice);
        uint256 duelId = duel.createDuel(5 ether, aliceKicker, aliceCommitment);

        vm.prank(bob);
        duel.joinDuel(duelId, bobKicker, keccak256("bob commitment"));

        shots[0] = 2;
        vm.prank(alice);
        vm.expectRevert(PenaltyDuel.RevealMismatch.selector);
        duel.reveal(duelId, shots, saves, salt);
    }

    function testCannotJoinUncreatedDuel() public {
        vm.prank(bob);
        vm.expectRevert(PenaltyDuel.InvalidDuel.selector);
        duel.joinDuel(99, bobKicker, keccak256("bob commitment"));
    }

    function testTiedAfterTenUsesDeterministicTiebreak() public {
        uint8[10] memory shots = [uint8(0), 1, 2, 0, 1, 2, 0, 1, 2, 0];
        uint8[10] memory saves = [uint8(0), 1, 2, 0, 1, 2, 0, 1, 2, 0];
        bytes32 aliceSalt = keccak256("alice salt");
        bytes32 bobSalt = keccak256("bob salt");
        bytes32 aliceCommitment = _commitment(alice, shots, saves, aliceSalt);
        bytes32 bobCommitment = _commitment(bob, shots, saves, bobSalt);

        vm.prank(alice);
        uint256 duelId = duel.createDuel(5 ether, aliceKicker, aliceCommitment);

        vm.prank(bob);
        duel.joinDuel(duelId, bobKicker, bobCommitment);

        vm.prank(alice);
        duel.reveal(duelId, shots, saves, aliceSalt);
        vm.prank(bob);
        duel.reveal(duelId, shots, saves, bobSalt);

        assertTrue(
            (credit.balanceOf(alice) == 105 ether && credit.balanceOf(bob) == 95 ether)
                || (credit.balanceOf(alice) == 95 ether && credit.balanceOf(bob) == 105 ether)
        );
        (, uint32 aliceWins,,,) = kicker.statsOf(aliceKicker);
        (,, uint32 bobLosses,,) = kicker.statsOf(bobKicker);
        (, uint32 bobWins,,,) = kicker.statsOf(bobKicker);
        (,, uint32 aliceLosses,,) = kicker.statsOf(aliceKicker);
        assertEq(uint256(aliceWins + bobWins), 1);
        assertEq(uint256(aliceLosses + bobLosses), 1);
    }

    function testCancelUnjoinedAfterTimeout() public {
        uint8[10] memory shots = [uint8(0), 1, 2, 0, 1, 2, 0, 1, 2, 0];
        uint8[10] memory saves = [uint8(2), 2, 1, 1, 0, 0, 1, 2, 0, 1];
        bytes32 aliceCommitment = _commitment(alice, shots, saves, keccak256("salt"));

        vm.prank(alice);
        uint256 duelId = duel.createDuel(5 ether, aliceKicker, aliceCommitment);

        vm.warp(block.timestamp + duel.JOIN_TIMEOUT() + 1);
        vm.prank(alice);
        duel.cancelUnjoinedDuel(duelId);

        assertEq(credit.balanceOf(alice), 100 ether);
        assertEq(uint256(duel.getDuel(duelId).status), uint256(PenaltyDuel.DuelStatus.Cancelled));
    }

    function testClaimForfeitAfterOneReveal() public {
        (uint8[10] memory aliceShots, uint8[10] memory aliceSaves, uint8[10] memory bobShots, uint8[10] memory bobSaves) =
            _nonDrawPlans();
        bytes32 aliceSalt = keccak256("alice salt");
        bytes32 bobSalt = keccak256("bob salt");
        bytes32 aliceCommitment = _commitment(alice, aliceShots, aliceSaves, aliceSalt);
        bytes32 bobCommitment = _commitment(bob, bobShots, bobSaves, bobSalt);

        vm.prank(alice);
        uint256 duelId = duel.createDuel(5 ether, aliceKicker, aliceCommitment);

        vm.prank(bob);
        duel.joinDuel(duelId, bobKicker, bobCommitment);

        vm.prank(alice);
        duel.reveal(duelId, aliceShots, aliceSaves, aliceSalt);

        vm.warp(block.timestamp + duel.REVEAL_TIMEOUT() + 1);
        vm.prank(alice);
        duel.claimForfeit(duelId);

        assertEq(credit.balanceOf(alice), 105 ether);
        assertEq(credit.balanceOf(bob), 95 ether);
        (, uint32 aliceWins,,,) = kicker.statsOf(aliceKicker);
        (,, uint32 bobLosses,,) = kicker.statsOf(bobKicker);
        assertEq(uint256(aliceWins), 1);
        assertEq(uint256(bobLosses), 1);
    }

    function testPlayerCanChangeCountry() public {
        vm.prank(alice);
        kicker.changeCountry(4);

        (uint8 countryId,,,,) = kicker.statsOf(aliceKicker);
        assertEq(uint256(countryId), 4);
    }

    function _nonDrawPlans()
        internal
        pure
        returns (uint8[10] memory aliceShots, uint8[10] memory aliceSaves, uint8[10] memory bobShots, uint8[10] memory bobSaves)
    {
        aliceShots = [uint8(0), 1, 2, 0, 1, 2, 0, 1, 2, 0];
        aliceSaves = [uint8(0), 0, 0, 0, 0, 1, 1, 1, 1, 1];
        bobShots = [uint8(0), 0, 0, 0, 0, 1, 1, 1, 1, 1];
        bobSaves = [uint8(1), 2, 0, 1, 2, 0, 1, 2, 0, 1];
    }

    function _commitment(address player, uint8[10] memory shots, uint8[10] memory saves, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(player, shots, saves, salt));
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        if (a != b) revert("assert uint");
    }

    function assertTrue(bool value) internal pure {
        if (!value) revert("assert true");
    }
}
