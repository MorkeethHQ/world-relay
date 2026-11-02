// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "../utils/Base.t.sol";
import {MockUSDC} from "../utils/Mocks.sol";
import {FavourPots} from "../../src/FavourPots.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/// Drives FavourPots through random admin, operator and user actions, tracking an independent ledger.
contract FavourHandler is Test {
    FavourPots public f;
    MockUSDC public usdc;
    address public admin;
    address public operator;
    address[4] public users;

    uint256[] public campaigns;
    bytes32[] public favourKeys;

    // ghosts
    uint256 public ghostIn; // every unit pulled in
    uint256 public ghostOut; // every unit pushed out
    uint256 public ghostGrossPaid; // gross payouts that carried a fee
    uint256 public ghostFees; // fees accrued
    uint256 public exitBlockedByPause; // must stay 0
    uint256 public adminTookUserEscrow; // must stay 0
    uint256 public feeAboveCap; // must stay 0
    uint256 nonce;

    constructor(FavourPots _f, MockUSDC _u, address _admin, address _op) {
        f = _f;
        usdc = _u;
        admin = _admin;
        operator = _op;
        for (uint256 i; i < 4; i++) {
            users[i] = address(uint160(0xA11CE + i));
            usdc.mint(users[i], 1e15);
            vm.prank(users[i]);
            usdc.approve(address(f), type(uint256).max);
        }
        usdc.mint(admin, 1e15);
        vm.prank(admin);
        usdc.approve(address(f), type(uint256).max);
    }

    function _user(uint256 s) internal view returns (address) {
        return users[s % 4];
    }

    function _isPauseErr(bytes memory err) internal pure returns (bool) {
        return err.length >= 4 && bytes4(err) == PausableUpgradeable.EnforcedPause.selector;
    }

    function openCampaign(uint256 cap) external {
        cap = bound(cap, 100_000, 1000e6);
        vm.prank(admin);
        try f.openCampaign(address(usdc), cap) returns (uint256 id) {
            campaigns.push(id);
        } catch {}
    }

    function fundCampaign(uint256 seed, uint256 amount, bool byAdmin) external {
        if (campaigns.length == 0) return;
        uint256 id = campaigns[seed % campaigns.length];
        amount = bound(amount, 100_000, 500e6);
        address who = byAdmin ? admin : _user(seed);
        vm.prank(who);
        try f.fundCampaign(id, amount) {
            ghostIn += amount;
        } catch {}
    }

    function payFromPot(uint256 seed, uint256 amount, bool byAdmin) external {
        if (campaigns.length == 0) return;
        uint256 id = campaigns[seed % campaigns.length];
        FavourPots.Campaign memory c = f.getCampaign(id);
        if (c.closed || c.balance < 100_000) return;
        uint256 max = c.cap < c.balance ? c.cap : c.balance;
        amount = bound(amount, 100_000, max);
        bytes32 key = keccak256(abi.encode(nonce++));
        vm.prank(byAdmin ? admin : operator);
        try f.payFromPot(id, key, _user(seed + 1), amount) {
            uint256 fee = (amount * c.feeBps) / 10_000;
            if (c.feeBps > f.MAX_FEE_BPS()) feeAboveCap++;
            ghostOut += amount - fee;
            ghostFees += fee;
            ghostGrossPaid += amount;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function closeCampaign(uint256 seed) external {
        if (campaigns.length == 0) return;
        uint256 id = campaigns[seed % campaigns.length];
        vm.prank(admin);
        try f.closeCampaign(id) {} catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function claimRefund(uint256 seed, bool byAdmin) external {
        if (campaigns.length == 0) return;
        uint256 id = campaigns[seed % campaigns.length];
        address who = byAdmin ? admin : _user(seed);
        uint256 b0 = usdc.balanceOf(who);
        vm.prank(who);
        try f.claimCampaignRefund(id) {
            ghostOut += usdc.balanceOf(who) - b0;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function fundFavour(uint256 seed, uint256 amount, uint256 days_) external {
        amount = bound(amount, 100_000, 1000e6);
        days_ = bound(days_, 1, 180);
        bytes32 key = keccak256(abi.encode("fav", nonce++));
        address who = _user(seed);
        vm.prank(who);
        try f.fundFavour(key, address(usdc), amount, seed % 2 == 0 ? operator : address(0), uint64(block.timestamp + days_ * 1 days)) {
            ghostIn += amount;
            favourKeys.push(key);
        } catch {}
    }

    function releaseFavour(uint256 seed, bool asReleaser) external {
        if (favourKeys.length == 0) return;
        bytes32 key = favourKeys[seed % favourKeys.length];
        FavourPots.Favour memory fv = f.getFavour(key);
        if (fv.status != FavourPots.FavourStatus.Funded) return;
        address caller = asReleaser && fv.releaser != address(0) ? fv.releaser : fv.funder;
        vm.prank(caller);
        try f.releaseFavour(key, _user(seed + 2)) {
            uint256 fee = (uint256(fv.amount) * fv.feeBps) / 10_000;
            ghostOut += fv.amount - fee;
            ghostFees += fee;
            ghostGrossPaid += fv.amount;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    /// The admin tries to redirect a user escrow to itself. Must always fail.
    function adminStealsEscrow(uint256 seed) external {
        if (favourKeys.length == 0) return;
        bytes32 key = favourKeys[seed % favourKeys.length];
        FavourPots.Favour memory fv = f.getFavour(key);
        if (fv.status != FavourPots.FavourStatus.Funded || fv.funder == admin || fv.releaser == admin) return;
        vm.prank(admin);
        try f.releaseFavour(key, admin) {
            adminTookUserEscrow++;
        } catch {}
    }

    function refundFavour(uint256 seed, uint256 warpBy, bool byAdmin) external {
        if (favourKeys.length == 0) return;
        bytes32 key = favourKeys[seed % favourKeys.length];
        FavourPots.Favour memory fv = f.getFavour(key);
        if (fv.status != FavourPots.FavourStatus.Funded) return;
        vm.warp(block.timestamp + bound(warpBy, 0, 200 days));
        vm.prank(byAdmin ? admin : address(0xdead));
        try f.refundFavour(key) {
            ghostOut += fv.amount;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function withdrawFees() external {
        uint256 a = f.feesAccrued(address(usdc));
        try f.withdrawFees(address(usdc)) {
            ghostOut += a;
        } catch (bytes memory err) {
            if (_isPauseErr(err)) exitBlockedByPause++;
        }
    }

    function setFee(uint256 bps) external {
        bps = bound(bps, 0, 5000);
        vm.prank(admin);
        try f.setFee(uint16(bps), address(0xFEE)) {
            if (bps > 1000) feeAboveCap++;
        } catch {}
    }

    function togglePause(bool on) external {
        if (on && !f.paused()) {
            vm.prank(operator);
            f.pause();
        } else if (!on && f.paused()) {
            vm.prank(admin);
            f.unpause();
        }
    }

    function strayTransfer(uint256 amount) external {
        amount = bound(amount, 1, 1e6);
        usdc.mint(address(f), amount);
        ghostIn += amount;
    }

    function campaignsLength() external view returns (uint256) {
        return campaigns.length;
    }
}

contract FavourInvariantTest is BaseTest {
    FavourPots internal f;
    FavourHandler internal h;

    function setUp() public {
        _deployMocks();
        f = _deployFavour(address(usdc), address(permit2));
        h = new FavourHandler(f, usdc, admin, operator);
        targetContract(address(h));
    }

    /// Money held always covers every promise: open pots, closed-pot refunds, user escrows, fees.
    function invariant_solvent() public view {
        assertGe(usdc.balanceOf(address(f)), f.owed(address(usdc)));
    }

    /// The contract's own ledger matches an independent count of money in and out.
    function invariant_ledger_matches_ghost() public view {
        assertEq(usdc.balanceOf(address(f)), h.ghostIn() - h.ghostOut());
    }

    function invariant_fee_never_above_cap() public view {
        assertLe(f.feeBps(), f.MAX_FEE_BPS());
        assertEq(h.feeAboveCap(), 0);
        assertLe(h.ghostFees() * 10_000, h.ghostGrossPaid() * f.MAX_FEE_BPS());
    }

    function invariant_pause_never_blocks_exits() public view {
        assertEq(h.exitBlockedByPause(), 0);
    }

    function invariant_admin_never_redirects_user_escrow() public view {
        assertEq(h.adminTookUserEscrow(), 0);
    }

    function invariant_campaign_fee_snapshots_capped() public view {
        uint256 n = h.campaignsLength();
        for (uint256 i; i < n; i++) {
            assertLe(f.getCampaign(h.campaigns(i)).feeBps, f.MAX_FEE_BPS());
        }
    }
}
