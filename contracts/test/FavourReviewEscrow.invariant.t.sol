// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FavourReviewEscrow} from "../src/FavourReviewEscrow.sol";
import {IPermit2AllowanceTransfer} from "../src/FavourCampaignEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";

/// @dev Drives FavourReviewEscrow with random deposits, releases, withdrawals,
///      closes and refund claims from many actors, including calls that must fail.
contract ReviewHandler is Test {
    FavourReviewEscrow public escrow;
    MockUSDC public usdc;
    address public admin;
    address public releaser;

    uint256 public constant START = 1_000_000_000; // fixture: 1000 USDC each
    uint256 public constant MAX_CAMPAIGNS = 10;

    address[] public payers;
    address[] public reviewers;
    bytes32[] public ids;
    uint256 public nonce;

    uint256 public ghostIn; // every token that entered through create or deposit
    uint256 public ghostWithdrawn; // every token that left through withdraw, fee included
    uint256 public ghostRefunded; // every token that left through claimRefund

    // Violation counters. Every one must stay at zero.
    uint256 public ghostStrangerReleased;
    uint256 public ghostEarlyClose;
    uint256 public ghostReleasedAfterClose;
    uint256 public ghostDoubleRefund;

    constructor(FavourReviewEscrow _escrow, MockUSDC _usdc, address _admin, address _releaser) {
        escrow = _escrow;
        usdc = _usdc;
        admin = _admin;
        releaser = _releaser;
        for (uint256 i = 0; i < 4; i++) {
            address p = vm.addr(0xF00D00 + i);
            payers.push(p);
            usdc.mint(p, START);
            vm.prank(p);
            usdc.approve(address(escrow), type(uint256).max);
        }
        for (uint256 i = 0; i < 4; i++) {
            reviewers.push(vm.addr(0xBEEF00 + i));
        }
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function payerCount() external view returns (uint256) {
        return payers.length;
    }

    function reviewerCount() external view returns (uint256) {
        return reviewers.length;
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function create(uint256 who, uint96 amount, uint32 span) external {
        if (ids.length >= MAX_CAMPAIGNS) return;
        address p = payers[who % payers.length];
        amount = uint96(bound(amount, 1, 50_000_000));
        if (usdc.balanceOf(p) < amount) return;
        uint64 deadline = uint64(block.timestamp + bound(span, 1 hours, 30 days));
        vm.prank(p);
        bytes32 id = escrow.create(bytes32(++nonce), amount, deadline);
        ids.push(id);
        ghostIn += amount;
    }

    function deposit(uint256 seed, uint256 who, uint96 amount) external {
        if (ids.length == 0) return;
        address p = payers[who % payers.length];
        amount = uint96(bound(amount, 1, 50_000_000));
        if (usdc.balanceOf(p) < amount) return;
        vm.prank(p);
        try escrow.deposit(_pick(seed), amount) {
            ghostIn += amount;
        } catch {}
    }

    function release(uint256 seed, uint256 who, uint96 amount, bool byAdmin) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        FavourReviewEscrow.Campaign memory c = escrow.getCampaign(id);
        if (c.remaining == 0) return;
        bytes32[] memory cids = new bytes32[](1);
        address[] memory tos = new address[](1);
        uint96[] memory amounts = new uint96[](1);
        cids[0] = bytes32(++nonce);
        tos[0] = reviewers[who % reviewers.length];
        amounts[0] = uint96(bound(amount, 1, c.remaining));
        vm.prank(byAdmin ? admin : releaser);
        try escrow.release(id, cids, tos, amounts) {
            if (c.status != FavourReviewEscrow.Status.Open) ghostReleasedAfterClose++;
        } catch {}
    }

    function strangerRelease(uint256 seed, uint256 who, uint96 amount) external {
        if (ids.length == 0) return;
        address p = payers[who % payers.length];
        bytes32[] memory cids = new bytes32[](1);
        address[] memory tos = new address[](1);
        uint96[] memory amounts = new uint96[](1);
        cids[0] = bytes32(++nonce);
        tos[0] = p;
        amounts[0] = uint96(bound(amount, 1, 1_000_000));
        vm.prank(p);
        try escrow.release(_pick(seed), cids, tos, amounts) {
            ghostStrangerReleased++;
        } catch {}
    }

    function withdraw(uint256 who) external {
        address r = reviewers[who % reviewers.length];
        uint256 amount = escrow.earned(r);
        try escrow.withdraw(r) {
            ghostWithdrawn += amount;
        } catch {}
    }

    function close(uint256 seed, uint256 who, uint8 mode) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        FavourReviewEscrow.Campaign memory c = escrow.getCampaign(id);
        address caller = mode % 3 == 0 ? admin : (mode % 3 == 1 ? c.creator : payers[who % payers.length]);
        bool late = block.timestamp > uint256(c.deadline) + escrow.REFUND_GRACE();
        bool allowed = late || caller == admin || (caller == c.creator && c.released == 0);
        vm.prank(caller);
        try escrow.close(id) {
            if (!allowed) ghostEarlyClose++;
        } catch {}
    }

    function claimRefund(uint256 seed, uint256 who) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(seed);
        address p = payers[who % payers.length];
        bool already = escrow.refundClaimed(id, p);
        uint256 share = escrow.refundShare(id, p);
        try escrow.claimRefund(id, p) {
            if (already) ghostDoubleRefund++;
            ghostRefunded += share;
        } catch {}
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 20 days));
    }
}

contract FavourReviewEscrowInvariantTest is StdInvariant, Test {
    FavourReviewEscrow internal escrow;
    MockUSDC internal usdc;
    ReviewHandler internal handler;
    address internal admin = makeAddr("admin");
    address internal releaser = makeAddr("releaser");

    function setUp() public {
        usdc = new MockUSDC();
        MockPermit2 permit2 = new MockPermit2();
        escrow = new FavourReviewEscrow(
            IERC20(address(usdc)), IPermit2AllowanceTransfer(address(permit2)), admin, releaser
        );
        handler = new ReviewHandler(escrow, usdc, admin, releaser);
        targetContract(address(handler));
    }

    /// The contract always holds enough for everything it owes: open budgets,
    /// unclaimed refund shares and unwithdrawn earnings.
    function invariant_solvent() public view {
        uint256 owed = escrow.totalEarned();
        for (uint256 i = 0; i < handler.idCount(); i++) {
            bytes32 id = handler.ids(i);
            FavourReviewEscrow.Campaign memory c = escrow.getCampaign(id);
            owed += c.remaining;
            for (uint256 j = 0; j < handler.payerCount(); j++) {
                owed += escrow.refundShare(id, handler.payers(j));
            }
        }
        assertGe(usdc.balanceOf(address(escrow)), owed);
    }

    /// Every campaign's books add up, open or closed.
    function invariant_campaign_books_add_up() public view {
        for (uint256 i = 0; i < handler.idCount(); i++) {
            FavourReviewEscrow.Campaign memory c = escrow.getCampaign(handler.ids(i));
            if (c.status == FavourReviewEscrow.Status.Open) {
                assertEq(uint256(c.deposited), uint256(c.released) + c.remaining);
                assertEq(c.refundable, 0);
            } else {
                assertEq(uint256(c.deposited), uint256(c.released) + c.refundable);
                assertEq(c.remaining, 0);
            }
        }
    }

    /// Money in equals money out plus what the contract still holds. With a zero
    /// fee nothing is created or lost anywhere.
    function invariant_conservation() public view {
        assertEq(
            handler.ghostIn(),
            handler.ghostWithdrawn() + handler.ghostRefunded() + usdc.balanceOf(address(escrow))
        );
    }

    /// The sum of the reviewers' balances is the recorded total.
    function invariant_earned_sums_to_total() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.reviewerCount(); i++) {
            sum += escrow.earned(handler.reviewers(i));
        }
        assertEq(sum, escrow.totalEarned());
    }

    function invariant_no_violation_ever() public view {
        assertEq(handler.ghostStrangerReleased(), 0, "a stranger released");
        assertEq(handler.ghostEarlyClose(), 0, "closed too early");
        assertEq(handler.ghostReleasedAfterClose(), 0, "released after close");
        assertEq(handler.ghostDoubleRefund(), 0, "refund claimed twice");
    }
}
