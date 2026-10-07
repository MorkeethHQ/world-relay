// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FavourCampaignEscrow, IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";

/// @dev Random sequences of create, top up, pay, refund, warp and direct donation
///      across 3 funders and up to MAX_CAMPAIGNS campaigns, plus four attack
///      actions that must never succeed (replay a paid contribution, refund early,
///      pay as a non-funder, overspend). The handler never asserts: a revert inside
///      a handler is ignored by the fuzzer, so every violation is counted in a
///      ghost variable and the invariants assert the counters are zero.
contract CampaignHandler is Test {
    FavourCampaignEscrow public escrow;
    MockUSDC public usdc;
    MockPermit2 public permit2;

    uint256 public constant START_BALANCE = 1_000_000_000; // fixture: 1000 USDC each
    uint256 public constant MAX_CAMPAIGNS = 12;

    address[] public funders;
    address[] public reviewers;
    bytes32[] public campaignIds;
    mapping(bytes32 => bytes32[]) internal paidIds; // per campaign, ids paid so far

    uint256 public saltNonce;
    uint256 public contributionNonce;

    uint256 public ghostDonated; // USDC sent straight to the escrow
    uint256 public ghostPaidOut; // sum of every payout the handler made
    uint256 public ghostRefundCalls;
    uint256 public ghostPayCalls;

    // Violation counters. Every one must stay at zero.
    uint256 public ghostDoublePaid; // a paid contribution id was paid again
    uint256 public ghostPaidFlagMissing; // a payout went through without isPaid set
    uint256 public ghostEarlyRefund; // refund worked at or before deadline + grace
    uint256 public ghostRefundMisdirected; // refund did not land in full on the funder
    uint256 public ghostUnauthorizedPay; // a non-funder paid from a campaign
    uint256 public ghostOverspend; // a batch larger than remaining went through
    uint256 public ghostPostRefundAction; // top up or pay worked on a refunded campaign

    constructor(FavourCampaignEscrow _escrow, MockUSDC _usdc, MockPermit2 _permit2) {
        escrow = _escrow;
        usdc = _usdc;
        permit2 = _permit2;
        for (uint256 i = 0; i < 3; i++) {
            address f = vm.addr(0xF00D00 + i);
            funders.push(f);
            usdc.mint(f, START_BALANCE);
            vm.startPrank(f);
            usdc.approve(address(escrow), type(uint256).max);
            usdc.approve(address(permit2), type(uint256).max); // World App auto-approval
            vm.stopPrank();
        }
        for (uint256 i = 0; i < 4; i++) {
            reviewers.push(vm.addr(0xBEEF00 + i));
        }
    }

    // ------------------------------------------------------------ views for the test

    function fundersLength() external view returns (uint256) {
        return funders.length;
    }

    function reviewersLength() external view returns (uint256) {
        return reviewers.length;
    }

    function campaignsLength() external view returns (uint256) {
        return campaignIds.length;
    }

    function _pick(uint256 seed) internal view returns (bytes32 id, bool ok) {
        if (campaignIds.length == 0) return (bytes32(0), false);
        return (campaignIds[seed % campaignIds.length], true);
    }

    function _refundable(FavourCampaignEscrow.Campaign memory c) internal view returns (bool) {
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > uint256(c.deadline) + escrow.REFUND_GRACE();
    }

    // ------------------------------------------------------------ honest actions

    function create(uint256 funderSeed, uint96 amount, uint64 duration, bool viaPermit2) external {
        if (campaignIds.length >= MAX_CAMPAIGNS) return;
        address funder = funders[funderSeed % funders.length];
        amount = uint96(bound(amount, 1, 100_000_000));
        duration = uint64(bound(duration, 1, escrow.MAX_DURATION() / 6));
        if (usdc.balanceOf(funder) < amount) return;

        bytes32 salt = keccak256(abi.encode("salt", saltNonce++));
        uint64 deadline = uint64(block.timestamp) + duration;
        bytes32 id;
        vm.startPrank(funder);
        if (viaPermit2) {
            permit2.approve(address(usdc), address(escrow), amount, 0);
            id = escrow.createWithPermit2(salt, amount, deadline);
        } else {
            id = escrow.create(salt, amount, deadline);
        }
        vm.stopPrank();
        campaignIds.push(id);
    }

    function topUp(uint256 campaignSeed, uint96 amount, bool viaPermit2) external {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        amount = uint96(bound(amount, 1, 50_000_000));
        if (usdc.balanceOf(c.funder) < amount) return;

        // forge-lint: disable-next-line(block-timestamp)
        bool beforeDeadline = block.timestamp < c.deadline;
        bool allowed = c.status == FavourCampaignEscrow.Status.Active && beforeDeadline;

        vm.startPrank(c.funder);
        if (viaPermit2) {
            permit2.approve(address(usdc), address(escrow), amount, 0);
            try escrow.topUpWithPermit2(id, amount) {
                if (!allowed) ghostPostRefundAction++;
            } catch {}
        } else {
            try escrow.topUp(id, amount) {
                if (!allowed) ghostPostRefundAction++;
            } catch {}
        }
        vm.stopPrank();
    }

    function pay(uint256 campaignSeed, uint256 sizeSeed, uint256 amountSeed, uint256 recipientSeed)
        external
    {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        if (c.status != FavourCampaignEscrow.Status.Active) return;
        uint256 n = bound(sizeSeed, 1, 5);
        if (c.remaining < n) return;

        bytes32[] memory ids = new bytes32[](n);
        address[] memory tos = new address[](n);
        uint96[] memory amts = new uint96[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            ids[i] = keccak256(abi.encode("contribution", contributionNonce++));
            tos[i] = reviewers[uint256(keccak256(abi.encode(recipientSeed, i))) % reviewers.length];
            amts[i] = uint96(
                bound(uint256(keccak256(abi.encode(amountSeed, i))), 1, uint256(c.remaining) / n)
            );
            total += amts[i];
        }

        vm.prank(c.funder);
        escrow.payBatch(id, ids, tos, amts);

        ghostPayCalls++;
        ghostPaidOut += total;
        for (uint256 i = 0; i < n; i++) {
            if (!escrow.isPaid(id, ids[i])) ghostPaidFlagMissing++;
            paidIds[id].push(ids[i]);
        }
    }

    function refund(uint256 campaignSeed, uint256 callerSeed) external {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        if (c.status != FavourCampaignEscrow.Status.Active) return;
        if (!_refundable(c) || c.remaining == 0) return;

        // The caller is anyone: a reviewer, another funder, or the funder itself.
        address caller = callerSeed % 2 == 0
            ? reviewers[callerSeed % reviewers.length]
            : funders[callerSeed % funders.length];
        uint256 funderBefore = usdc.balanceOf(c.funder);
        uint256 callerBefore = usdc.balanceOf(caller);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(caller);
        escrow.refund(id);
        ghostRefundCalls++;

        if (usdc.balanceOf(c.funder) != funderBefore + c.remaining) ghostRefundMisdirected++;
        if (caller != c.funder && usdc.balanceOf(caller) != callerBefore) ghostRefundMisdirected++;
        if (usdc.balanceOf(address(escrow)) != escrowBefore - c.remaining) ghostRefundMisdirected++;
    }

    function warp(uint64 by) external {
        vm.warp(block.timestamp + bound(by, 1, 20 days));
    }

    /// USDC sent straight to the contract. It must change no campaign record.
    function donate(uint96 amount) external {
        amount = uint96(bound(amount, 1, 10_000_000));
        usdc.mint(address(this), amount);
        require(usdc.transfer(address(escrow), amount), "donation failed");
        ghostDonated += amount;
    }

    // ------------------------------------------------------------ attacks, must all fail

    function attackReplayPaid(uint256 campaignSeed, uint256 idSeed, uint256 recipientSeed)
        external
    {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok || paidIds[id].length == 0) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);

        bytes32[] memory ids = new bytes32[](1);
        address[] memory tos = new address[](1);
        uint96[] memory amts = new uint96[](1);
        ids[0] = paidIds[id][idSeed % paidIds[id].length];
        tos[0] = reviewers[recipientSeed % reviewers.length];
        amts[0] = 1;

        vm.prank(c.funder);
        try escrow.payBatch(id, ids, tos, amts) {
            ghostDoublePaid++;
        } catch {}
    }

    function attackEarlyRefund(uint256 campaignSeed, uint256 callerSeed) external {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        if (c.status != FavourCampaignEscrow.Status.Active || _refundable(c)) return;

        // Includes the funder itself: nobody gets the remainder back early.
        vm.prank(funders[callerSeed % funders.length]);
        try escrow.refund(id) {
            ghostEarlyRefund++;
        } catch {}
    }

    function attackStrangerPay(uint256 campaignSeed, uint256 callerSeed) external {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);
        address caller = callerSeed % 2 == 0
            ? reviewers[callerSeed % reviewers.length]
            : funders[callerSeed % funders.length];
        if (caller == c.funder) return;

        bytes32[] memory ids = new bytes32[](1);
        address[] memory tos = new address[](1);
        uint96[] memory amts = new uint96[](1);
        ids[0] = keccak256(abi.encode("stolen", contributionNonce++));
        tos[0] = caller;
        amts[0] = 1;

        vm.prank(caller);
        try escrow.payBatch(id, ids, tos, amts) {
            ghostUnauthorizedPay++;
        } catch {}
    }

    /// The funder asks for one unit more than the campaign has, while other
    /// campaigns' money sits in the same contract. Also covers refunded campaigns.
    function attackOverspend(uint256 campaignSeed) external {
        (bytes32 id, bool ok) = _pick(campaignSeed);
        if (!ok) return;
        FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(id);

        bytes32[] memory ids = new bytes32[](1);
        address[] memory tos = new address[](1);
        uint96[] memory amts = new uint96[](1);
        ids[0] = keccak256(abi.encode("overspend", contributionNonce++));
        tos[0] = c.funder;
        amts[0] = c.remaining + 1;

        vm.prank(c.funder);
        try escrow.payBatch(id, ids, tos, amts) {
            if (c.status == FavourCampaignEscrow.Status.Active) ghostOverspend++;
            else ghostPostRefundAction++;
        } catch {}
    }
}

contract FavourCampaignEscrowInvariantTest is StdInvariant, Test {
    FavourCampaignEscrow internal escrow;
    MockUSDC internal usdc;
    MockPermit2 internal permit2;
    CampaignHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        permit2 = new MockPermit2();
        escrow = new FavourCampaignEscrow(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2))
        );
        handler = new CampaignHandler(escrow, usdc, permit2);
        targetContract(address(handler));
    }

    /// For every campaign: deposited == paid + refunded + remaining. A refunded
    /// campaign has nothing left to spend.
    function invariant_per_campaign_accounting_identity() public view {
        uint256 n = handler.campaignsLength();
        for (uint256 i = 0; i < n; i++) {
            FavourCampaignEscrow.Campaign memory c = escrow.getCampaign(handler.campaignIds(i));
            assertEq(
                uint256(c.deposited),
                uint256(c.paid) + uint256(c.refunded) + uint256(c.remaining),
                "deposited != paid + refunded + remaining"
            );
            assertTrue(c.status != FavourCampaignEscrow.Status.None, "tracked campaign missing");
            if (c.status == FavourCampaignEscrow.Status.Refunded) {
                assertEq(c.remaining, 0, "refunded campaign still has budget");
            } else {
                assertEq(c.refunded, 0, "active campaign shows a refund");
            }
        }
    }

    /// The contract always holds at least the sum of every campaign's remaining
    /// budget. The only surplus is USDC that was sent to it directly.
    function invariant_balance_covers_sum_of_remaining() public view {
        uint256 n = handler.campaignsLength();
        uint256 sumRemaining;
        for (uint256 i = 0; i < n; i++) {
            sumRemaining += escrow.getCampaign(handler.campaignIds(i)).remaining;
        }
        uint256 balance = usdc.balanceOf(address(escrow));
        assertGe(balance, sumRemaining, "escrow underfunded");
        assertEq(balance, sumRemaining + handler.ghostDonated(), "surplus is not the donations");
    }

    /// No contribution id is ever paid twice, and reviewers hold exactly what the
    /// campaigns say was paid.
    function invariant_no_contribution_paid_twice() public view {
        assertEq(handler.ghostDoublePaid(), 0, "a contribution was paid twice");
        assertEq(handler.ghostPaidFlagMissing(), 0, "a payout left no paid flag");

        uint256 n = handler.campaignsLength();
        uint256 sumPaid;
        for (uint256 i = 0; i < n; i++) {
            sumPaid += escrow.getCampaign(handler.campaignIds(i)).paid;
        }
        uint256 reviewerBalances;
        for (uint256 i = 0; i < handler.reviewersLength(); i++) {
            reviewerBalances += usdc.balanceOf(handler.reviewers(i));
        }
        assertEq(sumPaid, handler.ghostPaidOut(), "recorded paid != payouts made");
        assertEq(reviewerBalances, sumPaid, "reviewer balances != recorded paid");
    }

    /// Every refund lands on the recorded funder. Each funder's wallet is exactly
    /// its start balance, minus what its campaigns took in, plus what they refunded.
    function invariant_refunds_land_on_recorded_funder() public view {
        assertEq(handler.ghostRefundMisdirected(), 0, "a refund went somewhere else");

        uint256 n = handler.campaignsLength();
        for (uint256 f = 0; f < handler.fundersLength(); f++) {
            address funder = handler.funders(f);
            uint256 deposited;
            uint256 refunded;
            for (uint256 i = 0; i < n; i++) {
                FavourCampaignEscrow.Campaign memory c =
                    escrow.getCampaign(handler.campaignIds(i));
                if (c.funder != funder) continue;
                deposited += c.deposited;
                refunded += c.refunded;
            }
            assertEq(
                usdc.balanceOf(funder),
                handler.START_BALANCE() - deposited + refunded,
                "funder wallet does not match its campaigns"
            );
        }
    }

    /// None of the attack actions ever went through.
    function invariant_attacks_never_succeed() public view {
        assertEq(handler.ghostEarlyRefund(), 0, "refund before deadline + grace");
        assertEq(handler.ghostUnauthorizedPay(), 0, "a non-funder paid from a campaign");
        assertEq(handler.ghostOverspend(), 0, "a campaign spent past its budget");
        assertEq(handler.ghostPostRefundAction(), 0, "a refunded campaign was used again");
    }
}
